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
// event. Anchoring to the layout viewport leaves Chrome's adjustment intact; the
// worst case is the header being scrolled a few px out of view while the caret,
// the toolbar and the keyboard edge all stay where they belong.
//
//   --app-height  shell height = layout height − keyboard inset
//
// `visible` additionally toggles the keyboard-specific toolbar.

/** Below this the inset is chrome (a hardware-keyboard suggestion strip, a
 *  gesture bar), not a soft keyboard. */
const KEYBOARD_MIN_PX = 150;

class KeyboardVisibility {
  visible = $state(false);
  private cleanup: (() => void) | null = null;
  private frame = 0;
  /** Tallest layout height seen at `baseWidth` — i.e. a keyboard-free height. */
  private baseHeight = 0;
  private baseWidth = 0;

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
      const inset = Math.max(0, covered - Math.round(vv.offsetTop));
      if (covered < KEYBOARD_MIN_PX) this.baseHeight = Math.max(this.baseHeight, layoutH);

      root.style.setProperty("--app-height", `${Math.max(0, layoutH - inset)}px`);
      this.visible = covered > KEYBOARD_MIN_PX || this.baseHeight - layoutH > KEYBOARD_MIN_PX;
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
