// Screen + overlay navigation, integrated with the browser history stack so
// the Android back gesture closes overlays before exiting the editor, and
// exits the editor before leaving the app. Every overlay component must use
// `openOverlay` / `closeOverlay` — never set `overlay` directly.

import { destroyBodyLockSafety, initBodyLockSafety, scheduleBodyLockRelease } from "$lib/body-lock";

export type Screen = "home" | "editor";
export type Overlay =
  | "none"
  | "filetree"
  | "preview"
  | "diagnostics"
  | "settings"
  | "quickswitcher"
  | "tabswitcher"
  | "export";

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
  private historyInitialized = false;
  private cleanup: (() => void) | null = null;
  private pendingHistory = new Set<() => void>();

  /** Register the popstate listener once (call from the root component). */
  init() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    if (!this.historyInitialized) {
      history.replaceState({ screen: this.screen, overlay: this.overlay } satisfies HistoryState, "");
      this.historyInitialized = true;
    } else {
      this.applyState(history.state as HistoryState | null);
    }
    const windowTarget = window;
    const documentTarget = document;
    const onPopState = (e: PopStateEvent) => this.applyState(e.state as HistoryState | null);
    windowTarget.addEventListener("popstate", onPopState);
    // Backgrounding and coming back is the only gesture left to a user staring
    // at an app that has stopped accepting taps — make it a recovery path.
    const onVisibility = () => {
      if (documentTarget.visibilityState === "visible") scheduleBodyLockRelease();
    };
    documentTarget.addEventListener("visibilitychange", onVisibility);
    initBodyLockSafety();
    this.cleanup = () => {
      windowTarget.removeEventListener("popstate", onPopState);
      documentTarget.removeEventListener("visibilitychange", onVisibility);
      destroyBodyLockSafety();
    };
  }

  destroy() {
    this.initialized = false;
    this.cleanup?.();
    this.cleanup = null;
    for (const done of this.pendingHistory) done();
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
    if (nextOverlay === "none") scheduleBodyLockRelease();
  }

  /** Enter the editor screen (pushes a history entry so back returns home).
   *  Re-entering from the editor — switching workspace without going home —
   *  replaces the current entry instead, so back still lands on home. */
  openEditor() {
    const entering = this.screen !== "editor";
    this.screen = "editor";
    this.overlay = "none";
    const state = { screen: "editor", overlay: "none" } satisfies HistoryState;
    if (entering) history.pushState(state, "");
    else history.replaceState(state, "");
    // Re-entering (a workspace switch from the file tree) closes the sheet and
    // the switcher drawer together — the case most likely to strand the lock.
    scheduleBodyLockRelease();
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

  /** Close the current overlay and resolve once the history state has been
   *  applied. `history.back()` is asynchronous, so anything that pushes or
   *  replaces an entry afterwards (e.g. switching workspace from the file tree)
   *  must wait for the popstate or it races with it. */
  closeOverlayAsync(): Promise<void> {
    if (this.overlay === "none") return Promise.resolve();
    return new Promise((resolve) => {
      // Declared before `done` so the closure can't reach it in its temporal
      // dead zone. `history.back()` only queues the traversal today, but that's
      // the spec's guarantee, not this function's.
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const target = window;
      // Resolves on the first popstate whichever entry it lands on — a
      // concurrent back press satisfies the wait too, and all the caller needs
      // is that history has settled. Our own popstate listener was registered
      // first, so `screen`/`overlay` are already up to date when this runs.
      const done = () => {
        if (settled) return;
        settled = true;
        target.removeEventListener("popstate", done);
        if (timer !== null) clearTimeout(timer);
        this.pendingHistory.delete(done);
        resolve();
      };
      // Safety net: never leave a caller hanging if no popstate arrives.
      timer = setTimeout(done, 300);
      this.pendingHistory.add(done);
      target.addEventListener("popstate", done);
      history.back();
    });
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
