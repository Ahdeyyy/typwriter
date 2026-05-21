<script lang="ts">
  import { onDestroy } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    ZoomInAreaIcon,
    ZoomOutAreaIcon,
    Download01Icon,
    Refresh01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Menu01Icon,
    File01Icon,
    Loading02Icon,
  } from "@hugeicons/core-free-icons";
  import ExportDialog from "./export-dialog.svelte";

  import { preview } from "$lib/stores/preview.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { Button } from "$lib/components/ui/button";
  import { previewController } from "./preview-controller.svelte";
  import { buildPreviewUrl } from "$lib/preview-url";

  let { visible = true }: { visible?: boolean } = $props();

  // Singleton — see comment in preview-controller.svelte.ts for rationale.
  const ctrl = previewController;
  onDestroy(() => ctrl.detachFromMount());

  $effect(() => ctrl.syncPagesEffect());
  $effect(() => ctrl.scrollTargetEffect());
  $effect(() => ctrl.pageCounterEffect());
  $effect(() => ctrl.clampVisiblePageEffect());

  $effect(() => {
    if (visible) ctrl.reapplyLastScroll();
  });
</script>

<div class="flex h-full flex-col bg-background text-foreground">
  <!-- Compact mobile toolbar — single row, no tooltips, no presentation mode -->
  <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-[3.25rem] overflow-x-auto">
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => ctrl.zoomOut()}
      disabled={preview.zoom <= 0.5}
    >
      <HugeiconsIcon icon={ZoomOutAreaIcon} class="size-4" />
    </Button>
    <span class="min-w-10 text-center text-xs text-muted-foreground tabular-nums">
      {ctrl.zoomLabel}
    </span>
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => ctrl.zoomIn()}
      disabled={preview.zoom >= 8.0}
    >
      <HugeiconsIcon icon={ZoomInAreaIcon} class="size-4" />
    </Button>

    <div class="flex-1"></div>

    {#if preview.isCompiling}
      <HugeiconsIcon icon={Loading02Icon} class="size-4 shrink-0 text-muted-foreground animate-spin" />
    {/if}

    {#if preview.paginated && preview.totalPages > 0}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={() => ctrl.prevPage()}
        disabled={ctrl.visiblePage <= 0}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} class="size-4" />
      </Button>
    {/if}

    {#if preview.totalPages > 0}
      <span class="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground tabular-nums">
        {ctrl.visiblePage + 1} / {preview.totalPages}
      </span>
    {/if}

    {#if preview.paginated && preview.totalPages > 0}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={() => ctrl.nextPage()}
        disabled={ctrl.visiblePage >= preview.totalPages - 1}
      >
        <HugeiconsIcon icon={ArrowRight01Icon} class="size-4" />
      </Button>
    {/if}

    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => ctrl.togglePaginated()}
      disabled={preview.totalPages === 0}
      class={preview.paginated ? "bg-accent text-accent-foreground" : ""}
    >
      <HugeiconsIcon icon={preview.paginated ? Menu01Icon : File01Icon} class="size-4" />
    </Button>

    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => ctrl.openExport()}
      disabled={preview.totalPages === 0}
    >
      <HugeiconsIcon icon={Download01Icon} class="size-4" />
    </Button>

    <Button variant="ghost" size="icon-sm" onclick={() => ctrl.refresh()}>
      <HugeiconsIcon icon={Refresh01Icon} class="size-4" />
    </Button>
  </div>

  <!-- Page list -->
  {#if preview.paginated}
    <div class="flex flex-1 flex-col items-center overflow-auto py-3">
      {#if preview.totalPages === 0}
        <div class="m-auto select-none text-xs text-muted-foreground text-center px-4">
          {#if workspace.mainFile}
            Loading preview…
          {:else}
            Select a main `.typ` file to render a preview.
          {/if}
        </div>
      {:else}
        <div
          id="preview-page-{ctrl.visiblePage}"
          class="relative shrink-0 overflow-hidden rounded shadow-md"
        >
          {#if ctrl.committedPages[ctrl.visiblePage]}
            <Button
              variant="ghost"
              class="block h-auto md:h-auto rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
              onclick={(e) => ctrl.handlePageClick(e, ctrl.visiblePage)}
            >
              <img
                src={buildPreviewUrl(ctrl.committedPages[ctrl.visiblePage]!)}
                alt="Page {ctrl.visiblePage + 1}"
                draggable="false"
                class="block max-w-full"
                onload={() => ctrl.notifyImageLoaded(ctrl.visiblePage, ctrl.committedPages[ctrl.visiblePage]!)}
                onerror={() => ctrl.notifyImageError(ctrl.visiblePage, ctrl.committedPages[ctrl.visiblePage]!)}
              />
            </Button>
          {:else}
            <div class="h-[800px] w-[566px] animate-pulse bg-muted"></div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div
      bind:this={ctrl.scrollEl}
      class="flex flex-1 flex-col items-center gap-3 overflow-y-auto py-3"
    >
      {#if preview.totalPages === 0}
        <div class="flex h-full select-none items-center justify-center text-xs text-muted-foreground text-center px-4">
          {#if workspace.mainFile}
            Loading preview…
          {:else}
            Select a main `.typ` file to render a preview.
          {/if}
        </div>
      {:else}
        {#each preview.pages as _, i}
          <div
            id="preview-page-{i}"
            class="relative shrink-0 overflow-hidden rounded shadow-md"
          >
            {#if ctrl.committedPages[i]}
              <Button
                variant="ghost"
                class="block h-auto md:h-auto rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
                onclick={(e) => ctrl.handlePageClick(e, i)}
              >
                <img
                  src={buildPreviewUrl(ctrl.committedPages[i]!)}
                  alt="Page {i + 1}"
                  draggable="false"
                  class="block max-w-full"
                  onload={() => ctrl.notifyImageLoaded(i, ctrl.committedPages[i]!)}
                  onerror={() => ctrl.notifyImageError(i, ctrl.committedPages[i]!)}
                />
              </Button>
            {:else}
              <div class="h-[800px] w-[566px] animate-pulse bg-muted"></div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<ExportDialog bind:open={ctrl.exportOpen} totalPages={preview.totalPages} />
