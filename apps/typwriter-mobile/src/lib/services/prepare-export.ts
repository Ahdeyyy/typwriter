import { errAsync, okAsync } from "neverthrow";
import type { ExportFormat } from "$lib/ipc/types";
import { editor } from "$lib/stores/editor.svelte";
import { compileStore } from "$lib/stores/compile.svelte";

/** Always save first, even when the last compile was fresh before this edit.
 * HTML compiles independently in the backend; paged exports use its cached
 * document. A diagnostic failure may retain that document, as the UI states. */
export function prepareExport(format: ExportFormat, ownsRequest: () => boolean) {
  return editor.flush().andThen(() => {
    if (!ownsRequest()) return errAsync("Export cancelled");
    if (format === "html") return okAsync(undefined);
    if (compileStore.stale || compileStore.status === "compiling" || !compileStore.pages.length) {
      return compileStore.run();
    }
    return okAsync(undefined);
  }).andThen(() => {
    if (!ownsRequest()) return errAsync("Export cancelled");
    if (format !== "html" && !compileStore.pages.length) return errAsync("No compiled document to export");
    if (format !== "html" && compileStore.stale && compileStore.status !== "error") {
      return errAsync("Document changed while preparing export. Try again.");
    }
    return okAsync(undefined);
  });
}
