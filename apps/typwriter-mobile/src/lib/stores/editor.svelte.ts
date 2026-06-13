// Single open document. Keystrokes never cross IPC — they stay in CodeMirror.
// `flush()` is the only writer: it runs on the autosave timer, on blur, on
// preview-open, on file switch, on leaving the editor, and on app backgrounding.

import { ResultAsync, okAsync } from "neverthrow";
import type { EditorView } from "@codemirror/view";
import * as ipc from "$lib/ipc/commands";
import { settings } from "./settings.svelte";
import { compileStore } from "./compile.svelte";

export type FileKind = "text" | "image" | "unsupported";

class EditorStore {
  relPath = $state<string | null>(null);
  fileKind = $state<FileKind | null>(null);
  imageDataUrl = $state<string | null>(null);
  dirty = $state(false);
  saving = $state(false);
  loading = $state(false);

  /** Text most recently loaded from disk; the editor screen seeds CM with it. */
  loadedText = $state("");
  /** Set by the screen component once the EditorView exists. */
  view: EditorView | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
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
          void ipc.setLastFile(relPath);
        })
        .mapErr((e) => {
          this.loading = false;
          return e;
        });
    });
  }

  /** Called from CM's updateListener on every doc change. NO IPC here. */
  handleDocChanged() {
    if (this.suppressChange) return;
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), settings.autosaveMs);
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
