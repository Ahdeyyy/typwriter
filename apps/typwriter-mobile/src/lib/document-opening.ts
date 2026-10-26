import { toast } from "svelte-sonner";
import * as ipc from "$lib/ipc/commands";
import { onOpenFiles, type UnlistenFn } from "$lib/ipc/events";
import { settings } from "$lib/stores/settings.svelte";
import { workspace } from "$lib/stores/workspace.svelte";

export async function pickDocument(): Promise<void> {
  await settings.init();
  const result = await workspace.pickDocument();
  if (result.isErr()) toast.error(`Failed to open document: ${result.error}`, { duration: 15000 });
}

/** Subscribe before draining, so cold and warm opens have the same owner. */
export function startDocumentOpening() {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  let running: Promise<void> | null = null;
  let requested = false;

  function drain(): Promise<void> {
    requested = true;
    if (running) return running;
    running = (async () => {
      await settings.init();
      while (requested && !disposed) {
        requested = false;
        const pending = await ipc.takeOpenFiles();
        if (disposed) return;
        if (pending.isErr()) {
          toast.error(`Failed to receive document: ${pending.error}`);
          return;
        }
        for (const uri of pending.value) {
          if (disposed) return;
          const result = await workspace.openDocument(uri);
          if (result.isErr()) toast.error(`Failed to open document: ${result.error}`);
        }
      }
    })().finally(() => {
      running = null;
      // A wakeup can arrive after the last loop check but before this promise
      // settles. Keep that request owned by a new drain.
      if (requested && !disposed) void drain();
    });
    return running;
  }

  const onVisibility = () => {
    if (document.visibilityState === "visible") void drain();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const ready = (async () => {
    const listener = await onOpenFiles(() => { void drain(); });
    if (listener.isOk()) {
      if (disposed) listener.value();
      else unlisten = listener.value;
    } else {
      console.error("File-open subscription failed:", listener.error);
    }
    if (!disposed) await drain();
  })();

  return {
    ready,
    destroy() {
      disposed = true;
      unlisten?.();
      unlisten = null;
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
