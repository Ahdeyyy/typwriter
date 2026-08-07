// Keeps the caret inside the editor's visible box whenever that box *shrinks*:
// the soft keyboard opening, the formatting toolbar mounting, the completion
// strip appearing. CodeMirror re-measures when its scroller resizes but never
// re-scrolls the selection, so without this the caret is simply left behind
// whatever just covered it.
//
// Driven by a ResizeObserver on the scroller rather than by a fixed number of
// animation frames after the viewport event: the shell, the toolbar and the
// strip settle at different times, and each one is a real change to the box the
// caret has to fit in. Observing the box removes the guesswork.

import { EditorView, ViewPlugin, type PluginValue } from "@codemirror/view";

/** Breathing room between the caret and the edge it gets scrolled to. */
const CARET_MARGIN_PX = 24;

class CaretVisibility implements PluginValue {
  private observer: ResizeObserver | null = null;
  private lastHeight: number;
  private frame = 0;

  constructor(private readonly view: EditorView) {
    this.lastHeight = view.scrollDOM.clientHeight;
    if (typeof ResizeObserver === "undefined") return;
    this.observer = new ResizeObserver(() => this.onResize());
    this.observer.observe(view.scrollDOM);
  }

  private onResize() {
    const height = this.view.scrollDOM.clientHeight;
    const shrank = height > 0 && height < this.lastHeight;
    this.lastHeight = height;
    // Growing (keyboard closing) never hides the caret, and an unfocused editor
    // has no caret to keep visible.
    if (!shrank || !this.view.hasFocus) return;
    // Dispatching from inside a ResizeObserver callback re-enters CodeMirror's
    // measure cycle; defer a frame so it reads the settled geometry. `nearest`
    // (not `center`) keeps the correction to the smallest scroll that works, so
    // the view doesn't jump on every keyboard toggle.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.view.dom.isConnected || !this.view.hasFocus) return;
      const head = this.view.state.selection.main.head;
      this.view.dispatch({
        effects: EditorView.scrollIntoView(head, { y: "nearest", yMargin: CARET_MARGIN_PX }),
      });
    });
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    cancelAnimationFrame(this.frame);
  }
}

export const caretVisibility = () => ViewPlugin.fromClass(CaretVisibility);
