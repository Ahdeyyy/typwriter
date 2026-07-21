// Screen + overlay navigation, integrated with the browser history stack so
// the Android back gesture closes overlays before exiting the editor, and
// exits the editor before leaving the app. Every overlay component must use
// `openOverlay` / `closeOverlay` — never set `overlay` directly.

export type Screen = "home" | "editor";
export type Overlay =
  | "none"
  | "filetree"
  | "preview"
  | "diagnostics"
  | "settings"
  | "quickswitcher"
  | "tabswitcher";

interface HistoryState {
  screen?: Screen;
  overlay?: Overlay;
}

class AppStore {
  screen = $state<Screen>("home");
  overlay = $state<Overlay>("none");

  /** Set by the editor screen so we can flush unsaved content when leaving it,
   *  without an import cycle between this store and the editor store. */
  flushEditor: (() => void) | null = null;

  private initialized = false;

  /** Register the popstate listener once (call from the root component). */
  init() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    history.replaceState({ screen: "home", overlay: "none" } satisfies HistoryState, "");
    window.addEventListener("popstate", (e) => this.applyState(e.state as HistoryState | null));
  }

  private applyState(state: HistoryState | null) {
    const nextScreen: Screen = state?.screen ?? "home";
    const nextOverlay: Overlay = state?.overlay ?? "none";
    // Leaving the editor for home: persist unsaved content first.
    if (this.screen === "editor" && nextScreen === "home") {
      this.flushEditor?.();
    }
    this.screen = nextScreen;
    this.overlay = nextOverlay;
  }

  /** Enter the editor screen (pushes a history entry so back returns home). */
  openEditor() {
    this.screen = "editor";
    this.overlay = "none";
    history.pushState({ screen: "editor", overlay: "none" } satisfies HistoryState, "");
  }

  openOverlay(o: Overlay) {
    this.overlay = o;
    history.pushState({ screen: this.screen, overlay: o } satisfies HistoryState, "");
  }

  /** Close the current overlay via history so back behaves natively. */
  closeOverlay() {
    if (this.overlay === "none") return;
    history.back();
  }

  /** Return to the home screen (e.g. "Close workspace"). */
  goHome() {
    if (this.screen !== "editor") return;
    // If an overlay is open, close it first, then the editor entry.
    if (this.overlay !== "none") {
      history.go(-2);
    } else {
      history.back();
    }
  }
}

export const app = new AppStore();
