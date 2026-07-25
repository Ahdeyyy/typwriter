import { describe, expect, test } from "bun:test";
import { convert } from "./convert";

describe("convert", () => {
  test("paragraph → list applies a marker per line", () => {
    expect(convert("one\ntwo", "bullet")).toBe("- one\n- two");
    expect(convert("one\ntwo", "numbered")).toBe("1. one\n2. two");
  });

  test("list → paragraph strips the markers", () => {
    expect(convert("- one\n- two", "paragraph")).toBe("one\ntwo");
    expect(convert("1. one\n2. two", "paragraph")).toBe("one\ntwo");
  });

  test("converting between list kinds does not stack markers", () => {
    expect(convert(convert("one\ntwo", "bullet"), "numbered")).toBe(
      "1. one\n2. two",
    );
  });

  test("heading level is replaced, not appended", () => {
    expect(convert("= Title", "h3")).toBe("=== Title");
    expect(convert("=== Title", "paragraph")).toBe("Title");
  });

  test("a multi-line block collapses into a single heading line", () => {
    expect(convert("one\ntwo", "h2")).toBe("== one two");
  });

  test("quote wraps, and converting back unwraps", () => {
    const quoted = convert("cited words", "quote");
    expect(quoted).toBe("#quote(block: true)[\ncited words\n]");
    expect(convert(quoted, "paragraph")).toBe("cited words");
  });

  test("indentation survives a list conversion", () => {
    expect(convert("  nested", "bullet")).toBe("  - nested");
  });

  test("blank lines keep no marker", () => {
    expect(convert("one\n\ntwo", "bullet")).toBe("- one\n\n- two");
  });
});
