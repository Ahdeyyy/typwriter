// The block surface's single CodeMirror instance.
//
// Only one block is editable at a time, so the surface reuses **one** view,
// moving its DOM node into whichever block is active. One EditorView per block
// would multiply Android IME and memory cost across a long document.

import { EditorView } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { createExtensions, languageFor } from "$lib/editor/create-editor";

let view: EditorView | null = null;
/** Who currently owns the view. Guards against a stale unmount from a block
 *  whose component is destroyed *after* the next block has mounted. */
let owner = 0;

/** Mount the shared editor into `parent`, seeded with `doc`. Returns the view
 *  and the ownership token to hand back to [`unmount`]. */
export function mount(
  parent: HTMLElement,
  doc: string,
  relPath: string,
  extra: Extension[] = [],
): { view: EditorView; token: number } {
  const state = EditorState.create({
    doc,
    extensions: [
      ...createExtensions(languageFor(relPath), { compact: true }),
      ...extra,
    ],
  });
  if (!view) {
    view = new EditorView({ state });
  } else {
    view.setState(state);
  }
  parent.appendChild(view.dom);
  const token = ++owner;
  return { view, token };
}

/** Detach the shared editor, unless a newer block has already claimed it. */
export function unmount(token: number) {
  if (token !== owner || !view) return;
  view.dom.remove();
}

/** Focus the shared editor and place the caret at the end of its document. */
export function focusEnd() {
  if (!view) return;
  view.focus();
  view.dispatch({
    selection: { anchor: view.state.doc.length },
    scrollIntoView: true,
  });
}
