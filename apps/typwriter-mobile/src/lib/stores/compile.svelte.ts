// Compile state. Phase 3/4 use the `onSaved()` no-op hook; the full compile
// flow (eager compile when preview is open, generation staleness, page
// metadata) arrives in phase 6 (06-preview.md).

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

  /** Called by editor.flush() after every successful save. */
  onSaved() {
    this.stale = true;
    // Background-refresh only while the preview is open (reading); otherwise
    // wait until the user opens the preview.
    if (app.overlay === "preview") void this.run();
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
