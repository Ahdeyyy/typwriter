// Caret movement and selection commands for the toolbar's cursor row.
//
// Placing a caret precisely with a fingertip is the weakest part of editing on a
// phone: the target is a few pixels wide, the finger covers it, and Android's
// drag handles snap to word boundaries as often as not. Every serious mobile
// code editor answers this the same way — put the caret under button and gesture
// control, where a step is exactly one character and nothing is obscured.
//
// The movement commands are CodeMirror's own, paired here so a single "extend"
// flag chooses between moving the caret and dragging the selection's head
// behind it; that pairing is the whole reason this file exists rather than the
// toolbar importing from `@codemirror/commands` directly.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  cursorCharLeft,
  cursorCharRight,
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineDown,
  cursorLineUp,
  selectAll,
  selectCharLeft,
  selectCharRight,
  selectGroupLeft,
  selectGroupRight,
  selectLine,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  selectLineDown,
  selectLineUp,
} from "@codemirror/commands";

/** One step of caret movement. `extend` keeps the anchor put and moves only the
 *  head, which is what turns the same buttons into a selection tool. */
export type Step = "charLeft" | "charRight" | "lineUp" | "lineDown" | "wordLeft" | "wordRight" | "lineStart" | "lineEnd";

type Command = (view: EditorView) => boolean;

const MOVE: Record<Step, [move: Command, extend: Command]> = {
  charLeft: [cursorCharLeft, selectCharLeft],
  charRight: [cursorCharRight, selectCharRight],
  lineUp: [cursorLineUp, selectLineUp],
  lineDown: [cursorLineDown, selectLineDown],
  wordLeft: [cursorGroupLeft, selectGroupLeft],
  wordRight: [cursorGroupRight, selectGroupRight],
  lineStart: [cursorLineBoundaryBackward, selectLineBoundaryBackward],
  lineEnd: [cursorLineBoundaryForward, selectLineBoundaryForward],
};

/** Run one movement step. Returns whether anything moved — false at the ends of
 *  the document, which is what stops press-and-hold from spinning forever. */
export function step(view: EditorView, dir: Step, extend: boolean): boolean {
  return MOVE[dir][extend ? 1 : 0](view);
}

/**
 * Select the word under (or immediately before) the caret.
 *
 * The tap-friendly version of a double-tap, and the usual starting point for a
 * selection: get the word, then widen it by character with the arrows rather
 * than trying to land both handles by hand.
 */
export function selectWordAtCursor(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  // `wordAt` reports nothing when the caret sits just past a word's last
  // character — the single most common place for it to be, since that is where
  // typing leaves it — so fall back to the word ending here.
  const range = state.wordAt(pos) ?? (pos > 0 ? state.wordAt(pos - 1) : null);
  if (!range) return false;
  view.dispatch({
    selection: EditorSelection.range(range.from, range.to),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

/** Select the whole line the caret is on, growing to further lines on repeat. */
export function selectCurrentLine(view: EditorView): boolean {
  return selectLine(view);
}

/** Select the entire document. */
export function selectWholeDoc(view: EditorView): boolean {
  return selectAll(view);
}

/** Collapse a selection back to a plain caret at its head. */
export function collapseSelection(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) return false;
  view.dispatch({
    selection: EditorSelection.cursor(sel.head),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}
