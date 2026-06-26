// Drives keyboard-avoiding layout from the visual viewport.
//
// `interactive-widget=resizes-content` is set in app.html, but `svh`/`dvh` units
// don't reliably shrink when the Android soft keyboard opens — they track the
// browser UI chrome, not the keyboard inset. So we measure `visualViewport`
// directly and publish its geometry as CSS custom properties; the editor shell
// is `position: fixed` and pins itself to that rectangle, so it always covers
// exactly the area above the keyboard (the toolbar docks flush on it and the
// editor never extends behind it). `visible` additionally toggles the
// keyboard-specific toolbar.
//
//   --app-height  visualViewport.height  (shell height)
//   --vv-top      visualViewport.offsetTop  (shell top; > 0 when the page
//                 scrolls to keep the caret visible — fixed positioning is
//                 relative to the layout viewport, so we offset by it)
//   --vv-left     visualViewport.offsetLeft (shell left)
//   --vv-width    visualViewport.width      (shell width)

import { EditorView } from "@codemirror/view";
import { editor } from "$lib/stores/editor.svelte";

class KeyboardVisibility {
  visible = $state(false);
  private cleanup: (() => void) | null = null;
  private lastHeight = 0;
  private pendingScroll = 0;

  init() {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;

    const onResize = () => {
      // Pin the shell to the visual viewport rectangle so the bottom toolbar
      // sits flush above the keyboard and the editor never extends behind it.
      const h = Math.round(vv.height);
      root.style.setProperty("--app-height", `${h}px`);
      root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      root.style.setProperty("--vv-left", `${Math.round(vv.offsetLeft)}px`);
      root.style.setProperty("--vv-width", `${Math.round(vv.width)}px`);
      this.visible = window.innerHeight - vv.height > 150;
      // The shell just resized but CodeMirror doesn't know its viewport shrank,
      // so the caret can end up hidden behind the keyboard. Re-center it. Only
      // on a real height change (keyboard open/resize) — not on plain panning
      // (scroll events fire onResize too with an unchanged height).
      if (h !== this.lastHeight) {
        this.lastHeight = h;
        if (this.visible) this.scrollCaretIntoView();
      }
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();
    this.cleanup = () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-left");
      root.style.removeProperty("--vv-width");
    };
  }

  /** Center the caret in the (now keyboard-shortened) editor viewport. Deferred
   *  two frames: the first lets Svelte mount the keyboard toolbar (which shrinks
   *  the editor further) and the new --app-height take effect; the second lets
   *  CodeMirror re-measure its now-shorter viewport. Scrolling any earlier
   *  computes against stale geometry and leaves the caret behind the keyboard.
   *  Cancel any in-flight deferral so a burst of resize events doesn't stack. */
  private scrollCaretIntoView() {
    const view = editor.view;
    if (!view) return;
    cancelAnimationFrame(this.pendingScroll);
    this.pendingScroll = requestAnimationFrame(() => {
      this.pendingScroll = requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;
        const head = view.state.selection.main.head;
        view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
      });
    });
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
    cancelAnimationFrame(this.pendingScroll);
    this.pendingScroll = 0;
    this.visible = false;
    this.lastHeight = 0;
  }
}

export const keyboard = new KeyboardVisibility();
