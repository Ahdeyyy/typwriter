// Pull the prose out of a Typst syntax tree, a paragraph at a time, as plain
// text a spellchecker can read: `Some *bold* text with $x$ math` becomes
// "Some bold text with math", with a map from every character back to the
// source. Code, math, raw text, labels, references, links, strings and
// comments are left out, while the content blocks inside code
// (`#link(..)[here]`, `#figure(caption: [..])`) stay in.
//
// Chunks are the unit of caching: a chunk's text is its own cache key, so
// typing in one paragraph never re-checks another.

import type { Tree } from "@lezer/common";
import { Type } from "codemirror-typst";

/** `text[textFrom, textTo)` came from `doc[docFrom, docTo)`. The two have the
 *  same length unless the piece was rewritten (a shorthand, an escape, a
 *  collapsed space); positions inside a rewritten piece map to its ends. */
export interface ProsePiece {
  textFrom: number;
  textTo: number;
  docFrom: number;
  docTo: number;
}

export interface ProseChunk {
  /** Source range from the first piece to the last. */
  from: number;
  to: number;
  text: string;
  pieces: ProsePiece[];
}

/** Subtrees with no prose to check. */
const SKIP = new Set<number>([
  Type.Raw,
  Type.Equation,
  Type.Label,
  Type.Ref,
  Type.Link,
  Type.Str,
  Type.LineComment,
  Type.BlockComment,
  Type.ModuleImport,
  Type.ModuleInclude,
  Type.Error,
]);

/** Nodes whose text is a paragraph of its own: a chunk never spans two.
 *  Content blocks are deliberately not among them — `#emph[..]` and
 *  `#link(..)[..]` sit mid-sentence, and a block that stands on its own lines
 *  is split off by the line rule in `push` anyway. */
const BLOCKS = new Set<number>([Type.Document, Type.Heading, Type.ListItem, Type.EnumItem, Type.TermItem]);

const SHORTHANDS: Record<string, string> = {
  "~": " ",
  "--": "–",
  "---": "—",
  "...": "…",
  "-?": "",
};

/** Past this, a chunk is cut at the next sentence end — the device service
 *  is happier with short texts, and a smaller chunk re-checks for less. */
const SOFT_LIMIT = 1200;
/** Past this, a chunk is cut at the next space, sentence end or not. */
const HARD_LIMIT = 2400;

const HAS_LETTER = /\p{L}/u;
const SENTENCE_END = /[.!?:;]["'”’)]*$/;

/**
 * The prose chunks in `[from, to)` of a Typst document. Callers widen the
 * range to paragraph boundaries; a chunk cut by the range edge is still
 * returned, just shorter.
 */
export function extractProse(
  tree: Tree,
  slice: (from: number, to: number) => string,
  from: number,
  to: number,
): ProseChunk[] {
  const chunks: ProseChunk[] = [];
  let text = "";
  let pieces: ProsePiece[] = [];
  let chunkBlock = -1;
  const blocks: number[] = [];

  const flush = () => {
    // A trailing space adds nothing and would end every cache key. Spaces
    // only ever arrive as one-character pieces of their own.
    if (text.endsWith(" ")) {
      pieces.pop();
      text = text.slice(0, -1);
    }
    if (pieces.length && HAS_LETTER.test(text)) {
      chunks.push({
        from: pieces[0]!.docFrom,
        to: pieces[pieces.length - 1]!.docTo,
        text,
        pieces,
      });
    }
    text = "";
    pieces = [];
    chunkBlock = -1;
  };

  /** Source end of the last piece that wasn't a space. */
  let lastWordEnd = -1;

  const push = (out: string, docFrom: number, docTo: number) => {
    const block = blocks[blocks.length - 1] ?? -1;
    if (pieces.length && (block !== chunkBlock || codeLineBetween(slice(lastWordEnd, docFrom)))) flush();
    if (!pieces.length) {
      // A chunk never starts with a space.
      if (out === " ") return;
      chunkBlock = block;
    }
    if (out === "") return;
    if (out !== " ") lastWordEnd = docTo;
    pieces.push({ textFrom: text.length, textTo: text.length + out.length, docFrom, docTo });
    text += out;
  };

  const pushSpace = (docFrom: number, docTo: number, sentenceBreak: boolean) => {
    if (!pieces.length || text.endsWith(" ")) return;
    if (text.length >= HARD_LIMIT || (sentenceBreak && text.length >= SOFT_LIMIT && SENTENCE_END.test(text))) {
      flush();
      return;
    }
    push(" ", docFrom, docTo);
  };

  tree.iterate({
    from,
    to,
    enter(node) {
      const type = node.type.id;
      if (SKIP.has(type)) return false;
      if (BLOCKS.has(type)) {
        blocks.push(node.from * 256 + type);
        return;
      }
      switch (type) {
        case Type.Text:
        case Type.SmartQuote:
          push(slice(node.from, node.to), node.from, node.to);
          return false;
        case Type.Space:
          pushSpace(node.from, node.to, true);
          return false;
        case Type.Linebreak:
          pushSpace(node.from, node.to, false);
          return false;
        case Type.Parbreak:
          flush();
          return false;
        case Type.Shorthand: {
          const out = SHORTHANDS[slice(node.from, node.to)];
          if (out === " ") pushSpace(node.from, node.to, false);
          else if (out !== undefined) push(out, node.from, node.to);
          return false;
        }
        case Type.Escape: {
          const raw = slice(node.from, node.to);
          // `\#`, `\*`: the character itself. Unicode escapes say nothing to
          // a spellchecker. An escaped space would end the chunk on a space
          // `flush` can't tell from a real one, so it's left out.
          if (raw.length === 2 && raw[1] !== " ") push(raw[1]!, node.from, node.to);
          return false;
        }
      }
    },
    leave(node) {
      if (BLOCKS.has(node.type.id)) {
        if (blocks[blocks.length - 1] === node.from * 256 + node.type.id) blocks.pop();
      }
    },
  });
  flush();
  return chunks;
}

/** Whether skipped source between two words is code on a line of its own
 *  (`#let`, `#set`, a call spread over lines, the end of a content block)
 *  rather than inline markup like `*` or `_` at a line end. */
function codeLineBetween(gap: string): boolean {
  return gap.includes("\n") && /[#[\]{}()]/.test(gap);
}

/** The source range a `[start, end)` span of `chunk.text` came from. */
export function chunkRangeToDoc(chunk: ProseChunk, start: number, end: number): { from: number; to: number } | null {
  if (end <= start) return null;
  const first = pieceAt(chunk.pieces, start);
  const last = pieceAt(chunk.pieces, end - 1);
  if (!first || !last) return null;
  const from = isExact(first) ? first.docFrom + (start - first.textFrom) : first.docFrom;
  const to = isExact(last) ? last.docFrom + (end - last.textFrom) : last.docTo;
  return to > from ? { from, to } : null;
}

function isExact(piece: ProsePiece): boolean {
  return piece.textTo - piece.textFrom === piece.docTo - piece.docFrom;
}

function pieceAt(pieces: ProsePiece[], offset: number): ProsePiece | null {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const piece = pieces[mid]!;
    if (offset < piece.textFrom) hi = mid - 1;
    else if (offset >= piece.textTo) lo = mid + 1;
    else return piece;
  }
  return null;
}
