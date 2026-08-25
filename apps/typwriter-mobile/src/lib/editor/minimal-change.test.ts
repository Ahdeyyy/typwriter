import { describe, expect, it } from "bun:test";
import { minimalChange } from "./minimal-change";

/** Apply a change the way CodeMirror would, so a test can assert on the result
 *  rather than only on the offsets. */
function apply(text: string, change: ReturnType<typeof minimalChange>): string {
  if (!change) return text;
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}

describe("minimalChange", () => {
  it("reports nothing for identical text", () => {
    expect(minimalChange("= Hello\n", "= Hello\n")).toBeNull();
  });

  it("narrows an edit in the middle to just that span", () => {
    // The point of the whole module: the caret sits outside this range, so
    // CodeMirror leaves it where the reader had it.
    const before = "= Title\n\nsome text here\n\n= End\n";
    const after = "= Title\n\nsome TEXT here\n\n= End\n";
    const change = minimalChange(before, after);
    expect(change).not.toBeNull();
    expect(change!.from).toBe(14);
    expect(change!.to).toBe(18);
    expect(change!.insert).toBe("TEXT");
    expect(apply(before, change)).toBe(after);
  });

  it("handles a pure insertion as a zero-width replacement", () => {
    const change = minimalChange("ab", "aXb");
    expect(change).toEqual({ from: 1, to: 1, insert: "X" });
  });

  it("handles a pure deletion as an empty insert", () => {
    const change = minimalChange("aXb", "ab");
    expect(change).toEqual({ from: 1, to: 1 + 1, insert: "" });
  });

  it("handles appending to the end", () => {
    const change = minimalChange("line one\n", "line one\nline two\n");
    expect(change!.from).toBe(9);
    expect(change!.to).toBe(9);
    expect(change!.insert).toBe("line two\n");
  });

  it("handles prepending a line", () => {
    // Note the change does *not* start at 0: "line " is genuinely shared with
    // what follows it, so the minimal edit begins after that run. What matters
    // is that applying it reproduces the new text exactly.
    const before = "line two\n";
    const after = "line one\nline two\n";
    expect(apply(before, minimalChange(before, after))).toBe(after);
  });

  it("prepends at 0 when the texts share no leading run", () => {
    const change = minimalChange("beta\n", "alpha\nbeta\n");
    expect(change).toEqual({ from: 0, to: 0, insert: "alpha\n" });
  });

  it("replaces everything when nothing is shared", () => {
    const change = minimalChange("abc", "xyz");
    expect(change).toEqual({ from: 0, to: 3, insert: "xyz" });
  });

  it("handles an empty document in either direction", () => {
    expect(minimalChange("", "new")).toEqual({ from: 0, to: 0, insert: "new" });
    expect(minimalChange("old", "")).toEqual({ from: 0, to: 3, insert: "" });
  });

  it("never lets the prefix and suffix scans overlap", () => {
    // "aaaa" -> "aa": a naive suffix scan would run back through the prefix and
    // produce a negative-width range. The guard caps it, so `to >= from`.
    const change = minimalChange("aaaa", "aa");
    expect(change!.to).toBeGreaterThanOrEqual(change!.from);
    expect(apply("aaaa", change)).toBe("aa");
  });

  it("round-trips a repeated-run edit", () => {
    const before = "xxxxxxxx";
    const after = "xxxx";
    expect(apply(before, minimalChange(before, after))).toBe(after);
  });

  it("keeps a surrogate pair intact", () => {
    // Scanning code units could otherwise split an emoji across the boundary
    // and hand CodeMirror an offset inside a character.
    const before = "a😀b";
    const after = "a😀c";
    const change = minimalChange(before, after);
    expect(apply(before, change)).toBe(after);
    expect(change!.from).toBe(3);
  });
});
