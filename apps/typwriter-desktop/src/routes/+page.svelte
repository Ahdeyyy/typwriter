<script lang="ts">
  import { page } from "@/stores/page.svelte";
  import { workspace } from "@/stores/workspace.svelte";
  import PreviewWindow from "$lib/components/pages/preview-window.svelte";

  import { Window } from "@tauri-apps/api/window";
  import { watch } from "runed";

  const window = Window.getCurrent();

  const searchParams =
    typeof globalThis.window !== "undefined"
      ? new URLSearchParams(globalThis.window.location.search)
      : new URLSearchParams();

  const isPreviewWindow = searchParams.get("window") === "preview";
  const autoPresent = isPreviewWindow && searchParams.get("present") === "1";

  const title = $derived.by(() => {
    if (isPreviewWindow) {
      return "Preview - Typwriter";
    }
    if (page.current.name === "home") {
      return "Typwriter";
    }

    const workspaceName = workspace.rootPath ? workspace.rootPath.split("/").slice(-1)[0] : "";
    const openFileName = workspace.activeFilePath ? workspace.activeFilePath.split("/").slice(-1)[0] : "";
    return `${openFileName ? openFileName + " - " : ""}${workspaceName ? workspaceName + " - " : ""} Typwriter`;
  });

  watch(() => title, (newTitle) => {
    window.setTitle(newTitle);
  });
</script>

<section class="h-full w-full">
  <svelte:boundary>
    {#if isPreviewWindow}
      <PreviewWindow {autoPresent} />
    {:else}
      <page.current.component />
    {/if}
  </svelte:boundary>
</section>
