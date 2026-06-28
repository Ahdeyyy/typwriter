import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { toggleLineComment, toggleBlockComment } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { KeyBinding } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export { toggleLineComment, toggleBlockComment };

type Command = (view: EditorView) => boolean;

function wrapWith(marker: string) {
  return (view: EditorView): boolean => {
    const { state, dispatch } = view;
    const markerLen = marker.length;

    const changes = state.changeByRange((range) => {
      const before = state.doc.sliceString(range.from - markerLen, range.from);
      const after = state.doc.sliceString(range.to, range.to + markerLen);

      // Cursor between markers (empty) or selection with markers just outside → unwrap
      if (before === marker && after === marker) {
        return {
          range: EditorSelection.cursor(range.from - markerLen),
          changes: [
            { from: range.from - markerLen, to: range.from, insert: "" },
            { from: range.to, to: range.to + markerLen, insert: "" },
          ],
        };
      }

      if (range.empty) {
        // Insert paired markers and place cursor between them
        return {
          range: EditorSelection.cursor(range.from + markerLen),
          changes: { from: range.from, insert: marker + marker },
        };
      }

      // Selection has markers inside it → unwrap
      const text = state.doc.sliceString(range.from, range.to);
      if (text.startsWith(marker) && text.endsWith(marker) && text.length >= markerLen * 2 + 1) {
        return {
          range: EditorSelection.range(range.from, range.to - markerLen * 2),
          changes: [
            { from: range.from, to: range.from + markerLen, insert: "" },
            { from: range.to - markerLen, to: range.to, insert: "" },
          ],
        };
      }

      // Wrap selection
      return {
        range: EditorSelection.range(range.from, range.to + markerLen * 2),
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
      };
    });

    if (changes.changes.empty) return false;
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBold = wrapWith("*");
export const toggleItalic = wrapWith("_");
export const toggleRawInline = wrapWith("`");
export const toggleStrikethrough = wrapWith("~");

// ── Active-format detection ────────────────────────────────────────────────

/** The formatting that applies at the current cursor — drives the toolbar's
 *  active (highlighted) buttons, Google-Docs style. Inline marks are resolved
 *  from the syntax tree (so the cursor can sit anywhere inside `*bold*`), while
 *  block-level state is read from the line text (cheap and exact). */
export interface FormatState {
  bold: boolean;
  italic: boolean;
  rawInline: boolean;
  /** 1–6 for a heading line, 0 for normal text. */
  headingLevel: number;
  bulletList: boolean;
  numberedList: boolean;
}

export function computeFormatState(view: EditorView): FormatState {
  const { state } = view;
  const pos = state.selection.main.head;

  let bold = false;
  let italic = false;
  let rawInline = false;
  try {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    for (; node; node = node.parent) {
      if (node.name === "Strong") bold = true;
      else if (node.name === "Emph") italic = true;
      else if (node.name === "Raw") rawInline = true;
    }
  } catch {
    // Non-Typst files may not expose a compatible tree; leave inline marks off.
  }

  const lineText = state.doc.lineAt(pos).text;
  const headingMatch = lineText.match(/^\s*(=+)\s/);

  return {
    bold,
    italic,
    rawInline,
    headingLevel: headingMatch ? headingMatch[1].length : 0,
    bulletList: /^\s*-\s/.test(lineText),
    numberedList: /^\s*(?:\+|\d+\.)\s/.test(lineText),
  };
}

// ── Heading level ──────────────────────────────────────────────────────────

/** Set every line in the selection to heading `level` (1–6), or to normal text
 *  when `level` is 0. Replaces any existing `=`-marker prefix in place. */
export function setHeadingLevel(level: number): Command {
  return (view) => {
    const { state } = view;
    const sel = state.selection.main;
    const firstLine = state.doc.lineAt(sel.from).number;
    const lastLine = state.doc.lineAt(sel.to).number;
    const insert = level > 0 ? "=".repeat(level) + " " : "";

    const changes = [];
    for (let n = firstLine; n <= lastLine; n++) {
      const line = state.doc.line(n);
      const m = line.text.match(/^(\s*)(=+\s+)?/);
      const indentLen = m?.[1].length ?? 0;
      const existingLen = m?.[2]?.length ?? 0;
      changes.push({
        from: line.from + indentLen,
        to: line.from + indentLen + existingLen,
        insert,
      });
    }

    view.dispatch(
      state.update({ changes, userEvent: "input", scrollIntoView: true }),
    );
    return true;
  };
}

// ── Lists ──────────────────────────────────────────────────────────────────

/** Toggle a leading line marker across the selected lines: remove it when every
 *  non-blank line already has it, otherwise add it. Blank lines are skipped. */
function toggleLinePrefix(detect: RegExp, marker: string): Command {
  return (view) => {
    const { state } = view;
    const sel = state.selection.main;
    const firstLine = state.doc.lineAt(sel.from).number;
    const lastLine = state.doc.lineAt(sel.to).number;

    const lines = [];
    for (let n = firstLine; n <= lastLine; n++) lines.push(state.doc.line(n));

    const relevant = lines.filter((l) => l.text.trim() !== "");
    const allMarked =
      relevant.length > 0 && relevant.every((l) => detect.test(l.text));

    const changes = [];
    for (const line of lines) {
      const indentLen = (line.text.match(/^\s*/)?.[0].length ?? 0);
      if (allMarked) {
        const m = line.text.match(detect);
        if (!m) continue;
        changes.push({
          from: line.from + indentLen,
          to: line.from + m[0].length,
          insert: "",
        });
      } else if (line.text.trim() !== "") {
        changes.push({ from: line.from + indentLen, insert: marker });
      }
    }

    if (changes.length === 0) return false;
    view.dispatch(
      state.update({ changes, userEvent: "input", scrollIntoView: true }),
    );
    return true;
  };
}

export const toggleBulletList = toggleLinePrefix(/^\s*- /, "- ");
export const toggleNumberedList = toggleLinePrefix(/^\s*(?:\+|\d+\.) /, "+ ");

/** Matches a list-item line: leading indent, a `-` / `+` / `N.` marker, the
 *  whitespace after it, and the item's content. */
const LIST_ITEM = /^(\s*)([-+]|(\d+)\.)(\s+)(.*)$/;

/** Enter handler for list items, Google-Docs / Markdown style:
 *  - On a non-empty item, start a fresh item below with the same marker
 *    (numbered markers increment); any text right of the cursor moves down.
 *  - On an empty item (marker with no content), strip the marker so the list
 *    ends and the cursor lands on a clean line.
 *  Returns false on anything that isn't a list item so the editor's normal
 *  Enter (newline + indent) runs instead. */
export function continueList(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const line = state.doc.lineAt(sel.head);
  const m = line.text.match(LIST_ITEM);
  if (!m) return false;

  const [, indent, marker, numStr, gap, content] = m;

  // Empty item → end the list: clear the line back to bare indentation.
  if (content.trim() === "") {
    view.dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: EditorSelection.cursor(line.from + indent.length),
        userEvent: "input",
        scrollIntoView: true,
      }),
    );
    return true;
  }

  // Non-empty item → open a new item, carrying any text after the cursor.
  const nextMarker = numStr ? `${parseInt(numStr, 10) + 1}.` : marker;
  const prefix = `\n${indent}${nextMarker}${gap}`;
  const trailing = line.text.slice(sel.head - line.from);
  view.dispatch(
    state.update({
      changes: { from: sel.head, to: line.to, insert: prefix + trailing },
      selection: EditorSelection.cursor(sel.head + prefix.length),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
}

// ── Block / inline insertions ──────────────────────────────────────────────

/** True when `pos` already sits at the start of its line. */
function atLineStart(view: EditorView, pos: number): boolean {
  return pos === view.state.doc.lineAt(pos).from;
}

/** Wrap the selection (or insert an empty placeholder) in a raw code block. */
export function insertCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const lead = atLineStart(view, range.from) ? "" : "\n";
  const body = state.doc.sliceString(range.from, range.to);
  const insert = `${lead}\`\`\`\n${body}\n\`\`\`\n`;
  const anchor = range.from + lead.length + 4; // just past the opening "```\n"
  view.dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert },
      selection: body
        ? EditorSelection.range(anchor, anchor + body.length)
        : EditorSelection.cursor(anchor),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
}

/** Insert `#image("")` with the cursor between the path quotes. */
export function insertImage(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const insert = `#image("")`;
  const anchor = range.from + insert.indexOf('"') + 1;
  view.dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.cursor(anchor),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
}

/** Insert `#link("")[…]`, using any selection as the link body and placing the
 *  cursor between the URL quotes. */
export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const body = state.doc.sliceString(range.from, range.to);
  const insert = `#link("")[${body}]`;
  const anchor = range.from + insert.indexOf('"') + 1;
  view.dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.cursor(anchor),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
}

/** Insert a 2-column starter table with the first header cell selected. */
export function insertTable(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const lead = atLineStart(view, range.from) ? "" : "\n";
  const insert =
    `${lead}#table(\n` +
    `  columns: 2,\n` +
    `  [Header 1], [Header 2],\n` +
    `  [Cell 1], [Cell 2],\n` +
    `)\n`;
  const placeholder = "Header 1";
  const anchor = range.from + insert.indexOf(placeholder);
  view.dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.range(anchor, anchor + placeholder.length),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
}

export const typstKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-e", run: toggleRawInline },
  { key: "Enter", run: continueList },
];
