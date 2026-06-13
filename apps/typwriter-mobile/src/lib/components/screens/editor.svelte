<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { List, Eye, DotsThree, FilePdf, Warning, Gear, SignOut } from "phosphor-svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
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

<div class="flex h-svh flex-col">
  <!-- Top bar -->
  <header
    class="flex h-12 shrink-0 items-center gap-1 border-b px-1"
    style="padding-top: env(safe-area-inset-top);"
  >
    <Button variant="ghost" size="icon" aria-label="Files" onclick={() => app.openOverlay("filetree")}>
      <List />
    </Button>

    <div class="flex min-w-0 flex-1 items-center justify-center gap-1.5">
      <span class="truncate text-sm font-medium">{editor.fileName ?? "No file"}</span>
      {#if editor.dirty || editor.saving}
        <span class="bg-muted-foreground/70 size-1.5 shrink-0 rounded-full" class:animate-pulse={editor.saving}></span>
      {/if}
    </div>

    {#if compileStore.errors.length > 0}
      <Badge variant="destructive" class="mr-1" onclick={() => app.openOverlay("diagnostics")}>
        {compileStore.errors.length}
      </Badge>
    {/if}

    <Button variant="ghost" size="icon" aria-label="Preview" onclick={openPreview}>
      <Eye />
    </Button>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" aria-label="More" {...props}>
            <DotsThree weight="bold" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item disabled={exporting} onclick={exportPdf}>
          <FilePdf /> Export PDF
        </DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => app.openOverlay("diagnostics")}>
          <Warning /> Diagnostics
          {#if compileStore.errors.length > 0}
            <span class="text-destructive ml-auto text-xs">{compileStore.errors.length}</span>
          {/if}
        </DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => app.openOverlay("settings")}>
          <Gear /> Settings
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={() => app.goHome()}>
          <SignOut /> Close workspace
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

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
      <div class="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        Open a file from the file tree.
      </div>
    {/if}
  </main>

  {#if editor.fileKind === "text" && !editor.loading}
    <CompletionStrip />
    <EditorToolbar />
  {/if}
</div>

<TreeSheet />
<PreviewOverlay />

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
