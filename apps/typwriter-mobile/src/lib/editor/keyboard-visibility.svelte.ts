// Drives keyboard-avoiding layout from the visual viewport.
//
// `interactive-widget=resizes-content` is set in app.html, but `svh`/`dvh` units
// don't reliably shrink when the Android soft keyboard opens — they track the
// browser UI chrome, not the keyboard inset. So we measure `visualViewport`
// directly and publish its height as the `--app-height` CSS custom property; the
// editor shell sizes itself to that, which docks the toolbar right above the
// keyboard. `visible` additionally toggles the keyboard-specific toolbar.

class KeyboardVisibility {
  visible = $state(false);
  private cleanup: (() => void) | null = null;

  init() {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;

    const onResize = () => {
      // Height the shell to the visual viewport so the bottom toolbar sits
      // flush above the keyboard. offsetTop > 0 happens when the page scrolls
      // to keep the caret visible; subtracting it keeps the shell pinned.
      const h = Math.round(vv.height);
      root.style.setProperty("--app-height", `${h}px`);
      this.visible = window.innerHeight - vv.height > 150;
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();
    this.cleanup = () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      root.style.removeProperty("--app-height");
    };
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
    this.visible = false;
  }
}

export const keyboard = new KeyboardVisibility();
