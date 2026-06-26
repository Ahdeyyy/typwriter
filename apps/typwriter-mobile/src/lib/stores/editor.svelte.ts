// Single open document. Keystrokes never cross IPC — they stay in CodeMirror.
// `flush()` is the only writer: it runs on the autosave timer, on blur, on
// preview-open, on file switch, on leaving the editor, and on app backgrounding.

import { ResultAsync, okAsync } from "neverthrow";
import type { EditorView } from "@codemirror/view";
import * as ipc from "$lib/ipc/commands";
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

  /** Restore tabs for a freshly opened workspace and activate one (or none). */
  seedTabs(tabs: string[], active: string | null) {
    this.tabs = [...tabs];
    if (active) {
      void this.loadFile(active);
    } else if (tabs.length) {
      void this.loadFile(tabs[0]);
    } else {
      this.newTabOpen = true;
      this.clearFile();
    }
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

  /** Whether `relPath` is the active tab's file. */
  isActiveTab(relPath: string): boolean {
    return !this.newTabOpen && this.relPath === relPath;
  }

  /** Drop the active document (empty-tab / closed-workspace state). */
  private clearFile() {
    this.relPath = null;
    this.fileKind = null;
    this.loadedText = "";
    this.imageDataUrl = null;
    this.dirty = false;
  }

  /** Reset all tab state (e.g. on closing a workspace). */
  resetTabs() {
    this.tabs = [];
    this.newTabOpen = false;
    this.clearFile();
  }

  private persistTabs() {
    if (this.tabsTimer) clearTimeout(this.tabsTimer);
    this.tabsTimer = setTimeout(() => {
      const active = this.newTabOpen ? null : this.relPath;
      void ipc.setOpenTabs([...this.tabs], active);
    }, 400);
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
