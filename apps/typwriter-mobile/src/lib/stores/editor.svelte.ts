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

  /** Text most recently loaded from disk; the editor screen seeds CM with it.
   *  On the block surface — where no full-document CM exists — this doubles as
   *  the master buffer, rewritten on every block commit. */
  loadedText = $state("");
  /** Set by the screen component once the EditorView exists. Null while the
   *  block surface is shown. */
  view: EditorView | null = null;
  /** The mini-editor mounted into the active block, when the block surface is
   *  editing one. It holds a *slice* of the document, never the whole thing. */
  subView = $state<EditorView | null>(null);
  /** Master-document offset of `subView`'s first character. */
  subOffset = 0;
  /** Returns the master document with `subView`'s live text spliced in. Set by
   *  the block surface alongside `subView`, so an autosave mid-edit persists
   *  what's on screen instead of the pre-edit text. */
  liveText: (() => string) | null = null;

  /** The view holding the caret — the block mini-editor when one is mounted.
   *  Toolbar commands and completions act on this. */
  get activeView(): EditorView | null {
    return this.subView ?? this.view;
  }

  /** The whole document as it currently stands, wherever the buffer lives. */
  get text(): string {
    if (this.liveText) return this.liveText();
    return this.view ? this.view.state.doc.toString() : this.loadedText;
  }

  /**
   * Resolve `view`'s text + cursor into master-document coordinates. A block's
   * mini-editor only holds its own span, so language features (completions)
   * would otherwise run against a fragment of the file.
   */
  masterContext(
    view: EditorView,
    offset: number,
  ): { text: string; offset: number } {
    if (view === this.subView && this.liveText) {
      return { text: this.text, offset: this.subOffset + offset };
    }
    return { text: view.state.doc.toString(), offset };
  }

  /** Master-document offset → offset within `view`. */
  localOffset(view: EditorView, masterOffset: number): number {
    return view === this.subView ? masterOffset - this.subOffset : masterOffset;
  }

  /** Replace the whole buffer — a block-surface commit. Marks the buffer dirty
   *  and schedules autosave exactly as typing does. */
  replaceText(next: string) {
    const view = this.view;
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    } else {
      this.loadedText = next;
      this.handleDocChanged();
    }
  }

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
    // The block surface drives its own save → compile → refresh chain when a
    // block is committed; a second debounced compile here would double the
    // work on every edit.
    if (settings.editorSurface === "blocks") return;
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
    // Formats whichever buffer has the caret: the whole file on the classic
    // surface, the active block's source on the block surface.
    const view = this.activeView;
    if (this.fileKind !== "text" || !this.relPath || !view)
      return okAsync(undefined);
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
    if (!this.dirty || this.fileKind !== "text" || !this.relPath) {
      return okAsync(undefined);
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const relPath = this.relPath;
    const content = this.text;
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
