// Drives keyboard-avoiding layout from the visual viewport.
//
// `svh`/`dvh` units don't shrink when the Android soft keyboard opens — they
// track the browser UI chrome, not the keyboard inset — so we measure the
// keyboard inset from `visualViewport` and publish the resulting shell height as
// a CSS custom property.
// The editor shell is `position: fixed` at the top of the *layout* viewport and
// is shortened by that inset, so its bottom edge lands exactly on the top of the
// keyboard (the toolbar docks flush on it, the editor never extends behind it).
//
// Why not pin the shell to the visual-viewport rectangle (`top: offsetTop`)?
// Because Chrome scrolls the visual viewport itself to lift the caret above the
// keyboard: it slides the visible window down by `offsetTop`. Translating the
// shell down by that same amount cancels the scroll exactly — the caret lands
// back on the screen pixel it started on, which is the one behind the keyboard —
// and every further correction Chrome makes gets undone on the next scroll
// event. Anchoring to the layout viewport leaves Chrome's adjustment intact.
//
//   --app-height  shell height  = layout height − keyboard inset
//   --app-inset-top  pan amount = how far the visual viewport is scrolled down
//
// The cost of anchoring to the layout viewport is that the shell *box* and the
// *visible* band stop coinciding whenever `offsetTop > 0`: the shell's top
// `offsetTop` pixels are scrolled off the screen, taking the top bar with them.
// `--app-inset-top` is the fix: the shell pads its top edge by exactly that
// much, so its content box is the visible band — the header sits at the top of
// the screen and the toolbar on the keyboard, and the flexible editor in
// between is the only thing that changes size. The shell's own bottom edge
// never moves, so this doesn't disturb where the toolbar docks.
//
// Note that padding, unlike translating the shell, leaves the shell's *box*
// anchored at layout y=0 — so nothing laid out inside it may assume "inside my
// box" == "on screen". Anything that has to stay visible (i.e. the caret) must
// be checked against `visibleViewportRect()` below, not against its own
// container.
//
// `visible` additionally toggles the keyboard-specific toolbar.

/** Below this the inset is chrome (a hardware-keyboard suggestion strip, a
 *  gesture bar), not a soft keyboard. */
const KEYBOARD_MIN_PX = 150;

/**
 * The band of the layout viewport that is actually on screen, in **client**
 * coordinates — the same space as `getBoundingClientRect()`.
 *
 * `getBoundingClientRect()` is relative to the *layout* viewport and does not
 * account for the visual viewport being panned or shrunk; `offsetTop`/`height`
 * are exactly that missing information. So `offsetTop + height` is the top edge
 * of the soft keyboard expressed in rect coordinates, which is what makes an
 * "is this element covered by the keyboard?" test possible at all.
 *
 * (Valid because the app pins `maximum-scale=1, user-scalable=no`: at scale 1
 * client pixels and visual-viewport pixels are the same unit.)
 */
export function visibleViewportRect(): { top: number; bottom: number } {
  if (typeof window === "undefined") return { top: 0, bottom: 0 };
  const layoutH = document.documentElement.clientHeight || window.innerHeight;
  const vv = window.visualViewport;
  if (!vv) return { top: 0, bottom: layoutH };
  return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
}

class KeyboardVisibility {
  visible = $state(false);
  /**
   * Height of the last soft keyboard we measured, in px; 0 until one opens.
   * The viewport only reports the keyboard once it has finished animating in,
   * so this is what lets the caret be moved clear of it on focus, before the
   * measurement exists. Kept per session (it survives the keyboard closing).
   */
  lastHeight = 0;

  private cleanup: (() => void) | null = null;
  private frame = 0;
  /** Tallest layout height seen at `baseWidth` — i.e. a keyboard-free height. */
  private baseHeight = 0;
  private baseWidth = 0;
  private readonly listeners = new Set<() => void>();

  /**
   * Run `fn` after every viewport change we process. Anything whose on-screen
   * position depends on the keyboard has to re-check itself here: a viewport
   * change is not always a resize of any particular element (a pan changes what
   * is visible while every box keeps its size), so element-level observers
   * cannot stand in for this.
   */
  onViewportChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  init() {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;

    const apply = () => {
      this.frame = 0;
      // A width change means rotation; the remembered height is for the old one.
      const width = Math.round(vv.width);
      if (width !== this.baseWidth) {
        this.baseWidth = width;
        this.baseHeight = 0;
      }

      const layoutH = root.clientHeight || window.innerHeight;
      // How far Chrome has scrolled the visual viewport down within the layout
      // viewport. Everything anchored at layout y=0 is off the top of the
      // screen by this much until it pads itself back down.
      const panned = Math.max(0, Math.round(vv.offsetTop));
      // How much of the layout viewport the keyboard covers. Under
      // `interactive-widget=resizes-visual` (what Android WebView actually gives
      // us) the layout viewport keeps its full height and the keyboard eats the
      // bottom of the visual viewport, so this *is* the keyboard height. Under
      // `resizes-content` the layout viewport has already shrunk and this reads
      // ~0 — which is why `baseHeight` below is what detects the keyboard there.
      const covered = Math.max(0, Math.round(layoutH - vv.height));
      // What to subtract from the shell, which is anchored at layout y=0: Chrome
      // may have panned the visual viewport down by `offsetTop`, and that much of
      // the keyboard is already accounted for by the pan. Sizing needs this;
      // detection must NOT, or a large pan reads as "keyboard closed".
      const inset = Math.max(0, covered - panned);
      if (covered < KEYBOARD_MIN_PX) this.baseHeight = Math.max(this.baseHeight, layoutH);

      const shrunk = this.baseHeight - layoutH;
      root.style.setProperty("--app-height", `${Math.max(0, layoutH - inset)}px`);
      root.style.setProperty("--app-inset-top", `${panned}px`);
      this.visible = covered > KEYBOARD_MIN_PX || shrunk > KEYBOARD_MIN_PX;
      // Whichever mode we're in, exactly one of the two terms is the keyboard.
      if (this.visible) this.lastHeight = Math.max(covered, shrunk);

      for (const fn of this.listeners) fn();
    };

    // Coalesce to one write per frame: Android fires a burst of resize/scroll
    // events as the keyboard animates, and writing styles inside each one
    // thrashes layout.
    const schedule = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(apply);
    };

    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    apply();

    this.cleanup = () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-inset-top");
    };
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.visible = false;
    this.baseHeight = 0;
    this.baseWidth = 0;
  }
}

export const keyboard = new KeyboardVisibility();
