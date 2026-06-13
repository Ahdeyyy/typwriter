// Detects whether the soft keyboard is showing by watching visualViewport.
// `interactive-widget=resizes-content` + `adjustResize` already make the
// keyboard shrink the layout, so normal flex layout docks the toolbar above it;
// this is only used to show/hide keyboard-specific buttons.

class KeyboardVisibility {
  visible = $state(false);
  private cleanup: (() => void) | null = null;

  init() {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => {
      this.visible = window.innerHeight - vv.height > 150;
    };
    vv.addEventListener("resize", onResize);
    onResize();
    this.cleanup = () => vv.removeEventListener("resize", onResize);
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
    this.visible = false;
  }
}

export const keyboard = new KeyboardVisibility();
