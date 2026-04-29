<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { logError } from "$lib/logger";

  type Props = { autoPresent?: boolean };
  let { autoPresent = false }: Props = $props();

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
        .catch((err) => logError("preview auto-present failed:", err));
    }
  });

  onDestroy(() => {
    preview.destroy();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen w-screen flex-col overflow-hidden bg-background">
  <Preview />
</div>
