// Segmentation invariants. The block surface's whole safety argument rests on
// these: if the partition is ever lossy, committing an edit corrupts the file.

import { describe, expect, test } from "bun:test";
import { segment, type Block, type BlockKind } from "./segment";

const SAMPLE = `= Introduction

Some prose that runs
across two source lines.

- first item
- second item

#set page(margin: 2cm)

$ x^2 + y^2 = z^2 $

\`\`\`rust
fn main() {}
\`\`\`

Closing paragraph.
`;

function kinds(blocks: Block[]): BlockKind[] {
  return blocks.filter((b) => b.kind !== "blank").map((b) => b.kind);
}

function assertPartition(doc: string, blocks: Block[]) {
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks[0].from).toBe(0);
  expect(blocks[blocks.length - 1].to).toBe(doc.length);
  for (let i = 0; i < blocks.length; i++) {
    expect(blocks[i].to).toBeGreaterThanOrEqual(blocks[i].from);
    if (i > 0) expect(blocks[i].from).toBe(blocks[i - 1].to);
  }
  expect(blocks.map((b) => doc.slice(b.from, b.to)).join("")).toBe(doc);
}

describe("segment", () => {
  test("partitions the document losslessly", () => {
    assertPartition(SAMPLE, segment(SAMPLE));
  });

  test("is idempotent", () => {
    const once = segment(SAMPLE);
    const twice = segment(SAMPLE, once);
    expect(twice.map((b) => [b.kind, b.from, b.to])).toEqual(
      once.map((b) => [b.kind, b.from, b.to]),
    );
  });

  test("recognises each block kind", () => {
    expect(kinds(segment(SAMPLE))).toEqual([
      "heading",
      "paragraph",
      "list",
      "script",
      "math",
      "raw",
      "paragraph",
    ]);
  });

  test("keeps a contiguous list run in one block", () => {
    const doc = "- a\n- b\n- c\n";
    const lists = segment(doc).filter((b) => b.kind === "list");
    expect(lists).toHaveLength(1);
    expect(doc.slice(lists[0].from, lists[0].contentTo)).toBe("- a\n- b\n- c");
  });

  test("splits list runs across a blank line", () => {
    const doc = "- a\n- b\n\n- c\n";
    expect(segment(doc).filter((b) => b.kind === "list")).toHaveLength(2);
  });

  test("gives each heading its own block", () => {
    const doc = "= One\n== Two\n";
    expect(kinds(segment(doc))).toEqual(["heading", "heading"]);
  });

  test("treats top-level code as script, inline code as prose", () => {
    expect(kinds(segment("#let x = 1\n"))).toEqual(["script"]);
    expect(kinds(segment("#show heading: it => it\n"))).toEqual(["script"]);
    expect(kinds(segment('#import "a.typ": b\n'))).toEqual(["script"]);
    // An inline call inside prose stays part of the paragraph.
    expect(kinds(segment("Hello #emph[world] there.\n"))).toEqual([
      "paragraph",
    ]);
  });

  test("separates display math from inline math", () => {
    expect(kinds(segment("$ x = 1 $\n"))).toEqual(["math"]);
    expect(kinds(segment("A value $x$ inline.\n"))).toEqual(["paragraph"]);
  });

  test("contentTo excludes trailing whitespace but the span keeps it", () => {
    // The newline after the heading belongs to the heading's span (the
    // partition stays gap-free) but not to its content.
    const doc = "= Title\nBody.\n";
    const heading = segment(doc)[0];
    expect(doc.slice(heading.from, heading.contentTo)).toBe("= Title");
    expect(heading.to).toBe(8);
  });

  test("handles an empty document", () => {
    const blocks = segment("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].from).toBe(0);
    expect(blocks[0].to).toBe(0);
  });

  test("an edit inside one block leaves the other ids alone", () => {
    const before = segment(SAMPLE);
    const edited = SAMPLE.replace(
      "Closing paragraph.",
      "Closing paragraph, extended.",
    );
    const after = segment(edited, before);

    expect(after).toHaveLength(before.length);
    // Every block but the edited one keeps its identity…
    for (let i = 0; i < before.length - 1; i++) {
      expect(after[i].id).toBe(before[i].id);
    }
    // …and the edited block keeps its id too (paired as the only leftover), so
    // its mounted editor survives the re-segmentation.
    expect(after[after.length - 1].id).toBe(before[before.length - 1].id);
  });

  test("inserting a block does not renumber the ones after it", () => {
    const doc = "= One\n\nAlpha.\n\nBeta.\n";
    const before = segment(doc);
    const inserted = "= One\n\nAlpha.\n\nNew middle.\n\nBeta.\n";
    const after = segment(inserted, before);

    const betaBefore = before.find(
      (b) => doc.slice(b.from, b.contentTo) === "Beta.",
    );
    const betaAfter = after.find(
      (b) => inserted.slice(b.from, b.contentTo) === "Beta.",
    );
    expect(betaAfter?.id).toBe(betaBefore!.id);
  });

  test("unparseable input still partitions the document", () => {
    const doc = "#let broken( = [\n\nsome text $ unclosed\n";
    assertPartition(doc, segment(doc));
  });
});
