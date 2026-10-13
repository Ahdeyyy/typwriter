import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parser } from "./typst-lang/lezer-typst";

export type CompletionScope = "markup" | "code" | "string" | "raw" | "raw-language" | "comment" | "math" | "reference";

const trees = new WeakMap<EditorState, Tree>();

/** Recovery can omit comment trivia. Scan only the gap after parsed children,
 * excluding strings and raw text already represented by the tree. */
function commentInGap(state: EditorState, pos: number, node: SyntaxNode): boolean {
  if (!node.firstChild) return false;
  const from = node.childBefore(pos)?.to ?? node.from;
  let depth = 0;
  let line = false;
  for (const token of state.doc.sliceString(from, pos).matchAll(/\/\*|\*\/|\/\/|[\r\n]/g)) {
    if (line) {
      if (token[0] === "\r" || token[0] === "\n") line = false;
    } else if (token[0] === "/*") depth++;
    else if (depth && token[0] === "*/") depth--;
    else if (!depth && token[0] === "//") line = true;
  }
  return line || depth > 0;
}

function completionTree(state: EditorState): Tree {
  const tree = syntaxTree(state);
  if (tree.topNode.name === "Document" && tree.length === state.doc.length) return tree;
  let fallback = trees.get(state);
  if (!fallback) {
    fallback = parser.parse(state.doc.toString());
    trees.set(state, fallback);
  }
  return fallback;
}

/** Use the outer Typst tree so embedded raw languages remain raw to the IDE. */
export function completionScope(state: EditorState): CompletionScope {
  const pos = state.selection.main.head;
  for (let node: SyntaxNode | null = completionTree(state).resolve(pos, -1); node; node = node.parent) {
    if (node.name === "LineComment") return "comment";
    if (node.name === "BlockComment") {
      if (pos === node.to && state.doc.sliceString(node.to - 2, node.to) === "*/") continue;
      return "comment";
    }
    if (node.name === "Raw") {
      const open = node.firstChild;
      const lang = open?.nextSibling;
      if (open && open.to - open.from >= 3 && pos >= open.to &&
        pos <= (lang?.name === "RawLang" ? lang.to : open.to)) return "raw-language";
      const close = node.lastChild;
      if (pos === node.to && close?.name === "RawDelim" && close.from > node.from) continue;
      return "raw";
    }
    if (node.name === "Str" || node.name === "StrContent") return "string";
    if (commentInGap(state, pos, node)) return "comment";
    // While a field access is incomplete the hand-written parser can leave its
    // dot as markup text next to the code expression. It is still a code query.
    if (node.name === "Text" && node.prevSibling?.type.is("Code") &&
      /^\.[\p{L}\p{M}\p{N}_-]*$/u.test(state.doc.sliceString(node.from, pos))) return "code";
    if (node.name === "ContentBlock" || node.name === "Document") return "markup";
    if (node.name === "Equation" || node.type.is("Math")) return "math";
    if (node.name === "Ref" || node.name === "Label") return "reference";
    if (node.type.is("Code")) return "code";
    if (node.name === "Link") return "raw";
  }
  return "markup";
}

export interface CompletionSnapshot {
  text: string;
  from: number;
  to: number;
  scope: CompletionScope;
}

/** Re-filter only edits within the same prefix and unchanged surrounding syntax. */
export function canReuseCompletions(snapshot: CompletionSnapshot, state: EditorState): boolean {
  const { from, to, text, scope } = snapshot;
  const sel = state.selection.main;
  if (!sel.empty || sel.head < from || completionScope(state) !== scope) return false;
  if (state.doc.sliceString(0, from) !== text.slice(0, from)) return false;
  if (state.doc.sliceString(sel.head) !== text.slice(to)) return false;
  const prefix = state.doc.sliceString(from, sel.head);
  const original = text.slice(from, to);
  if (prefix === original) return true;
  // Spaces are part of font families and file names. A slash, quote, escape or
  // delimiter changes the semantic query and must wait for a fresh response.
  if (scope === "string") {
    const segmentStart = Math.max(original.startsWith('"') ? 1 : 0, original.lastIndexOf("/") + 1);
    return prefix.startsWith(original.slice(0, segmentStart)) &&
      /^[\p{L}\p{M}\p{N}_. -]*$/u.test(prefix.slice(segmentStart));
  }
  const marker = original.match(/^[#@.]/)?.[0] ?? "";
  if (!prefix.startsWith(marker)) return false;
  const word = prefix.slice(marker.length);
  return scope === "reference"
    ? /^[\p{L}\p{M}\p{N}_:.-]*$/u.test(word)
    : /^[\p{L}\p{M}\p{N}_-]*$/u.test(word);
}
