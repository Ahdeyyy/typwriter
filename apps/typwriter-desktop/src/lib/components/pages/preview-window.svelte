<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { preview } from "$lib/stores/preview.svelte";
  import { logError } from "$lib/logger";
  import { toast } from "svelte-sonner";

  type Props = { autoPresent?: boolean; initialPage?: string | null };
  let { autoPresent = false, initialPage = null }: Props = $props();

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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && preview.presentationMode) {
      preview
        .togglePresentationMode()
        .catch((err) => logError("preview exit presentation failed:", err));
    }
  }

  onMount(async () => {
    await preview.init().catch((err) => logError("preview popout init failed:", err));
    if (autoPresent) {
      await preview
        .togglePresentationMode()
        .then(() => toast.info("Press Esc to exit presenter mode"))
        .catch((err) => logError("preview auto-present failed:", err));
    }
  });

  onDestroy(() => {
    preview.destroy();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<Tooltip.Provider>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background">
    <Preview />
  </div>
</Tooltip.Provider>
