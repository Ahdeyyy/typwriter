// Keeps the caret on screen when the soft keyboard covers where it was.
//
// The rule this enforces is deliberately absolute: the caret's rectangle must
// lie inside the part of the scroller that is *actually visible* — the
// intersection of the scroller's box with the visual viewport — and nothing
// else is assumed. In particular it does not assume the editor's box was
// correctly shortened, that the shell and the visible band coincide, or that a
// resize accompanies every occlusion. Each of those assumptions is false in at
// least one Android viewport mode:
//
//   * Chrome pans the visual viewport (`offsetTop` rises) to lift the caret. The
//     shell is anchored at layout y=0 and shortened by `covered − offsetTop`, so
//     a pan makes the shell *grow* — the scroller gets bigger while the visible
//     band slides down. Watching the scroller for shrinkage sees nothing here,
//     and any test against the scroller's own box concludes the caret is fine
//     while it sits below the keyboard's top edge (or above the band entirely).
//   * With the keyboard already up, moving the caret — typing, Enter at the
//     bottom of the screen, tapping a low line — resizes nothing at all.
//   * Before the keyboard has finished animating in, the viewport reports no
//     keyboard yet, so there is no measurement to react to (see `safeBand`).
//
// So: recompute from the live geometry, on every signal that can change it, and
// correct with a direct `scrollTop` adjustment (exact, unlike `scrollIntoView`,
// which resolves "nearest" against the scroller box we just established is the
// wrong reference).

import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { keyboard, visibleViewportRect } from "./keyboard-visibility.svelte";

/** Breathing room between the caret and the edge it gets scrolled to. */
const CARET_MARGIN_PX = 24;
/** Ignore sub-pixel disagreement; correcting it would only cause jitter. */
const MIN_CORRECTION_PX = 2;
/**
 * The keyboard animates in over a few hundred ms and some devices report the
 * viewport once, at the end. Re-check across the whole animation so the caret
 * tracks it up rather than jumping when it lands.
 */
const SETTLE_DELAYS_MS = [0, 60, 160, 320, 500];
/** How long after focus we assume a keyboard is on its way in. */
const PREDICT_WINDOW_MS = 700;

class CaretVisibility implements PluginValue {
  private readonly unsubscribe: () => void;
  private observer: ResizeObserver | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private frame = 0;
  private focusedAt = 0;

  private readonly onFocus = () => {
    this.focusedAt = Date.now();
    this.settle();
  };

  constructor(private readonly view: EditorView) {
    // A viewport change is the only signal for a pan, and the earliest one for a
    // resize; the ResizeObserver additionally covers the toolbar mounting and
    // the completion strip appearing, which move the scroller's edges without
    // touching the viewport.
    this.unsubscribe = keyboard.onViewportChange(() => this.settle());
    view.contentDOM.addEventListener("focus", this.onFocus);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.settle());
      this.observer.observe(view.scrollDOM);
    }
  }

  update(u: ViewUpdate) {
    // Moving the caret under a keyboard that is already open resizes nothing, so
    // CodeMirror's own scrolling is the only thing acting and it can't see the
    // keyboard. Only worth checking while something is actually covering us.
    if (!u.selectionSet && !u.docChanged) return;
    if (keyboard.visible || this.predicting()) this.schedule();
  }

  /** Correct now, and again as the keyboard animation settles. */
  private settle() {
    this.clearTimers();
    for (const delay of SETTLE_DELAYS_MS) {
      this.timers.push(setTimeout(() => this.schedule(), delay));
    }
  }

  private schedule() {
    if (this.frame) return;
    // Dispatching or measuring from inside a ResizeObserver callback re-enters
    // CodeMirror's measure cycle; defer a frame so we read settled geometry.
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.correct();
    });
  }

  private predicting(): boolean {
    return (
      !keyboard.visible && keyboard.lastHeight > 0 && Date.now() - this.focusedAt < PREDICT_WINDOW_MS
    );
  }

  /**
   * The visible slice of the scroller, in client coordinates.
   *
   * While a keyboard is on its way in but not yet measurable, the band is cut
   * short by the height of the last keyboard we saw. That is what makes the
   * caret clear the keyboard as it opens instead of after it has landed — and,
   * because Chrome only pans the visual viewport when the focused caret is
   * *not* already visible, getting there first is also what stops the pan (and
   * the misaligned shell it causes) from happening in the first place.
   *
   * Safe against double-counting: `keyboard.visible` and the shell's height are
   * published in the same pass, so "not visible" also means "not yet shortened".
   */
  private safeBand(): { top: number; bottom: number } {
    const box = this.view.scrollDOM.getBoundingClientRect();
    const screen = visibleViewportRect();
    const top = Math.max(box.top, screen.top);
    let bottom = Math.min(box.bottom, screen.bottom);
    if (this.predicting()) bottom = Math.min(bottom, screen.bottom - keyboard.lastHeight);
    return { top, bottom };
  }

  private correct() {
    const view = this.view;
    if (!view.dom.isConnected || !view.hasFocus) return;

    const head = view.state.selection.main.head;
    const caret = view.coordsAtPos(head);
    // Not in CodeMirror's rendered range: get it rendered first, then this runs
    // again on the resulting update and can measure it properly.
    if (!caret) {
      view.dispatch({ effects: EditorView.scrollIntoView(head) });
      return;
    }

    const { top, bottom } = this.safeBand();
    const caretHeight = caret.bottom - caret.top;
    if (bottom - top < caretHeight) return; // nothing we scroll to would help
    // With little room left the full margin can't be honoured at both ends;
    // shrinking it keeps the two clamps from fighting each other frame to frame.
    const margin = Math.min(CARET_MARGIN_PX, (bottom - top - caretHeight) / 2);

    // Bottom first: being under the keyboard is the failure we're here for, and
    // resolving one edge per pass keeps a cramped band from oscillating.
    let delta = 0;
    if (caret.bottom > bottom - margin) delta = caret.bottom - (bottom - margin);
    else if (caret.top < top + margin) delta = caret.top - (top + margin);
    if (Math.abs(delta) < MIN_CORRECTION_PX) return;

    // Direct scroll rather than a scrollIntoView effect: the delta is measured
    // against the visible band, and CodeMirror would re-derive it against the
    // scroller box. (`.cm-content` carries 40vh of bottom padding so there is
    // room to scroll a caret on the last line clear of the keyboard.)
    view.scrollDOM.scrollTop += delta;
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  destroy() {
    this.unsubscribe();
    this.view.contentDOM.removeEventListener("focus", this.onFocus);
    this.observer?.disconnect();
    this.observer = null;
    this.clearTimers();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

export const caretVisibility = () => ViewPlugin.fromClass(CaretVisibility);
