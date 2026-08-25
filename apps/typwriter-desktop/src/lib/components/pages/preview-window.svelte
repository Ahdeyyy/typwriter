<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { preview } from "$lib/stores/preview.svelte";
  import { onPresentationToggleRequest } from "$lib/ipc/events";
  import { matchesCommand } from "$lib/keybindings";
  import { logError } from "$lib/logger";
  import { toast } from "svelte-sonner";

  type Props = { autoPresent?: boolean; initialPage?: string | null };
  let { autoPresent = false, initialPage = null }: Props = $props();

  let presentRequestUnlisten: (() => void) | null = null;

  // Seed the shared visiblePage from the URL before <Preview> mounts. The
  // cross-window ask/reply that would otherwise deliver it is asynchronous,
  // and the mount restore must not run against the default page 0. Reading
  // the prop once, non-reactively, is deliberate — it's a boot-time seed.
  {
    // svelte-ignore state_referenced_locally
    const parsed = initialPage === null ? NaN : Number.parseInt(initialPage, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      preview.visiblePage = parsed;
    }
  }

  /** Enter presentation mode and tell the user how to get out. Entering can
   *  fail for real reasons (no display detected, the window call was refused),
   *  so surface it rather than leaving a half-entered state. */
  async function startPresenting() {
    if (preview.presentationMode) return;
    try {
      await preview.togglePresentationMode();
      const display = preview.presentationDisplay;
      toast.info(
        display
          ? `Presenting on ${display.name ?? display.id} — press Esc to exit`
          : "Press Esc to exit presenter mode"
      );
    } catch (err) {
      logError("preview enter presentation failed:", err);
      toast.error("Could not start the presentation");
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (preview.presentationMode && matchesCommand(e, "preview.exitPresentation")) {
      preview
        .togglePresentationMode()
        .catch((err) => logError("preview exit presentation failed:", err));
    }
  }

  onMount(async () => {
    await preview.init().catch((err) => logError("preview popout init failed:", err));

    // The main window's preview pane hosts the same Present button. When this
    // popout is already open it can't hand the intent over through the URL, so
    // it asks over the event bus instead — including to *end* a presentation,
    // whose Esc key only reaches this window while it has focus.
    onPresentationToggleRequest(() => {
      if (preview.presentationMode) {
        preview
          .togglePresentationMode()
          .catch((err) => logError("preview exit presentation failed:", err));
      } else {
        startPresenting();
      }
    })
      .map((unlisten) => {
        presentRequestUnlisten = unlisten;
      })
      .mapErr((err) => logError("preview present-request listener failed:", err));

    if (autoPresent) await startPresenting();
  });

  onDestroy(() => {
    presentRequestUnlisten?.();
    presentRequestUnlisten = null;
    preview.destroy();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<Tooltip.Provider>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background">
    {#if !preview.presentationMode}
      <Titlebar variant="minimal" title="Preview" />
    {/if}
    <Preview />
  </div>
</Tooltip.Provider>
