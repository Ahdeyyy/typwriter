<script lang="ts">
  import { onDestroy } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ZoomInAreaIcon, ZoomOutAreaIcon, Download01Icon, Refresh01Icon, PresentationBarChart01Icon, Cancel01Icon, ArrowLeft01Icon, ArrowRight01Icon, Menu01Icon, File01Icon } from "@hugeicons/core-free-icons";
  import ExportDialog from "./export-dialog.svelte";

  import { preview } from "$lib/stores/preview.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { PreviewController } from "./preview-controller.svelte";
  import { buildPreviewUrl } from "$lib/preview-url";

  type Props = { onPresentationMode?: () => void };
  let { onPresentationMode }: Props = $props();

  const ctrl = new PreviewController({ onPresentationMode: () => onPresentationMode?.() });
  onDestroy(() => ctrl.destroy());

  $effect(() => ctrl.syncPagesEffect());
  $effect(() => ctrl.scrollTargetEffect());
  $effect(() => ctrl.pageCounterEffect());
  $effect(() => ctrl.clampVisiblePageEffect());
</script>

<svelte:window onkeydown={(e) => ctrl.handleKeydown(e)} />

<div class="flex h-full flex-col bg-background text-foreground">
  <!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
  {#if !preview.presentationMode}
  <div
    bind:clientWidth={ctrl.toolbarWidth}
    class={ctrl.isNarrow
      ? "flex flex-col shrink-0 border-b border-border px-2 py-0.5"
      : "flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2"}
  >
    <!-- Zoom controls -->
    <div class={ctrl.isNarrow ? "flex items-center gap-0.5 w-full" : "flex items-center gap-0.5"}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={() => ctrl.zoomOut()}
              disabled={preview.zoom <= 0.5}
            >
              <HugeiconsIcon icon={ZoomOutAreaIcon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Zoom out</Tooltip.Content>
      </Tooltip.Root>

      <span class="w-12 text-center text-xs text-muted-foreground tabular-nums">
        {ctrl.zoomLabel}
      </span>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={() => ctrl.zoomIn()}
              disabled={preview.zoom >= 8.0}
            >
              <HugeiconsIcon icon={ZoomInAreaIcon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Zoom in</Tooltip.Content>
      </Tooltip.Root>
    </div>

    {#if !ctrl.isNarrow}
      <div class="flex-1"></div>
    {/if}

    <!-- Status + actions -->
    <div class={ctrl.isNarrow ? "flex items-center gap-0.5 w-full" : "flex items-center gap-0.5"}>
      {#if preview.isCompiling}
        <span class="mr-2 text-[11px] uppercase tracking-wide text-muted-foreground animate-pulse">
          Compiling
        </span>
      {/if}

      {#if preview.paginated && preview.totalPages > 0}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                onclick={() => ctrl.prevPage()}
                disabled={ctrl.visiblePage <= 0}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} class="size-3.5" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Previous page</Tooltip.Content>
        </Tooltip.Root>
      {/if}

      {#if preview.totalPages > 0}
        <span class="text-xs text-muted-foreground tabular-nums">
          {ctrl.visiblePage + 1} / {preview.totalPages}
        </span>
      {/if}

      {#if preview.paginated && preview.totalPages > 0}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                onclick={() => ctrl.nextPage()}
                disabled={ctrl.visiblePage >= preview.totalPages - 1}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} class="size-3.5" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Next page</Tooltip.Content>
        </Tooltip.Root>
      {/if}

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={() => ctrl.togglePaginated()}
              disabled={preview.totalPages === 0}
              class={preview.paginated ? "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground dark:hover:text-foreground" : ""}
            >
              <HugeiconsIcon icon={preview.paginated ? Menu01Icon : File01Icon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{preview.paginated ? "Switch to scroll view" : "Switch to paginated view"}</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={() => ctrl.openExport()}
              disabled={preview.totalPages === 0}
            >
              <HugeiconsIcon icon={Download01Icon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Export document</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={() => ctrl.refresh()}
            >
              <HugeiconsIcon icon={Refresh01Icon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Refresh preview</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={() => ctrl.togglePresentation()}
              disabled={preview.totalPages === 0}
              class={preview.presentationMode ? "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground dark:hover:text-foreground" : ""}
            >
              <HugeiconsIcon icon={preview.presentationMode ? Cancel01Icon : PresentationBarChart01Icon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{preview.presentationMode ? "Exit presentation mode" : "Presentation mode"}</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </div>
  {/if}

  <!-- ── Page list ──────────────────────────────────────────────────────── -->
  {#if preview.presentationMode}
    <div class="flex flex-1 items-center justify-center overflow-hidden bg-black">
      {#if ctrl.committedPages[ctrl.visiblePage]}
        <Button
          variant="ghost"
          class="block h-full md:h-full w-full rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
          onclick={(e) => ctrl.handlePageClick(e, ctrl.visiblePage)}
        >
          <img
            src={buildPreviewUrl(ctrl.committedPages[ctrl.visiblePage]!)}
            alt="Page {ctrl.visiblePage + 1}"
            draggable="false"
            class="block h-full w-full object-cover"
          />
        </Button>
      {/if}
    </div>
  {:else if preview.paginated}
    <div class="flex flex-1 flex-col items-center overflow-auto py-4 preview-scroll">
      {#if preview.totalPages === 0}
        <div class="m-auto select-none text-xs text-muted-foreground">
          {#if workspace.mainFile}
            Loading preview…
          {:else}
            Select a main `.typ` file in the explorer to render a preview.
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
      class="flex flex-1 flex-col items-center gap-4 overflow-y-auto py-4 preview-scroll"
    >
      {#if preview.totalPages === 0}
        <div
          class="flex h-full select-none items-center justify-center text-xs text-muted-foreground"
        >
          {#if workspace.mainFile}
            Loading preview…
          {:else}
            Select a main `.typ` file in the explorer to render a preview.
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
                />
              </Button>
            {:else}
              <!-- Placeholder while page is rendering -->
              <div class="h-[800px] w-[566px] animate-pulse bg-muted"></div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<ExportDialog bind:open={ctrl.exportOpen} totalPages={preview.totalPages} />
