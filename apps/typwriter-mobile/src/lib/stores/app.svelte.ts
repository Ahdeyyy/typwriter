// Screen + overlay navigation, integrated with the browser history stack so
// the Android back gesture closes overlays before exiting the editor, and
// exits the editor before leaving the app. Every overlay component must use
// `openOverlay` / `closeOverlay` — never set `overlay` directly.
//
// Smaller modals that aren't overlays (dialogs, drawers, dropdown menus) are
// *layers*: each one pushes an entry on top of the current screen/overlay entry
// so back dismisses it instead of leaving the screen. Register them with
// `dismissOnBack` (`lib/back-dismiss.svelte.ts`), never `pushLayer` directly.
//
// Layer entries are kept strictly on top of the stack: every navigation first
// collapses the open layers in one traversal, and every history write waits
// until our own traversals have landed. `history.back()` is asynchronous, so a
// push issued before it lands goes on the wrong entry.

import { destroyBodyLockSafety, initBodyLockSafety, scheduleBodyLockRelease } from "$lib/body-lock";

export type Screen = "home" | "editor";
export type Overlay =
  | "none"
  | "filetree"
  | "preview"
  | "diagnostics"
  | "settings"
  | "licenses"
  | "quickswitcher"
  | "tabswitcher"
  | "export";

interface HistoryState {
  screen?: Screen;
  overlay?: Overlay;
  /** How many layer entries sit above the base entry, counting this one. */
  layer?: number;
}

interface Layer {
  close: () => void;
  pushed: boolean;
}

/** Give up on a traversal of ours that never reported back. */
const SELF_POP_TIMEOUT_MS = 300;

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

  /** Open layers, oldest first. The pushed ones are always a prefix. */
  private layers: Layer[] = [];
  /** Layer depth of the current history entry. */
  private depth = 0;
  /** Traversals we started to retire layer entries. They land on an entry
   *  whose screen and overlay are already applied, so their popstate is
   *  swallowed. */
  private selfPops = 0;
  private selfPopTimer: ReturnType<typeof setTimeout> | null = null;
  private deferred: (() => void)[] = [];

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
    const onPopState = (e: PopStateEvent) => this.onPopState(e.state as HistoryState | null);
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
    this.layers = [];
    this.depth = 0;
    this.selfPops = 0;
    if (this.selfPopTimer !== null) clearTimeout(this.selfPopTimer);
    this.selfPopTimer = null;
    this.deferred = [];
  }

  private onPopState(state: HistoryState | null) {
    if (this.selfPops > 0) {
      this.selfPops--;
      if (this.selfPops === 0) this.settle();
      return;
    }
    // A back press that lands below open layers dismisses them, newest first.
    const nextDepth = state?.layer ?? 0;
    if (nextDepth < this.depth) {
      const closing = this.layers.splice(nextDepth).reverse();
      for (const layer of closing) layer.close();
    }
    this.depth = nextDepth;
    this.applyState(state);
  }

  /** Run `fn` once every traversal we started has landed. */
  private whenSettled(fn: () => void) {
    if (this.selfPops === 0) fn();
    else this.deferred.push(fn);
  }

  private settle() {
    if (this.selfPopTimer !== null) clearTimeout(this.selfPopTimer);
    this.selfPopTimer = null;
    // A deferred step may start a traversal of its own; the rest waits for it.
    while (this.selfPops === 0 && this.deferred.length > 0) this.deferred.shift()!();
  }

  /** Step back over `n` layer entries without re-applying the landing state. */
  private retireEntries(n: number) {
    this.depth -= n;
    this.selfPops++;
    if (this.selfPopTimer !== null) clearTimeout(this.selfPopTimer);
    this.selfPopTimer = setTimeout(() => {
      this.selfPops = 0;
      this.settle();
    }, SELF_POP_TIMEOUT_MS);
    history.go(-n);
  }

  /** Close every open layer and retire their entries in one traversal, ahead
   *  of a navigation that must start from the base entry. */
  private collapseLayers() {
    if (this.layers.length === 0) return;
    const closing = this.layers.splice(0).reverse();
    const pushed = closing.filter((layer) => layer.pushed).length;
    for (const layer of closing) layer.close();
    if (pushed > 0) this.whenSettled(() => this.retireEntries(pushed));
  }

  /** Register an open layer: back now calls `close` instead of navigating.
   *  Returns the release to call once the layer has closed by other means. */
  pushLayer(close: () => void): () => void {
    const layer: Layer = { close, pushed: false };
    this.layers.push(layer);
    this.whenSettled(() => {
      // Closed (or collapsed) before its entry could be pushed.
      if (!this.layers.includes(layer)) return;
      layer.pushed = true;
      this.depth++;
      history.pushState(
        { screen: this.screen, overlay: this.overlay, layer: this.depth } satisfies HistoryState,
        "",
      );
    });
    return () => {
      const index = this.layers.indexOf(layer);
      // Already dismissed by back or collapsed: its entry is gone.
      if (index === -1) return;
      this.layers.splice(index, 1);
      // Entries differ only by depth, so retiring the top one is equivalent
      // even when this layer wasn't the newest.
      if (layer.pushed) this.whenSettled(() => this.retireEntries(1));
    };
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
    this.collapseLayers();
    this.screen = "editor";
    this.overlay = "none";
    const state = { screen: "editor", overlay: "none" } satisfies HistoryState;
    this.whenSettled(() => {
      if (entering) history.pushState(state, "");
      else history.replaceState(state, "");
    });
    // Re-entering (a workspace switch from the file tree) closes the sheet and
    // the switcher drawer together — the case most likely to strand the lock.
    scheduleBodyLockRelease();
  }

  openOverlay(o: Overlay) {
    this.collapseLayers();
    this.overlay = o;
    const state = { screen: this.screen, overlay: o } satisfies HistoryState;
    this.whenSettled(() => history.pushState(state, ""));
  }

  /** Close the current overlay via history so back behaves natively. */
  closeOverlay() {
    if (this.overlay === "none") return;
    this.collapseLayers();
    this.whenSettled(() => history.back());
  }

  /** Close the current overlay and resolve once the history state has been
   *  applied. `history.back()` is asynchronous, so anything that pushes or
   *  replaces an entry afterwards (e.g. switching workspace from the file tree)
   *  must wait for the popstate or it races with it. */
  closeOverlayAsync(): Promise<void> {
    if (this.overlay === "none") return Promise.resolve();
    this.collapseLayers();
    return new Promise((resolve) => this.whenSettled(() => {
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
    }));
  }

  /** Return to the home screen (e.g. "Close workspace"). */
  goHome() {
    if (this.screen !== "editor") return;
    this.collapseLayers();
    // If an overlay is open, close it first, then the editor entry.
    const steps = this.overlay !== "none" ? 2 : 1;
    this.whenSettled(() => history.go(-steps));
  }
}

export const app = new AppStore();
