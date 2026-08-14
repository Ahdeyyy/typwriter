// Compile state: page metadata, diagnostics, and staleness for the current
// document. Compiles are never driven per keystroke (that froze the app on
// device) — they are triggered by the hooks below, which fire on save, on a
// main-file change, and on workspace open. `onSaved` only recompiles eagerly
// while the preview overlay is open; otherwise the document is marked stale
// and the compile waits until the user opens the preview.

import { ResultAsync } from "neverthrow";
import type { Diagnostic, PageMeta } from "$lib/ipc/types";
import * as ipc from "$lib/ipc/commands";
import { app } from "./app.svelte";

export type CompileStatus = "idle" | "compiling" | "ok" | "error";

class CompileStore {
  status = $state<CompileStatus>("idle");
  pages = $state<PageMeta[]>([]);
  errors = $state<Diagnostic[]>([]);
  warnings = $state<Diagnostic[]>([]);
  stale = $state(true);
  lastGeneration = 0;

  /** Drop every compile result — there is no document to show (no main file). */
  clear() {
    this.pages = [];
    this.errors = [];
    this.warnings = [];
    this.status = "idle";
    this.stale = true;
  }

  /** Called by editor.flush() after every successful save — and by any other
   *  change to what's on disk, since that's what the compiler reads. */
  onSaved() {
    this.stale = true;
    // Background-refresh only while the preview is open (reading); otherwise
    // wait until the user opens the preview.
    if (app.overlay === "preview") void this.run();
  }

  /**
   * The active document changed (a new main file was set). Unlike a same-file
   * edit — where we keep the last render visible until the new one arrives —
   * a document switch must drop the old pages so the preview never shows the
   * previous document's content. We then rebuild eagerly in the background so
   * the render is ready (and correct) the moment the preview is opened.
   */
  onMainChanged() {
    this.pages = [];
    this.errors = [];
    this.warnings = [];
    this.status = "compiling";
    this.stale = true;
    void this.run();
  }

  /**
   * A different workspace was opened. The old workspace's pages must never be
   * shown (the backend also dropped its compiled document), so clear
   * everything; when the new workspace has a main file, eagerly rebuild in the
   * background so the preview is correct the moment it's opened.
   */
  onWorkspaceOpened(hasMain: boolean) {
    if (hasMain) {
      this.onMainChanged();
    } else {
      this.clear();
    }
  }

  run(): ResultAsync<void, string> {
    this.status = "compiling";
    return ipc.compile().map((res) => {
      // Discard stale responses.
      if (res.generation < this.lastGeneration) return;
      this.lastGeneration = res.generation;
      this.errors = res.errors;
      this.warnings = res.warnings;
      if (res.pages !== null) {
        this.pages = res.pages;
        this.stale = false;
        this.status = res.errors.length ? "error" : "ok";
      } else {
        // Failed compile: keep the last good render visible.
        this.status = "error";
      }
    });
  }
}

export const compileStore = new CompileStore();
