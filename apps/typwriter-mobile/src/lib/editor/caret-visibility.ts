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
//
// Equally important is when NOT to correct. Scrolling the text under a finger
// that is mid-gesture is a feedback loop, not a correction: the glyph the user
// was pointing at moves, so the selection lands somewhere they never pointed,
// so the head moves, so we scroll again. See `touching()`.
//
// Nor is the caret's position an invariant to be restored forever. Once the user
// has scrolled the caret off screen themselves they are reading somewhere else,
// and re-running this rule on the next viewport event drags them back — "it
// always snaps back to the cursor". So a touch-scroll parks the plugin until the
// caret is next put somewhere on purpose (a tap, an edit, a fresh focus) or the
// keyboard opens anew. See `scrolledAway`.

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
/**
 * How long after a finger leaves the editor we keep treating the screen as
 * being under a gesture. A lift is usually the middle of a gesture rather than
 * the end of one — re-grabbing a selection handle, the second tap of a
 * double-tap, the next flick of a scroll — and snapping the text in that gap is
 * what turns "I lifted my finger for a moment" into "the editor moved".
 */
const GESTURE_GRACE_MS = 350;

class CaretVisibility implements PluginValue {
  private readonly unsubscribe: () => void;
  private observer: ResizeObserver | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private frame = 0;
  private focusedAt = 0;
  private pointersDown = 0;
  private gestureEndedAt = 0;
  /** The user has scrolled the caret out of view on purpose; stay out of it. */
  private scrolledAway = false;
  /** Where our own last correction left the scroller, to tell it from a gesture. */
  private selfScrollTop = -1;
  private keyboardWasVisible = false;

  private readonly onFocus = () => {
    this.focusedAt = Date.now();
    // A fresh focus is a fresh keyboard: whatever the user was reading before,
    // the caret they just aimed at is the thing that has to be visible now.
    this.scrolledAway = false;
    this.settle();
  };

  // Only a scroll the user's own finger caused counts. Our corrections scroll
  // the same element, and so does the browser when it lifts the caret after an
  // edit — treating either as "the user looked away" would park the plugin
  // exactly when it is needed.
  private readonly onScroll = () => {
    const top = this.view.scrollDOM.scrollTop;
    if (Math.abs(top - this.selfScrollTop) < 1) return;
    if (!this.touching()) return;
    this.scrolledAway = true;
    // Anything already queued was aimed at the pre-scroll geometry.
    this.clearTimers();
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    this.pointersDown++;
  };

  // Bound on the window, not the editor: a finger that starts on the text and
  // lifts somewhere else (the toolbar, off the edge) must still clear the count,
  // or corrections stay suspended for the rest of the session.
  private readonly onPointerEnd = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || this.pointersDown === 0) return;
    this.pointersDown--;
    this.gestureEndedAt = Date.now();
    this.settle(GESTURE_GRACE_MS);
  };

  constructor(private readonly view: EditorView) {
    // A viewport change is the only signal for a pan, and the earliest one for a
    // resize; the ResizeObserver additionally covers the toolbar mounting and
    // the completion strip appearing, which move the scroller's edges without
    // touching the viewport.
    this.keyboardWasVisible = keyboard.visible;
    this.unsubscribe = keyboard.onViewportChange(() => {
      // A keyboard that has just come up takes a band of the screen the caret
      // may have been sitting in; that is new occlusion, not the scroll position
      // the user chose, so it overrides their choice to look elsewhere.
      if (keyboard.visible && !this.keyboardWasVisible) this.scrolledAway = false;
      this.keyboardWasVisible = keyboard.visible;
      this.settle();
    });
    view.contentDOM.addEventListener("focus", this.onFocus);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    view.dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerEnd, true);
    window.addEventListener("pointercancel", this.onPointerEnd, true);
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
    // Putting the caret somewhere — a tap, a keystroke, a toolbar insert — is
    // the user pointing at it again, which ends any earlier "leave me where I
    // scrolled to". (Scrolling dispatches no transaction, so this can't be the
    // gesture undoing itself.)
    this.scrolledAway = false;
    if (keyboard.visible || this.predicting()) this.schedule();
  }

  /** Correct now, and again as the keyboard animation settles. `after` delays
   *  the whole ramp — used to start it once a gesture's grace has expired. */
  private settle(after = 0) {
    this.clearTimers();
    for (const delay of SETTLE_DELAYS_MS) {
      this.timers.push(setTimeout(() => this.schedule(), after + delay));
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
   * Whether a finger is on the editor, or recently was.
   *
   * A touch-scroll is the user deliberately looking somewhere else and the
   * settle ramp is quite capable of firing mid-flick; the press that begins a
   * long-press selection lands in this window too, before any range exists to
   * notice. Either way the viewport belongs to the gesture, not to us.
   */
  private touching(): boolean {
    return this.pointersDown > 0 || Date.now() - this.gestureEndedAt < GESTURE_GRACE_MS;
  }

  /**
   * The visible slice of the scroller, in client coordinates.
   *
   * While a keyboard is on its way in but not yet measurable, the band is cut
   * short by the part of it the viewport has yet to account for. That is what
   * makes the caret clear the keyboard as it opens instead of after it has
   * landed — and, because Chrome only pans the visual viewport when the focused
   * caret is *not* already visible, getting there first is also what stops the
   * pan (and the misaligned shell it causes) from happening in the first place.
   *
   * It is `keyboard.pending`, not `keyboard.lastHeight`, precisely because the
   * two are not interchangeable mid-animation: the inset grows through values
   * below the soft-keyboard threshold, which shrink `screen` while `visible` is
   * still false. Subtracting the whole keyboard as well would cut the band to a
   * fraction of the screen and shove the caret up to the top of it.
   */
  private safeBand(): { top: number; bottom: number } {
    const box = this.view.scrollDOM.getBoundingClientRect();
    const screen = visibleViewportRect();
    const top = Math.max(box.top, screen.top);
    let bottom = Math.min(box.bottom, screen.bottom);
    if (this.predicting()) bottom = Math.min(bottom, screen.bottom - keyboard.pending);
    return { top, bottom };
  }

  private correct() {
    const view = this.view;
    if (!view.dom.isConnected || !view.hasFocus) return;
    // A range means a selection gesture is live: Android's drag handles, its
    // magnifier and its own edge autoscroll are driving the viewport, and the
    // finger is resting on a particular glyph. Scrolling the text out from under
    // it re-aims the handle at whatever slid into that spot, which moves the
    // head, which brings us back here to scroll again — the runaway that ends
    // with the selection somewhere the user never pointed and the caret off
    // screen. Nothing here is worth that: this plugin keeps a *caret* clear of
    // the keyboard, and during a range selection there isn't one.
    //
    // It re-checks itself, so there is nothing to re-arm — collapsing the
    // selection is a `selectionSet` and arrives through `update`.
    if (!view.state.selection.main.empty) return;
    // Scrolled away on purpose: the caret being off screen is the state the user
    // asked for. Re-imposing the rule here is what made the editor unscrollable
    // with the keyboard up — every pan, resize and settle tick yanked the text
    // back. `update` and a fresh keyboard are what lift this.
    if (this.scrolledAway) return;
    if (this.touching()) {
      // A gesture, on the other hand, can end without a `pointerup` we ever see
      // — Android's selection handles are browser chrome and swallow their own
      // touches — so the signal that brought us here has to be carried forward
      // by hand or it is simply lost.
      this.timers.push(setTimeout(() => this.schedule(), GESTURE_GRACE_MS));
      return;
    }

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
    // Remember where we left it: the scroll event this causes arrives later and
    // must not be mistaken for the user pushing the text around.
    this.selfScrollTop = view.scrollDOM.scrollTop;
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  destroy() {
    this.unsubscribe();
    this.view.contentDOM.removeEventListener("focus", this.onFocus);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.view.dom.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerEnd, true);
    window.removeEventListener("pointercancel", this.onPointerEnd, true);
    this.observer?.disconnect();
    this.observer = null;
    this.clearTimers();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

export const caretVisibility = () => ViewPlugin.fromClass(CaretVisibility);
