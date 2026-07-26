<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { SidebarLeft01Icon, EyeIcon } from "@hugeicons/core-free-icons";
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
  import EmptyTab from "$lib/components/editor/empty-tab.svelte";
  import BottomBar from "$lib/components/toolbar/bottom-bar.svelte";
  import QuickSwitcher from "$lib/components/screens/quick-switcher.svelte";
  import TabSwitcher from "$lib/components/screens/tab-switcher.svelte";

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
  let formatting = $state(false);

  async function formatFile() {
    if (formatting) return;
    formatting = true;
    const result = await editor.formatActive();
    formatting = false;
    result.mapErr((e) => toast.error(`Format failed: ${e}`));
  }

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
  <!-- Translucent, blurred top bar; extra padding keeps buttons clear of the
       status bar (safe-area inset can read 0 on Android edge-to-edge). -->
  <header
    class="bg-background/70 shrink-0 border-b backdrop-blur-md"
    style="padding-top: calc(env(safe-area-inset-top) + 0.5rem);"
  >
    <div class="relative flex h-12 items-center justify-between gap-1 px-2">
      <Button
        variant="secondary"
        size="icon"
        aria-label="Toggle files"
        onclick={() => (app.overlay === "filetree" ? app.closeOverlay() : app.openOverlay("filetree"))}
      >
        <Icon icon={SidebarLeft01Icon} />
      </Button>

      <!-- Centered file name (disambiguated by parent folder when duplicated). -->
      {#if editor.displayName}
        <span
          class="pointer-events-none absolute left-1/2 max-w-[55%] -translate-x-1/2 truncate text-center text-sm font-bold"
        >
          {editor.displayName}
        </span>
      {/if}

      <div class="flex items-center gap-1">
        {#if compileStore.errors.length > 0}
          <Badge variant="destructive" onclick={() => app.openOverlay("diagnostics")}>
            {compileStore.errors.length}
          </Badge>
        {/if}
        <Button variant="secondary" size="icon" aria-label="Preview" onclick={openPreview}>
          <Icon icon={EyeIcon} />
        </Button>
      </div>
    </div>
  </header>

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
    <BottomBar onExport={exportPdf} onFormat={formatFile} {exporting} />
  {/if}
</div>

<TreeSheet />
<PreviewOverlay />
<QuickSwitcher />
<TabSwitcher />

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
