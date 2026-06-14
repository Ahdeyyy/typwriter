import { expect, test, describe } from "bun:test";
import { autoTriggerApplies, toStripItem, typstApplyToSnippet } from "./completion-logic";
import type { IpcCompletion } from "$lib/ipc/types";

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

  test("declines on a 1-char word", () => {
    expect(autoTriggerApplies("a")).toBe(false);
  });

  test("declines inside a line comment", () => {
    expect(autoTriggerApplies("// some note")).toBe(false);
    expect(autoTriggerApplies("code // foo.")).toBe(false);
  });
});
