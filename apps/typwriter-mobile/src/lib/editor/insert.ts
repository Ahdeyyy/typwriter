// Toolbar insert/wrap helpers. Pure CodeMirror transactions so they're easy to
// reason about and reuse from the symbol row.

import type { EditorView } from "@codemirror/view";

/** Open char -> close char for chars that wrap a selection. `$` wraps `$…$`. */
export const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  $: "$",
  "*": "*",
  _: "_",
  "`": "`",
  '"': '"',
};

/** Insert a single char at the cursor (replacing any selection). */
export function insertSingle(view: EditorView, ch: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: ch },
    selection: { anchor: from + ch.length },
    scrollIntoView: true,
  });
}

/** Wrap the selection in `open`/`close`, or insert the empty pair with the
 *  caret between when there's no selection. */
export function wrapPair(view: EditorView, open: string, close: string) {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    view.dispatch({
      changes: [
        { from, insert: open },
        { from: to, insert: close },
      ],
      selection: { anchor: from + open.length, head: to + open.length },
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      changes: { from, insert: open + close },
      selection: { anchor: from + open.length },
      scrollIntoView: true,
    });
  }
}

/** Dispatch the right action for a toolbar symbol button. */
export function insertOrWrap(view: EditorView, ch: string) {
  const close = PAIRS[ch];
  if (close) wrapPair(view, ch, close);
  else insertSingle(view, ch);
  view.focus();
}
