// Block segmentation — the Notion-style surface's model of the document.
//
// A block list is a **partition of the source text**, never an AST
// re-serialization: every offset of the file belongs to exactly one block,
// blocks are sorted and gap-free, and concatenating them reproduces the file
// character-for-character. Round-tripping is therefore lossless by
// construction — a `#show` rule or a construct the segmenter doesn't
// understand can never be corrupted, worst case it lands in a `script` block
// and renders as source.
//
// Offsets are UTF-16 code units (CodeMirror's unit), converted to UTF-8 bytes
// only at the IPC boundary.

import { NodeProp, type Tree } from "@lezer/common";
import { typstLanguage } from "$lib/editor/typst-lang";

export type BlockKind =
  | "heading" // = / == / === … line
  | "paragraph" // contiguous markup lines between parbreaks
  | "list" // contiguous -, +, or n. items (one block per contiguous run)
  | "math" // block math  $ … $  (multiline or spaced form)
  | "raw" // ``` fenced raw block
  | "script" // top-level #set/#show/#let/#import/#include/code expr
  | "blank"; // run of blank lines — rendered as inter-block spacing

export interface Block {
  /** Stable across re-segmentation (see `assignIds`) so keyed-each state — the
   *  active block, its mounted editor, scroll position — survives typing. */
  id: string;
  kind: BlockKind;
  /** Start offset; `[from, to)` spans partition the document. */
  from: number;
  to: number;
  /** End of the block's *content*, i.e. `to` minus trailing whitespace. The
   *  span keeps the whitespace so the partition stays gap-free; the editor and
   *  the fragment renderer use `contentTo` so a block doesn't drag a stray
   *  blank line around. */
  contentTo: number;
  /** Hash of the block's text, used to carry ids across re-segmentation
   *  without keeping the previous document around. */
  hash: string;
}

/** Kinds that never merge with a neighbour, even a neighbour of the same kind:
 *  each heading / block equation / raw fence / script statement is its own
 *  block. `paragraph` and `list` accumulate contiguous units instead. */
const SOLO_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
  "heading",
  "math",
  "raw",
  "script",
]);

/** What one top-level syntax node contributes to the block stream. */
type UnitKind = BlockKind | "inline" | "space";

interface Unit {
  kind: UnitKind;
  from: number;
  to: number;
}

/** Classify one top-level node. Anything code-flavoured — or that the parser
 *  gave up on — becomes `script`: when in doubt, show source. */
function classify(
  name: string,
  groups: readonly string[] | undefined,
  text: string,
): UnitKind {
  switch (name) {
    case "Parbreak":
      return "blank";
    case "Space":
      return "space";
    case "Heading":
      return "heading";
    case "ListItem":
    case "EnumItem":
    case "TermItem":
      return "list";
    case "Raw":
      // Fenced (```) raw is a block of its own; inline `code` stays in the
      // paragraph it was typed in.
      return text.startsWith("```") ? "raw" : "inline";
    case "Equation":
      return isBlockEquation(text) ? "math" : "inline";
    case "LineComment":
    case "BlockComment":
    case "Error":
      return "script";
    default:
      // `Code` is the node-set group every code construct carries (including
      // keywords and operators), so this catches `#let` / `#set` / `#show` /
      // `#import` / bare code exprs without enumerating node names.
      return groups?.includes("Code") ? "script" : "inline";
  }
}

/** Typst renders `$…$` as a display equation when the delimiters are separated
 *  from the body by whitespace (which includes the multi-line form). */
function isBlockEquation(text: string): boolean {
  if (text.includes("\n")) return true;
  return /^\$\s/.test(text) && /\s\$$/.test(text);
}

/** Whether `pos` is preceded only by blank space on its line. */
function startsLine(doc: string, pos: number): boolean {
  let i = pos - 1;
  while (i >= 0 && (doc[i] === " " || doc[i] === "\t")) i--;
  return i < 0 || doc[i] === "\n";
}

/** Collect the document's top-level nodes in order. */
function topLevelUnits(tree: Tree, doc: string): Unit[] {
  const units: Unit[] = [];
  const cursor = tree.cursor();
  if (!cursor.firstChild()) return units;
  do {
    units.push({
      kind: classify(
        cursor.name,
        cursor.type.prop(NodeProp.group),
        doc.slice(cursor.from, cursor.to),
      ),
      from: cursor.from,
      to: cursor.to,
    });
  } while (cursor.nextSibling());
  return units;
}

/** Segment `doc` given its already-parsed syntax `tree`. */
export function segmentTree(tree: Tree, doc: string): Block[] {
  if (doc.length === 0) {
    // An empty document still needs one block to tap into and start typing.
    return [
      {
        id: "",
        kind: "paragraph",
        from: 0,
        to: 0,
        contentTo: 0,
        hash: hashText(""),
      },
    ];
  }

  interface Draft {
    kind: BlockKind;
    from: number;
    to: number;
    solo: boolean;
  }
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (const unit of topLevelUnits(tree, doc)) {
    if (unit.kind === "space") {
      // Whitespace never starts a block; it trails the block before it so the
      // partition stays gap-free.
      if (current) current.to = unit.to;
      else
        current = { kind: "blank", from: unit.from, to: unit.to, solo: false };
      continue;
    }
    if (unit.kind === "blank") {
      if (current?.kind === "blank") {
        current.to = unit.to;
      } else {
        if (current) drafts.push(current);
        current = { kind: "blank", from: unit.from, to: unit.to, solo: false };
      }
      continue;
    }

    // A `#call` is only a script *block* when it opens one: mid-sentence code
    // (`Hello #emph[world]`) and code continuing an open paragraph belong to
    // the prose around them, not to a code chip of their own.
    const inlineCode: boolean =
      unit.kind === "script" &&
      (!startsLine(doc, unit.from) ||
        (current?.kind === "paragraph" && !current.solo));
    const kind: BlockKind =
      unit.kind === "inline" || inlineCode
        ? "paragraph"
        : (unit.kind as BlockKind);
    const solo = SOLO_KINDS.has(kind);
    const joins =
      current !== null && !current.solo && !solo && current.kind === kind;
    if (joins && current) {
      current.to = unit.to;
    } else {
      if (current) drafts.push(current);
      current = { kind, from: unit.from, to: unit.to, solo };
    }
  }
  if (current) drafts.push(current);
  if (drafts.length === 0) {
    drafts.push({ kind: "blank", from: 0, to: doc.length, solo: false });
  }

  // Normalize into a strict partition. The parser is expected to cover the
  // whole document, but forcing the invariant here means a parser gap can
  // never silently drop text on a commit-splice.
  drafts[0].from = 0;
  for (let i = 0; i < drafts.length - 1; i++) drafts[i].to = drafts[i + 1].from;
  drafts[drafts.length - 1].to = doc.length;

  return drafts.map((d) => {
    const text = doc.slice(d.from, d.to);
    return {
      id: "",
      kind: d.kind,
      from: d.from,
      to: d.to,
      contentTo: d.from + text.replace(/\s+$/, "").length,
      hash: hashText(text),
    };
  });
}

/** Parse and segment `doc` in one step, carrying ids over from `previous`. */
export function segment(doc: string, previous: Block[] = []): Block[] {
  return assignIds(segmentTree(typstLanguage.parser.parse(doc), doc), previous);
}

// ─── Stable ids ────────────────────────────────────────────────────────────────

let idCounter = 0;

function freshId(): string {
  return `b${++idCounter}`;
}

/** FNV-1a over the block's text — cheap and good enough to recognise a block
 *  that merely moved. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Carry ids from `previous` onto `next` (mutating and returning `next`).
 *
 * Blocks matching an old block by (kind, content) keep its id, so inserting a
 * paragraph doesn't renumber everything below it. Whatever is left over is
 * paired in order — that's the block being typed in, whose content changed but
 * whose identity shouldn't: its mounted editor must not be torn down mid-edit.
 */
export function assignIds(next: Block[], previous: Block[]): Block[] {
  const byContent = new Map<string, string[]>();
  for (const block of previous) {
    const key = `${block.kind}:${block.hash}`;
    const bucket = byContent.get(key);
    if (bucket) bucket.push(block.id);
    else byContent.set(key, [block.id]);
  }

  const unmatched: number[] = [];
  for (let i = 0; i < next.length; i++) {
    const block = next[i];
    const id = byContent.get(`${block.kind}:${block.hash}`)?.shift();
    if (id) block.id = id;
    else unmatched.push(i);
  }

  const taken = new Set(next.map((b) => b.id).filter(Boolean));
  const leftover = previous.map((b) => b.id).filter((id) => !taken.has(id));
  for (let i = 0; i < unmatched.length; i++) {
    next[unmatched[i]].id = leftover[i] ?? freshId();
  }
  return next;
}
