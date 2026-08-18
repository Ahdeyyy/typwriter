<script lang="ts">
  import { page } from "@/stores/page.svelte";
  import { workspace } from "@/stores/workspace.svelte";
  import PreviewWindow from "$lib/components/pages/preview-window.svelte";
  import SettingsWindow from "$lib/components/pages/settings.svelte";
  import DiffWindow from "$lib/components/pages/diff-window.svelte";
  import Button from "$lib/components/ui/button/button.svelte";

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
  const settingsInitialGroup = isSettingsWindow ? searchParams.get("group") : null;
  const isDiffWindow = windowRole === "diff";
  const diffInitialPrimary = isDiffWindow ? searchParams.get("primary") : null;
  const diffInitialSecondary = isDiffWindow ? searchParams.get("secondary") : null;
  const diffInitialView = searchParams.get("view") === "pages" ? "pages" : "files";

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
      <SettingsWindow initialGroup={settingsInitialGroup} />
    {:else if isDiffWindow}
      <DiffWindow
        initialPrimary={diffInitialPrimary}
        initialSecondary={diffInitialSecondary}
        initialView={diffInitialView}
      />
    {:else}
      <page.current.component />
    {/if}

    <!-- Without this the boundary swallows render errors and leaves a blank
         window with nothing in the UI to explain it. -->
    {#snippet failed(error, reset)}
      <div class="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p class="text-sm font-medium">Something went wrong rendering this screen.</p>
        <pre
          class="max-h-48 max-w-full overflow-auto rounded-md border border-border bg-muted px-3 py-2 text-left text-xs">{String(
            error,
          )}</pre>
        <Button variant="outline" size="sm" onclick={reset}>Try again</Button>
      </div>
    {/snippet}
  </svelte:boundary>
</section>
