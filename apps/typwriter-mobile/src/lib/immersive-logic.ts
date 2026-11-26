// Hide-on-scroll rule for the immersive editor and preview, modelled on
// Obsidian's phone UI: scrolling down into a note hides the floating header,
// the bottom dock and the status bar; scrolling back up a little, tapping, or
// returning to the top brings them back.
//
// Pure so it can be unit tested; `stores/immersive.svelte.ts` feeds it scroll
// positions from the real scrollers.

/** Downward travel, in px, before the chrome hides. Enough to ignore the
 *  jitter at the start of a drag, small enough to feel immediate. */
export const HIDE_AFTER_PX = 24;
/** Upward travel, in px, before it comes back — "scroll back up slightly". */
export const SHOW_AFTER_PX = 16;
/** Within this distance of the top the chrome always shows: there's nothing
 *  above to make room for, and the title and first lines sit under it. */
export const TOP_ZONE_PX = 48;

export interface ScrollHideState {
  hidden: boolean;
  /** Last scrollTop seen. */
  lastTop: number;
  /** Distance travelled in the current direction (+ down, − up). */
  travel: number;
}

export const initialScrollHide = (top = 0): ScrollHideState => ({
  hidden: false,
  lastTop: top,
  travel: 0,
});

/**
 * Advance the state for a user-driven scroll to `top`. `maxTop` is the
 * scroller's largest scrollTop; Android's overscroll glow never reports past
 * it, but a WebView that bounces could, and a bounce must not count as travel.
 */
export function nextScrollHide(
  state: ScrollHideState,
  top: number,
  maxTop = Number.POSITIVE_INFINITY,
): ScrollHideState {
  const clamped = Math.max(0, Math.min(top, maxTop));
  const delta = clamped - state.lastTop;
  if (clamped <= TOP_ZONE_PX) return { hidden: false, lastTop: clamped, travel: 0 };
  if (delta === 0) return { ...state, lastTop: clamped };

  // A change of direction starts counting afresh.
  const sameDirection = Math.sign(delta) === Math.sign(state.travel) || state.travel === 0;
  const travel = sameDirection ? state.travel + delta : delta;

  if (!state.hidden && travel >= HIDE_AFTER_PX) return { hidden: true, lastTop: clamped, travel: 0 };
  if (state.hidden && travel <= -SHOW_AFTER_PX) return { hidden: false, lastTop: clamped, travel: 0 };
  return { hidden: state.hidden, lastTop: clamped, travel };
}

/**
 * Track a scroll the user didn't cause — CodeMirror lifting the caret, a jump
 * to a page, a restored position. It must not hide anything, and it must not
 * leave travel behind for the next real gesture to inherit. Landing at the top
 * still reveals, as it would for a finger.
 */
export function syncScrollHide(state: ScrollHideState, top: number): ScrollHideState {
  const clamped = Math.max(0, top);
  return {
    hidden: clamped <= TOP_ZONE_PX ? false : state.hidden,
    lastTop: clamped,
    travel: 0,
  };
}
