<script lang="ts">
  import { page } from "@/stores/page.svelte";
  import { workspace } from "@/stores/workspace.svelte";
  import PreviewWindow from "$lib/components/pages/preview-window.svelte";
  import SettingsWindow from "$lib/components/pages/settings.svelte";
  import DiffWindow from "$lib/components/pages/diff-window.svelte";

  import { Window } from "@tauri-apps/api/window";
  import { watch } from "runed";

  const win = Window.getCurrent();

  const searchParams =
    typeof globalThis.window !== "undefined"
      ? new URLSearchParams(globalThis.window.location.search)
      : new URLSearchParams();

  // Which standalone window this webview hosts (preview popout, settings,
  // version diff) — absent for the main window.
  const windowRole = searchParams.get("window");

  const isPreviewWindow = windowRole === "preview";
  const autoPresent = isPreviewWindow && searchParams.get("present") === "1";
  const previewInitialPage = isPreviewWindow ? searchParams.get("page") : null;

  const isSettingsWindow = windowRole === "settings";
  const isDiffWindow = windowRole === "diff";
  const diffInitialPrimary = isDiffWindow ? searchParams.get("primary") : null;
  const diffInitialSecondary = isDiffWindow ? searchParams.get("secondary") : null;

  const title = $derived.by(() => {
    if (isPreviewWindow) {
      return "Preview - Typwriter";
    }
    if (isSettingsWindow) {
      return "Settings - Typwriter";
    }
    if (isDiffWindow) {
      return "Version Diff - Typwriter";
    }
    if (page.current.name === "home") {
      return "Typwriter";
    }

    const workspaceName = workspace.rootPath ? workspace.rootPath.split("/").slice(-1)[0] : "";
    const openFileName = workspace.activeFilePath ? workspace.activeFilePath.split("/").slice(-1)[0] : "";
    return `${openFileName ? openFileName + " - " : ""}${workspaceName ? workspaceName + " - " : ""} Typwriter`;
  });

  watch(() => title, (newTitle) => {
    win.setTitle(newTitle);
  });
</script>

<section class="h-full w-full">
  <svelte:boundary>
    {#if isPreviewWindow}
      <PreviewWindow {autoPresent} initialPage={previewInitialPage} />
    {:else if isSettingsWindow}
      <SettingsWindow />
    {:else if isDiffWindow}
      <DiffWindow initialPrimary={diffInitialPrimary} initialSecondary={diffInitialSecondary} />
    {:else}
      <page.current.component />
    {/if}
  </svelte:boundary>
</section>
