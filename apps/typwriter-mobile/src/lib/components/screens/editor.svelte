<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { SidebarLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as Dialog from "$lib/components/ui/dialog";
  import { exportPdfToUri } from "$lib/ipc/commands";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { keyboard } from "$lib/editor/keyboard-visibility.svelte";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import TreeSheet from "$lib/components/file-tree/tree-sheet.svelte";
  import EditorHost from "$lib/components/editor/editor-host.svelte";
  import EditorToolbar from "$lib/components/toolbar/editor-toolbar.svelte";
  import CompletionStrip from "$lib/components/toolbar/completion-strip.svelte";
  import PreviewOverlay from "$lib/components/preview/preview-overlay.svelte";
  import TabBar from "$lib/components/editor/tab-bar.svelte";
  import EmptyTab from "$lib/components/editor/empty-tab.svelte";
  import BottomBar from "$lib/components/toolbar/bottom-bar.svelte";
  import QuickSwitcher from "$lib/components/screens/quick-switcher.svelte";

  onMount(() => {
    // Let the history/back integration flush unsaved content when leaving.
    app.flushEditor = () => void editor.flush();
    keyboard.init();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void editor.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      app.flushEditor = null;
      keyboard.destroy();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  async function openPreview() {
    app.openOverlay("preview"); // opens immediately (skeleton / last pages)
    await editor.flush(); // persist current text
    if (compileStore.stale) await compileStore.run();
  }

  let exporting = $state(false);
  let confirmExportOpen = $state(false);

  async function exportPdf() {
    if (compileStore.stale || compileStore.pages.length === 0) {
      await editor.flush();
      await compileStore.run();
    }
    if (compileStore.errors.length > 0) {
      confirmExportOpen = true; // confirm exporting the last good document
      return;
    }
    doExport();
  }

  function doExport() {
    confirmExportOpen = false;
    exporting = true;
    exportPdfToUri().match(
      (name) => {
        exporting = false;
        toast.success(`Exported ${name}`);
      },
      (e) => {
        exporting = false;
        if (e !== "Export cancelled") toast.error(`Export failed: ${e}`);
      },
    );
  }
</script>

<!-- Pinned to the visual-viewport rectangle (see keyboard-visibility) so the
     shell always sits above the soft keyboard instead of behind it. Falls back
     to a full-window static-ish box before the keyboard listener publishes the
     vars. -->
<div
  class="fixed flex flex-col"
  style="top: var(--vv-top, 0px); left: var(--vv-left, 0px); width: var(--vv-width, 100vw); height: var(--app-height, 100svh);"
>
  <!-- Top bar -->
  <header
    class="flex h-12 shrink-0 items-center gap-1 border-b px-1"
    style="padding-top: env(safe-area-inset-top);"
  >
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle files"
      onclick={() => (app.overlay === "filetree" ? app.closeOverlay() : app.openOverlay("filetree"))}
    >
      <Icon icon={SidebarLeft01Icon} />
    </Button>

    <div class="flex min-w-0 flex-1 items-center justify-center gap-1.5">
      <span class="truncate text-sm font-medium">{editor.fileName ?? "New tab"}</span>
      {#if editor.dirty || editor.saving}
        <span class="bg-muted-foreground/70 size-1.5 shrink-0 rounded-full" class:animate-pulse={editor.saving}></span>
      {/if}
    </div>

    {#if compileStore.errors.length > 0}
      <Badge variant="destructive" class="mr-1" onclick={() => app.openOverlay("diagnostics")}>
        {compileStore.errors.length}
      </Badge>
    {/if}

    <Button variant="ghost" size="icon" aria-label="Search files" onclick={() => app.openOverlay("quickswitcher")}>
      <Icon icon={Search01Icon} />
    </Button>
  </header>

  <!-- Obsidian-style tabs -->
  <TabBar />

  <!-- Editor host -->
  <main class="min-h-0 flex-1">
    {#if editor.loading}
      <div class="flex flex-col gap-2 p-4">
        {#each Array(8) as _}
          <Skeleton class="h-4 w-full" />
        {/each}
      </div>
    {:else if editor.fileKind === "image" && editor.imageDataUrl}
      <div class="flex h-full items-center justify-center overflow-auto p-4">
        <img src={editor.imageDataUrl} alt={editor.fileName} class="max-h-full max-w-full" />
      </div>
    {:else if editor.fileKind === "unsupported"}
      <div class="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        This file type can't be opened in the editor.
      </div>
    {:else if editor.fileKind === "text"}
      <EditorHost />
    {:else}
      <EmptyTab />
    {/if}
  </main>

  <!-- Toolbar: keyboard-open form (formatting) vs keyboard-closed dock. -->
  {#if keyboard.visible && editor.fileKind === "text" && !editor.loading}
    <CompletionStrip />
    <EditorToolbar />
  {:else}
    <BottomBar onPreview={openPreview} onExport={exportPdf} {exporting} />
  {/if}
</div>

<TreeSheet />
<PreviewOverlay />
<QuickSwitcher />

<!-- Export-with-errors confirmation -->
<Dialog.Root open={confirmExportOpen} onOpenChange={(o) => { if (!o) confirmExportOpen = false; }}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Document has {compileStore.errors.length} error(s)</Dialog.Title>
      <Dialog.Description>
        Export the last successful compile anyway?
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="mt-4 flex flex-col gap-2">
      <Button class="w-full" onclick={doExport}>Export anyway</Button>
      <Button variant="ghost" class="w-full" onclick={() => (confirmExportOpen = false)}>Cancel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
