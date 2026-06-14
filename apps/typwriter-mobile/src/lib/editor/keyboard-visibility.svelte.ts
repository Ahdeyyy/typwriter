// Drives keyboard-avoiding layout from the visual viewport.
//
// `interactive-widget=resizes-content` is set in app.html, but `svh`/`dvh` units
// don't reliably shrink when the Android soft keyboard opens — they track the
// browser UI chrome, not the keyboard inset. So we measure `visualViewport`
// directly and publish its height as the `--app-height` CSS custom property; the
// editor shell sizes itself to that, which docks the toolbar right above the
// keyboard. `visible` additionally toggles the keyboard-specific toolbar.

import { EditorView } from "@codemirror/view";
import { editor } from "$lib/stores/editor.svelte";

class KeyboardVisibility {
  visible = $state(false);
  private cleanup: (() => void) | null = null;
  private lastHeight = 0;

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
    };
  }

  /** Center the caret in the (now keyboard-shortened) editor viewport. Deferred
   *  to the next frame so CodeMirror measures against the applied layout. */
  private scrollCaretIntoView() {
    const view = editor.view;
    if (!view) return;
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      const head = view.state.selection.main.head;
      view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    });
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
    this.visible = false;
    this.lastHeight = 0;
  }
}

export const keyboard = new KeyboardVisibility();
