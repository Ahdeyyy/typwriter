// Holds the editor's scroll position still across an asynchronous action that
// has no business moving it.
//
// The case this exists for is the completion strip's Sparkle button. Between the
// tap and the suggestions arriving there is an IPC round trip, and several
// things in that window can re-anchor `.cm-scroller` without anyone asking:
// Chrome re-revealing the focused caret after a tap lands outside the
// contenteditable (the same reflex the toolbar's `keepEditorFocus` guard exists
// to suppress), the strip laying out its first row of chips, and CodeMirror
// re-measuring behind both. The result is the editor sliding away from the line
// being edited in response to a button that is supposed to be read-only.
//
// Rather than chase each source, pin the outcome: requesting suggestions must
// leave the viewport exactly where it was. The pin is deliberately weak — it
// only restores a position, never blocks one — and yields to anything that makes
// scrolling legitimate again:
//
//   * the caret moving or the document changing (the user is editing, and
//     CodeMirror's own `scrollIntoView` should win),
//   * a finger landing on the scroller (the user wants to scroll),
//   * PIN_MS elapsing, so a slow backend can't freeze the viewport.

import type { EditorView } from "@codemirror/view";

/** Longer than a completion round trip on a large document, short enough that a
 *  pin nobody released is imperceptible. */
const PIN_MS = 700;

/** Pin `view`'s scroll position. Returns a release function; calling it more
 *  than once, or after the pin has expired on its own, is a no-op. */
export function pinScroll(view: EditorView): () => void {
  const scroller = view.scrollDOM;
  const top = scroller.scrollTop;
  const head = view.state.selection.main.head;
  const docLength = view.state.doc.length;
  const deadline = Date.now() + PIN_MS;

  let frame = 0;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    cancelAnimationFrame(frame);
    scroller.removeEventListener("pointerdown", release);
  };

  const tick = () => {
    if (released) return;
    const sel = view.state.selection.main;
    if (
      Date.now() > deadline ||
      !view.dom.isConnected ||
      sel.head !== head ||
      view.state.doc.length !== docLength
    ) {
      release();
      return;
    }
    if (scroller.scrollTop !== top) scroller.scrollTop = top;
    frame = requestAnimationFrame(tick);
  };

  scroller.addEventListener("pointerdown", release);
  frame = requestAnimationFrame(tick);
  return release;
}
