import { expect, test, describe } from "bun:test";
import { autoTriggerApplies, flattenSnippet } from "./completion-logic";
import type { IpcCompletion } from "$lib/ipc/types";

const c = (over: Partial<IpcCompletion>): IpcCompletion => ({
  kind: "func",
  label: "x",
  apply: null,
  detail: null,
  ...over,
});

describe("flattenSnippet", () => {
  test("single hole → flattened apply, cursor at hole", () => {
    const r = flattenSnippet(c({ label: "image", apply: "image(${})" }));
    expect(r.apply).toBe("image()");
    expect(r.cursorOffset).toBe(6);
  });

  test("multi-hole flattens all, cursor at first", () => {
    const r = flattenSnippet(c({ label: "figure", apply: "#figure(${}, caption: [${}])" }));
    expect(r.apply).toBe("#figure(, caption: [])");
    expect(r.cursorOffset).toBe("#figure(".length);
  });

  test("no-hole apply passes through with cursorOffset -1", () => {
    const r = flattenSnippet(c({ label: "pagebreak", apply: "pagebreak()" }));
    expect(r.apply).toBe("pagebreak()");
    expect(r.cursorOffset).toBe(-1);
  });

  test("null apply falls back to label", () => {
    const r = flattenSnippet(c({ label: "blue", apply: null }));
    expect(r.apply).toBe("blue");
    expect(r.cursorOffset).toBe(-1);
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
