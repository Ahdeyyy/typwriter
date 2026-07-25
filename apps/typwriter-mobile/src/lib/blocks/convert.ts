// Block conversions — pure text rewrites of a block's source.
//
// Every conversion strips whatever line prefixes the block currently carries
// and applies the new ones, so converting back and forth doesn't accumulate
// markers. The result is spliced in through the normal commit path, which is
// what keeps the document's partition intact.

export type ConversionId =
  | "h1"
  | "h2"
  | "h3"
  | "paragraph"
  | "bullet"
  | "numbered"
  | "quote";

export const CONVERSIONS: { id: ConversionId; label: string; glyph: string }[] =
  [
    { id: "h1", label: "Heading 1", glyph: "H1" },
    { id: "h2", label: "Heading 2", glyph: "H2" },
    { id: "h3", label: "Heading 3", glyph: "H3" },
    { id: "paragraph", label: "Paragraph", glyph: "¶" },
    { id: "bullet", label: "Bulleted list", glyph: "•" },
    { id: "numbered", label: "Numbered list", glyph: "1." },
    { id: "quote", label: "Quote", glyph: "❝" },
  ];

/** Leading heading / list / enum marker on a line, with its indentation. */
const MARKER = /^(\s*)(?:=+[ \t]+|[-+][ \t]+|\d+\.[ \t]+)/;

/** A whole block wrapped in a `#quote[…]` (the quote conversion's output). */
const QUOTE = /^#quote\(block:\s*true\)\[\n?([\s\S]*?)\n?\]$/;

function unwrap(text: string): string {
  const quoted = QUOTE.exec(text.trim());
  return quoted ? quoted[1] : text;
}

function stripMarkers(text: string): string[] {
  return unwrap(text)
    .split("\n")
    .map((line) => line.replace(MARKER, "$1"));
}

/** Rewrite `text` as the given kind. */
export function convert(text: string, id: ConversionId): string {
  const lines = stripMarkers(text);

  switch (id) {
    case "h1":
    case "h2":
    case "h3": {
      // A heading is a single line, so a multi-line block collapses into one.
      const level = Number(id[1]);
      const body = lines.join(" ").replace(/\s+/g, " ").trim();
      return `${"=".repeat(level)} ${body}`;
    }
    case "paragraph":
      return lines.join("\n");
    case "bullet":
      return prefixLines(lines, () => "- ");
    case "numbered": {
      let n = 0;
      return prefixLines(lines, () => `${++n}. `);
    }
    case "quote":
      return `#quote(block: true)[\n${lines.join("\n")}\n]`;
  }
}

/** Apply a marker to every non-blank line, preserving its indentation. */
function prefixLines(lines: string[], marker: () => string): string {
  return lines
    .map((line) => {
      if (!line.trim()) return line;
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      return `${indent}${marker()}${line.slice(indent.length)}`;
    })
    .join("\n");
}
