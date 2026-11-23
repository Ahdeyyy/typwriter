// Immersive chrome for the phone editor and the full-screen preview, after
// Obsidian's phone UI: a scroll down hides the floating header, the bottom
// dock and the status bar; a slight scroll up, a tap, or reaching the top
// brings them back. Settings can turn the whole behaviour off. Every other
// state — keyboard open, an overlay up, a banner asking for a decision, a
// tablet — keeps everything visible.
//
// Only the user's own scrolling counts. CodeMirror lifting the caret, a jump to
// a page, or a restored position moves the same scroller, and hiding the UI in
// response to something the user didn't do reads as the app glitching. A
// scroll is the user's while a finger is down, and for a short while after it
// lifts, to cover the fling that coasts on.

import {
  initialScrollHide,
  nextScrollHide,
  syncScrollHide,
  type ScrollHideState,
} from "#lib/immersive-logic.ts";
import { keyboard } from "#lib/editor/keyboard-visibility.svelte.ts";
import { app } from "./app.svelte";
import { editor } from "./editor.svelte";
import { layout } from "./layout.svelte";
import { settings } from "./settings.svelte";

export type ImmersiveSurface = "editor" | "preview";

/** How long a fling keeps coasting after the finger lifts. */
const FLING_MS = 1200;
/** A press that moves less than this and lifts quickly is a tap. */
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 350;

class ImmersiveStore {
  /** Raw scroll-hide state per surface; see the getters for what's shown. */
  editorScrolledAway = $state(false);
  previewScrolledAway = $state(false);
  /** Height of the floating editor header (status-bar inset included), so
   *  caret scrolling can keep the caret out from under it. */
  editorHeaderHeight = $state(0);

  private readonly states: Record<ImmersiveSurface, ScrollHideState> = {
    editor: initialScrollHide(),
    preview: initialScrollHide(),
  };

  /** The editor's header and dock are hidden. Phones only, and never while
   *  typing (the keyboard toolbar is the user's hands) or while a banner is
   *  waiting for an answer. */
  get editorHidden(): boolean {
    return (
      settings.hideChromeOnScroll &&
      this.editorScrolledAway &&
      !layout.tablet &&
      !keyboard.visible &&
      !editor.externallyChanged &&
      !editor.saveError
    );
  }

  /** The full-screen preview's header is hidden. */
  get previewHidden(): boolean {
    return settings.hideChromeOnScroll && this.previewScrolledAway && !layout.previewDocked;
  }

  /** Whether the Android status bar should be hidden right now. Only for the
   *  surface actually in front: the editor behind an open sheet or the preview
   *  is not being read. */
  get statusBarHidden(): boolean {
    if (app.screen !== "editor") return false;
    if (app.overlay === "preview") return this.previewHidden;
    if (app.overlay === "none") return this.editorHidden;
    return false;
  }

  /** Px at the top of the editor covered by the floating header. */
  get editorObscuredTop(): number {
    return layout.tablet || this.editorHidden ? 0 : this.editorHeaderHeight;
  }

  /** Bring a surface's chrome back (and forget any travel towards hiding). */
  reveal(surface: ImmersiveSurface) {
    const s = this.states[surface];
    this.states[surface] = { hidden: false, lastTop: s.lastTop, travel: 0 };
    this.set(surface, false);
  }

  /**
   * Drive `surface`'s chrome from `scroller`: scrolling hides and shows it, a
   * tap reveals it. Returns the detach function. The reveal runs in the
   * window's capture phase, i.e. before the scroller's own `pointerup`; a
   * surface that needs to know whether a tap was a reveal tap reads `*Hidden`
   * on `pointerdown`.
   */
  bind(surface: ImmersiveSurface, scroller: HTMLElement): () => void {
    let pointers = 0;
    let releasedAt = 0;
    let press: { x: number; y: number; t: number } | null = null;

    this.states[surface] = initialScrollHide(scroller.scrollTop);
    this.set(surface, false);

    const userScrolling = () => pointers > 0 || Date.now() - releasedAt < FLING_MS;

    const onScroll = () => {
      const top = scroller.scrollTop;
      const maxTop = scroller.scrollHeight - scroller.clientHeight;
      const prev = this.states[surface];
      const next = userScrolling() ? nextScrollHide(prev, top, maxTop) : syncScrollHide(prev, top);
      this.states[surface] = next;
      if (next.hidden !== prev.hidden) this.set(surface, next.hidden);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      pointers++;
      press = pointers === 1 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
    };

    // On the window: a finger that starts on the scroller can lift anywhere,
    // and a count that never comes back down would treat every later
    // programmatic scroll as the user's.
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || pointers === 0) return;
      pointers--;
      releasedAt = Date.now();
      const start = press;
      press = null;
      if (
        e.type === "pointerup" &&
        start &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_SLOP_PX &&
        Date.now() - start.t <= TAP_MAX_MS
      ) {
        this.reveal(surface);
      }
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      this.states[surface] = initialScrollHide();
      this.set(surface, false);
    };
  }

  private set(surface: ImmersiveSurface, hidden: boolean) {
    if (surface === "editor") this.editorScrolledAway = hidden;
    else this.previewScrolledAway = hidden;
  }
}

export const immersive = new ImmersiveStore();
