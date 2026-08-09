// Single open document. Keystrokes never cross IPC — they stay in CodeMirror.
// `flush()` is the only writer: it runs on the autosave timer, on blur, on
// preview-open, on file switch, on leaving the editor, and on app backgrounding.

import { ResultAsync, okAsync } from "neverthrow";
import type { EditorView } from "@codemirror/view";
import * as ipc from "$lib/ipc/commands";
import { remapPath } from "$lib/paths";
import { settings } from "./settings.svelte";
import { compileStore } from "./compile.svelte";

export type FileKind = "text" | "image" | "unsupported";

/** Debounce before a live diagnostics compile (after typing pauses). */
const LIVE_COMPILE_MS = 400;

class EditorStore {
  relPath = $state<string | null>(null);
  fileKind = $state<FileKind | null>(null);
  imageDataUrl = $state<string | null>(null);
  dirty = $state(false);
  saving = $state(false);
  loading = $state(false);

  /** Open editor tabs (workspace-relative file paths), Obsidian-style. */
  tabs = $state<string[]>([]);
  /** True when the active tab is an empty "new tab" (no file selected yet). */
  newTabOpen = $state(false);

  /** Text most recently loaded from disk; the editor screen seeds CM with it. */
  loadedText = $state("");
  /** Set by the screen component once the EditorView exists. */
  view: EditorView | null = null;

  /** Caret to place once the restored file's text reaches CodeMirror (UTF-16
   *  code units), tagged with the file it belongs to. Set by `seedTabs` on
   *  workspace open and consumed by the editor host — deliberately not
   *  reactive: it's a one-shot hand-off, not rendered state. */
  private pendingCursor: { relPath: string; offset: number } | null = null;
  /** Whether `pendingCursor` may be claimed yet. The editor host is mounted
   *  inside the screen's loading branch, so it mounts once against the *old*
   *  buffer before `loadFile` flips `loading`, and again once the new text has
   *  landed. Only that second mount may take the caret — otherwise the restore
   *  is spent on a document that is about to be replaced. */
  private pendingCursorReady = false;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private tabsTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: ResultAsync<void, string> | null = null;
  /** Suppresses the dirty flag while we replace the doc programmatically. */
  private suppressChange = false;

  /** Run a programmatic CM mutation (e.g. loading a file) without marking the
   *  buffer dirty — `setState`/`dispatch` fire the updateListener synchronously. */
  programmatic(fn: () => void) {
    this.suppressChange = true;
    try {
      fn();
    } finally {
      this.suppressChange = false;
    }
  }

  /** Derived display name (last path segment) for the top bar. */
  get fileName(): string | null {
    if (!this.relPath) return null;
    const parts = this.relPath.split("/");
    return parts[parts.length - 1] ?? this.relPath;
  }

  /**
   * Title for the top bar: the file's basename, disambiguated by a parent-folder
   * prefix when another open tab shares the same basename (the scheme the desktop
   * tab bar uses). Null on an empty new tab.
   */
  get displayName(): string | null {
    if (this.newTabOpen || !this.relPath) return null;
    const name = this.fileName;
    if (!name) return null;
    const basename = (p: string) => {
      const parts = p.split("/");
      return parts[parts.length - 1] ?? p;
    };
    const duplicated = this.tabs.filter((t) => basename(t) === name).length > 1;
    if (!duplicated) return name;
    const parts = this.relPath.split("/");
    return parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name;
  }

  loadFile(relPath: string): ResultAsync<void, string> {
    return this.flush().andThen(() => {
      this.loading = true;
      this.newTabOpen = false;
      this.relPath = relPath;
      this.imageDataUrl = null;
      return ipc
        .readFile(relPath)
        .map((content) => {
          if (content.type === "text") {
            this.fileKind = "text";
            this.loadedText = content.content;
            this.dirty = false;
            // The buffer this caret was recorded against is now the one the
            // host will seed; anything else means the user navigated away
            // mid-restore, so the caret no longer applies.
            if (this.pendingCursor?.relPath === relPath) {
              this.pendingCursorReady = true;
            } else {
              this.pendingCursor = null;
            }
          } else if (content.type === "image") {
            this.fileKind = "image";
            this.imageDataUrl = content.data;
          } else {
            this.fileKind = "unsupported";
          }
          this.loading = false;
          // Ensure this file has a tab and is the active one.
          if (!this.tabs.includes(relPath)) this.tabs = [...this.tabs, relPath];
          void ipc.setLastFile(relPath);
          this.persistTabs();
        })
        .mapErr((e) => {
          this.loading = false;
          return e;
        });
    });
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  /** Restore tabs for a freshly opened workspace and activate one (or none).
   *  `cursor` is the caret the active file was left at; pass null when the
   *  activated file isn't the one the caret was recorded in. */
  seedTabs(tabs: string[], active: string | null, cursor: number | null = null) {
    this.tabs = [...tabs];
    this.pendingCursor =
      active && cursor !== null && cursor >= 0 ? { relPath: active, offset: cursor } : null;
    this.pendingCursorReady = false;
    if (active) {
      void this.loadFile(active);
    } else if (tabs.length) {
      void this.loadFile(tabs[0]);
    } else {
      this.newTabOpen = true;
      this.clearFile();
    }
  }

  /** Claim the restored caret for `relPath`, once its text has been read and
   *  only for the file it was recorded in. One-shot: a second call returns
   *  null, so a later re-seed of the same buffer doesn't yank the caret back. */
  takePendingCursor(relPath: string): number | null {
    const pending = this.pendingCursor;
    if (!pending || !this.pendingCursorReady || pending.relPath !== relPath) return null;
    this.pendingCursor = null;
    this.pendingCursorReady = false;
    return pending.offset;
  }

  /**
   * Open `relPath` and put the caret at `offset` (UTF-16 code units), scrolling
   * it into view. Used by the preview's tap-to-source jump.
   *
   * When the file is already the active buffer the caret moves directly;
   * otherwise the offset rides the same one-shot hand-off the workspace restore
   * uses (`pendingCursor`), because the editor host is torn down and remounted
   * around every load — dispatching into the outgoing view would be lost, and
   * the new one seeds itself from `loadedText`.
   *
   * Deliberately does not focus the editor: the jump already swaps screens, and
   * popping the soft keyboard on arrival would hide the line the user asked to
   * see.
   */
  jumpTo(relPath: string, offset: number): ResultAsync<void, string> {
    const view = this.view;
    if (view && this.isActiveTab(relPath) && this.fileKind === "text") {
      const pos = Math.max(0, Math.min(offset, view.state.doc.length));
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      this.handleCursorMoved();
      return okAsync(undefined);
    }
    this.pendingCursor = { relPath, offset };
    this.pendingCursorReady = false;
    return this.loadFile(relPath).mapErr((e) => {
      this.pendingCursor = null;
      return e;
    });
  }

  /** Open an empty "new tab" — the editor shows the open/create/switch options. */
  openNewTab() {
    void this.flush();
    this.newTabOpen = true;
    this.clearFile();
    this.persistTabs();
  }

  /** Close a tab; activate a neighbour, or fall back to an empty new tab. */
  closeTab(relPath: string) {
    const idx = this.tabs.indexOf(relPath);
    if (idx < 0) return;
    const wasActive = !this.newTabOpen && this.relPath === relPath;
    const next = this.tabs.filter((t) => t !== relPath);
    this.tabs = next;
    if (wasActive) {
      if (next.length) {
        void this.loadFile(next[Math.min(idx, next.length - 1)]);
      } else {
        void this.flush();
        this.newTabOpen = true;
        this.clearFile();
      }
    }
    this.persistTabs();
  }

  /** Close every tab but `relPath`, which becomes the active one. */
  closeOtherTabs(relPath: string) {
    if (!this.tabs.includes(relPath)) return;
    this.tabs = [relPath];
    if (!this.isActiveTab(relPath)) void this.loadFile(relPath);
    this.persistTabs();
  }

  /** Close every tab, leaving an empty new tab. */
  closeAllTabs() {
    void this.flush();
    this.tabs = [];
    this.newTabOpen = true;
    this.clearFile();
    this.persistTabs();
  }

  /** Whether `relPath` is the active tab's file. */
  isActiveTab(relPath: string): boolean {
    return !this.newTabOpen && this.relPath === relPath;
  }

  /**
   * Carry the open tabs — and the active buffer — across a file or folder
   * rename, move, or delete. `to` is null when the entry was deleted.
   *
   * Tabs hold workspace-relative paths, so without this an entry changing its
   * name on disk leaves every tab that references it pointing at a path that no
   * longer exists: the tab bar shows the old name, reopening it fails, and — the
   * damaging one — the next autosave writes the buffer back to the *old* path,
   * recreating the file the user just renamed away.
   *
   * A renamed active file keeps its buffer, caret and dirty flag untouched; only
   * where it saves to changes. The paths on disk have already moved by the time
   * this runs, so nothing is re-read.
   */
  applyEntryChange(from: string, to: string | null) {
    const active = this.newTabOpen ? null : this.relPath;

    const remapped: string[] = [];
    // Where the active tab sits among the *survivors* — the index to fall back
    // to if it was the one deleted. Counting its old index instead would be
    // wrong whenever the same delete took tabs ahead of it (a folder holding
    // several open files), because those shift everything left.
    let survivorsBeforeActive = 0;
    let reachedActive = false;
    for (const tab of this.tabs) {
      if (tab === active) reachedActive = true;
      const change = remapPath(tab, from, to);
      if (change.kind === "gone") continue;
      const next = change.kind === "moved" ? change.to : tab;
      // A move can land on a path another tab already holds open.
      if (remapped.includes(next)) continue;
      remapped.push(next);
      if (!reachedActive) survivorsBeforeActive++;
    }
    this.tabs = remapped;

    // A caret waiting to be restored is addressed by path too.
    if (this.pendingCursor) {
      const change = remapPath(this.pendingCursor.relPath, from, to);
      if (change.kind === "gone") {
        this.pendingCursor = null;
        this.pendingCursorReady = false;
      } else if (change.kind === "moved") {
        this.pendingCursor = { relPath: change.to, offset: this.pendingCursor.offset };
      }
    }

    if (active) {
      const change = remapPath(active, from, to);
      if (change.kind === "moved") {
        this.relPath = change.to;
        void ipc.setLastFile(change.to);
      } else if (change.kind === "gone") {
        // Never write a deleted file back out: drop the buffer and everything
        // scheduled against it, then fall back the way closing its tab would.
        this.discardPendingWrites();
        if (this.tabs.length) {
          // Deliberately no `persistTabsNow()` on this path. `loadFile` moves
          // `relPath` in a microtask, so a persist here would still see the
          // *deleted* path and write it out as the active tab — over the
          // metadata the backend just remapped correctly. That metadata is
          // already right; `loadFile` refreshes it once the switch lands.
          void this.loadFile(this.tabs[Math.min(survivorsBeforeActive, this.tabs.length - 1)]);
          return;
        }
        this.newTabOpen = true;
        this.clearFile();
      }
    }

    this.persistTabsNow();
  }

  /**
   * Give up on writing the active buffer when `relPath` is about to be deleted,
   * and resolve once nothing is still being written.
   *
   * Cancelling the timers is not enough on its own: a `flush()` already crossing
   * IPC has no ordering guarantee against `delete_entry`, so its write can land
   * *after* the unlink and put the file back on disk — the resurrection this
   * whole path exists to prevent. Waiting for the in-flight write to settle
   * before deleting is what actually orders the two.
   *
   * A pending write to some *other* file keeps its autosave; we only wait.
   */
  abandonWrites(relPath: string): ResultAsync<void, string> {
    const active = this.newTabOpen ? null : this.relPath;
    if (active && remapPath(active, relPath, null).kind === "gone") {
      this.discardPendingWrites();
    }
    // A failed save must not block the delete — the user asked for the file to
    // go away either way.
    return (this.inflight ?? okAsync(undefined)).orElse(() => okAsync(undefined));
  }

  /** Forget the pending buffer: no autosave, no live compile, nothing dirty.
   *  Used when the open file has been deleted out from under the editor. */
  private discardPendingWrites() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.saveTimer = null;
    this.liveTimer = null;
    this.dirty = false;
  }

  /** Drop the active document (empty-tab / closed-workspace state). */
  private clearFile() {
    this.relPath = null;
    this.fileKind = null;
    this.loadedText = "";
    this.imageDataUrl = null;
    this.dirty = false;
  }

  /**
   * Reset all tab state (e.g. on closing or switching workspace), along with
   * every debounced follow-up still scheduled against the workspace we're
   * leaving: the tab persist (its tabs would land in the next workspace), the
   * autosave and the live compile (both would run against the wrong root — the
   * compile would clobber the fresh `onWorkspaceOpened` state with a compile of
   * the new workspace). `clearFile()` below already makes a late autosave a
   * no-op, but leaving live timers armed across a root swap is a trap.
   */
  resetTabs() {
    for (const timer of [this.tabsTimer, this.saveTimer, this.liveTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.tabsTimer = null;
    this.saveTimer = null;
    this.liveTimer = null;
    this.pendingCursor = null;
    this.pendingCursorReady = false;
    this.tabs = [];
    this.newTabOpen = false;
    this.clearFile();
  }

  private persistTabs() {
    if (this.tabsTimer) clearTimeout(this.tabsTimer);
    this.tabsTimer = setTimeout(() => this.persistTabsNow(), 400);
  }

  /** Write the tab state (and the active buffer's caret) out immediately.
   *  Used when the app is about to be backgrounded, where a debounced write
   *  may never fire. */
  persistTabsNow() {
    if (this.tabsTimer) {
      clearTimeout(this.tabsTimer);
      this.tabsTimer = null;
    }
    const active = this.newTabOpen ? null : this.relPath;
    // Caret only travels with a text buffer — an image or unsupported file has
    // none, and neither does an empty new tab.
    const cursor =
      active && this.fileKind === "text" ? (this.view?.state.selection.main.head ?? null) : null;
    void ipc.setOpenTabs([...this.tabs], active, cursor);
  }

  /** Called from CM's updateListener whenever the caret moves — by a tap, an
   *  arrow key or a keystroke. Keeps the persisted caret current: every other
   *  persist trigger is a tab operation, so without this the stored offset
   *  would only ever be the one from the last tab switch. Debounced like the
   *  rest of the tab persist, so a burst of typing writes once. */
  handleCursorMoved() {
    this.persistTabs();
  }

  /** Called from CM's updateListener on every doc change. NO IPC here. */
  handleDocChanged() {
    if (this.suppressChange) return;
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), settings.autosaveMs);
    // Keep diagnostics live: debounce a compile that follows a save. This does
    // NOT render the preview (renderer stays lazy) — it only refreshes
    // errors/warnings. Debounced so it never runs on the per-keystroke hot path.
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      void this.flush().andThen(() => compileStore.run());
    }, LIVE_COMPILE_MS);
  }

  /**
   * Format the active `.typ` buffer with typstyle, preserving the caret.
   * No-op for image / unsupported / non-`.typ` files or an empty new tab.
   * Cursor maintenance happens in Rust (UTF-8 bytes); the IPC boundary is the
   * only place we deal in UTF-16 code units.
   */
  formatActive(): ResultAsync<void, string> {
    const view = this.view;
    if (this.fileKind !== "text" || !this.relPath || !view) return okAsync(undefined);
    if (!this.relPath.endsWith(".typ")) return okAsync(undefined);

    const original = view.state.doc.toString();
    const cursor = view.state.selection.main.head;
    return ipc.formatTypstSourceWithCursor(original, cursor).map((res) => {
      // The format ran across an IPC await: if the user typed in the meantime,
      // or the document was already formatted, leave the buffer untouched.
      if (view.state.doc.toString() !== original) return;
      if (res.formatted === original) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: res.formatted },
        selection: { anchor: Math.min(res.cursor, res.formatted.length) },
        scrollIntoView: true,
      });
      // The dispatch fires CM's updateListener (handleDocChanged), marking the
      // buffer dirty and scheduling autosave; flush now so the change persists
      // and diagnostics/preview refresh promptly.
      void this.flush();
    });
  }

  /** Persist now. Single-flight: concurrent calls coalesce. */
  flush(): ResultAsync<void, string> {
    if (this.inflight) return this.inflight;
    if (!this.dirty || this.fileKind !== "text" || !this.relPath || !this.view) {
      return okAsync(undefined);
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const relPath = this.relPath;
    const content = this.view.state.doc.toString();
    this.saving = true;
    const run = ipc
      .saveFile(relPath, content)
      .map(() => {
        this.dirty = false;
        this.saving = false;
        this.inflight = null;
        compileStore.onSaved();
      })
      .mapErr((e) => {
        this.saving = false;
        this.inflight = null;
        return e;
      });
    this.inflight = run;
    return run;
  }
}

export const editor = new EditorStore();
