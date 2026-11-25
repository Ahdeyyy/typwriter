import { describe, expect, test } from "bun:test";
import { parser } from "codemirror-typst";
import { chunkRangeToDoc, extractProse } from "./prose";

function prose(src: string) {
  const tree = parser.parse(src);
  return extractProse(tree, (from, to) => src.slice(from, to), 0, src.length);
}

const texts = (src: string) => prose(src).map((chunk) => chunk.text);

describe("extractProse", () => {
  test("drops markup, math, code and references but keeps their prose", () => {
    expect(
      texts('Some *bold* text with $x^2$ math, a #link("http://x")[link here] and @ref.'),
    ).toEqual(["Some bold text with math, a link here and"]);
  });

  test("headings, list items and paragraphs are separate chunks", () => {
    expect(texts("= Intro heading\nFirst para\ncontinues.\n\n- list itme one\n- two")).toEqual([
      "Intro heading",
      "First para continues.",
      "list itme one",
      "two",
    ]);
  });

  test("skips comments, strings, raw text and imports", () => {
    expect(
      texts('#import "x.typ": y\n// comment wrods\nText `raw wrods` here /* blok */ end.'),
    ).toEqual(["Text here end."]);
  });

  test("code statements on their own lines split chunks; content inside them is prose", () => {
    expect(texts("Before.\n#let x = [content *here*]\nAfter.")).toEqual(["Before.", "content here", "After."]);
    expect(texts("#figure(caption: [A capshun])[]")).toEqual(["A capshun"]);
  });

  test("smart quotes and shorthands become ordinary characters", () => {
    expect(texts(`It's "quoted" -- dash~here.`)).toEqual(["It's \"quoted\" – dash here."]);
  });

  test("maps chunk offsets back to the source", () => {
    const src = "A *bold* wrod -- and $x$ thign.";
    const [chunk] = prose(src);
    expect(chunk!.text).toBe("A bold wrod – and thign.");
    const at = (word: string) => {
      const start = chunk!.text.indexOf(word);
      const range = chunkRangeToDoc(chunk!, start, start + word.length)!;
      return src.slice(range.from, range.to);
    };
    expect(at("bold")).toBe("bold");
    expect(at("wrod")).toBe("wrod");
    expect(at("thign")).toBe("thign");
    // A rewritten piece maps to its whole source.
    expect(at("–")).toBe("--");
  });

  test("a chunk with no letters is dropped", () => {
    expect(texts("#let x = 1\n\n... -- 123")).toEqual([]);
  });

  test("long paragraphs are cut at sentence ends", () => {
    const sentence = "This sentence is long enough to count for something here. ";
    const chunks = texts(sentence.repeat(60));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2400);
      expect(chunk.endsWith(".")).toBe(true);
    }
  });
});
