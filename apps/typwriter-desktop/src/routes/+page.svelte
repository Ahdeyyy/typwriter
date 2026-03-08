<script lang="ts">
  import { page } from "@/stores/page.svelte";
  import { workspace } from "@/stores/workspace.svelte";

  import { Window } from "@tauri-apps/api/window";
  import { watch } from "runed";

  const window = Window.getCurrent();

  const title = $derived.by(() => {
    if (page.current.name === "logs") {
      return "Logs - Typwriter";
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

<section class="w-100svw h-100svh">
  <svelte:boundary>
    <page.current.component />
    <!-- <page.component /> -->
  </svelte:boundary>
</section>
