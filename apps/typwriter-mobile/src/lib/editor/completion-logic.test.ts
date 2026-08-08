import { expect, test, describe } from "bun:test";
import {
  autoTriggerApplies,
  rankCompletions,
  scoreCompletion,
  toStripItem,
  typstApplyToSnippet,
  wordStartBefore,
  type StripItem,
} from "./completion-logic";
import type { IpcCompletion } from "$lib/ipc/types";

const items = (...labels: string[]): StripItem[] =>
  labels.map((label) => ({ label, kind: "func", template: label }));
const labels = (r: StripItem[]) => r.map((i) => i.label);

const c = (over: Partial<IpcCompletion>): IpcCompletion => ({
  kind: "func",
  label: "x",
  apply: null,
  detail: null,
  ...over,
});

describe("typstApplyToSnippet", () => {
  test("named placeholder becomes a selectable field, markers stripped", () => {
    // `${body}` → CodeMirror field whose text is `body`, selected on insert.
    expect(typstApplyToSnippet("#image(${body})")).toBe("#image(${body})");
  });

  test("empty placeholder stays an empty (cursor-only) field", () => {
    expect(typstApplyToSnippet("image(${})")).toBe("image(${})");
  });

  test("multiple holes are all preserved as fields", () => {
    expect(typstApplyToSnippet("figure(${body}, caption: [${caption}])")).toBe(
      "figure(${body}, caption: [${caption}])",
    );
  });

  test("no-hole apply passes through unchanged", () => {
    expect(typstApplyToSnippet("pagebreak()")).toBe("pagebreak()");
  });

  test("literal Typst braces are escaped so they aren't read as fields", () => {
    // `#{}` is a Typst code block, not a placeholder — escape both braces.
    expect(typstApplyToSnippet("#{}")).toBe("#\\{\\}");
    // A literal `{` inside a placeholder's default text is escaped too.
    expect(typstApplyToSnippet("${a{b}")).toBe("${a\\{b}");
  });
});

describe("toStripItem", () => {
  test("builds template from apply, carries label/kind", () => {
    const r = toStripItem(c({ kind: "func", label: "image", apply: "image(${})" }));
    expect(r).toEqual({ label: "image", kind: "func", template: "image(${})" });
  });

  test("null apply falls back to the label", () => {
    const r = toStripItem(c({ label: "blue", apply: null }));
    expect(r.template).toBe("blue");
  });
});

describe("scoreCompletion", () => {
  test("empty prefix matches everything at equal score (typst's order wins)", () => {
    expect(scoreCompletion("image", "")).toBe(0);
    expect(scoreCompletion("zzz", "")).toBe(0);
  });

  test("bands never overlap: prefix beats initials beats subsequence", () => {
    const exact = scoreCompletion("image", "im")!;
    const insensitive = scoreCompletion("Image", "im")!;
    const initials = scoreCompletion("inline-math", "im")!;
    const sub = scoreCompletion("line-numbering", "im")!; // i…m, but not a prefix
    expect(exact).toBeGreaterThan(insensitive);
    expect(insensitive).toBeGreaterThan(initials);
    expect(initials).toBeGreaterThan(sub);
  });

  test("camelCase and separators both form word initials", () => {
    expect(scoreCompletion("page-break", "pb")).not.toBeNull();
    expect(scoreCompletion("toString", "tS")).not.toBeNull();
  });

  test("non-matches are dropped", () => {
    expect(scoreCompletion("align", "im")).toBeNull();
    expect(scoreCompletion("box", "zzz")).toBeNull();
  });

  test("shorter labels win inside a band", () => {
    expect(scoreCompletion("box", "bo")!).toBeGreaterThan(scoreCompletion("bookmark", "bo")!);
  });
});

describe("rankCompletions", () => {
  test("the bug: typing `im` against typst's scope order surfaces image", () => {
    // typst-ide returns the whole scope unfiltered; slicing before ranking (the
    // old behaviour) showed `align, alt, arguments, …` and never `image`.
    const scope = items(
      "align", "alt", "arguments", "array", "assert", "auto", "below",
      "bibliography", "block", "bool", "box", "bytes", "calc", "circle",
      "cite", "columns", "image", "import", "include",
    );
    expect(labels(rankCompletions(scope, "im", 5))[0]).toBe("image");
  });

  test("truncation happens after ranking, not before", () => {
    const scope = items(...Array.from({ length: 100 }, (_, i) => `filler${i}`), "image");
    expect(labels(rankCompletions(scope, "image", 20))).toEqual(["image"]);
  });

  test("empty prefix keeps the server order", () => {
    expect(labels(rankCompletions(items("b", "a", "c"), "", 2))).toEqual(["b", "a"]);
  });

  test("ties keep the server order (locals before globals)", () => {
    expect(labels(rankCompletions(items("myvar", "myval"), "my", 2))).toEqual(["myvar", "myval"]);
  });
});

describe("wordStartBefore", () => {
  test("walks back over the identifier only", () => {
    //            0123456789
    expect(wordStartBefore("set image", 0, 9)).toBe(4);
    expect(wordStartBefore("page-break", 0, 10)).toBe(0); // hyphens are word chars
  });

  test("stops at the cursor when there's no word", () => {
    expect(wordStartBefore("foo ", 0, 4)).toBe(4);
  });

  test("returns a doc offset, not a line offset", () => {
    expect(wordStartBefore("set image", 100, 109)).toBe(104);
  });
});

describe("autoTriggerApplies", () => {
  test("fires after # @ .", () => {
    expect(autoTriggerApplies("#")).toBe(true);
    expect(autoTriggerApplies("text @")).toBe(true);
    expect(autoTriggerApplies("foo.")).toBe(true);
  });

  test("fires after a 2+ char word", () => {
    expect(autoTriggerApplies("im")).toBe(true);
    expect(autoTriggerApplies("some image")).toBe(true);
  });

  test("keeps firing while typing an identifier after a sigil (no flicker)", () => {
    // The single-char-after-sigil state used to clear the strip; these must
    // all trigger so `#` → `#i` → `#im` stays continuously open.
    expect(autoTriggerApplies("#i")).toBe(true);
    expect(autoTriggerApplies("#im")).toBe(true);
    expect(autoTriggerApplies("text @r")).toBe(true);
    expect(autoTriggerApplies("dict.k")).toBe(true);
  });

  test("declines on a 1-char word", () => {
    expect(autoTriggerApplies("a")).toBe(false);
  });

  test("declines inside a line comment", () => {
    expect(autoTriggerApplies("// some note")).toBe(false);
    expect(autoTriggerApplies("code // foo.")).toBe(false);
  });
});
