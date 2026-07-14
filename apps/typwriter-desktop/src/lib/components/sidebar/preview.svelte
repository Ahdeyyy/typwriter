<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ZoomInAreaIcon, ZoomOutAreaIcon, Download01Icon, Refresh01Icon, PresentationBarChart01Icon, Cancel01Icon, ArrowLeft01Icon, ArrowRight01Icon, Menu01Icon, File01Icon } from "@hugeicons/core-free-icons";
  import ExportDialog from "./export-dialog.svelte";

  import { preview } from "$lib/stores/preview.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { previewController } from "./preview-controller.svelte";
  import { buildPreviewUrl } from "$lib/preview-url";

  type Props = { onPresentationMode?: () => void };
  let { onPresentationMode }: Props = $props();

  // Per-webview singleton: state (decoded pages, visiblePage, watchdog) survives
  // unmount/remount cycles such as popping the preview out into its own window.
  // We only attach DOM-bound callbacks for this mount and detach them on destroy.
  const ctrl = previewController;
  ctrl.setOnPresentationMode(() => onPresentationMode?.());
  onDestroy(() => ctrl.detachFromMount());

  $effect(() => ctrl.syncPagesEffect());
  $effect(() => ctrl.scrollTargetEffect());
  $effect(() => ctrl.pageCounterEffect());
  $effect(() => ctrl.clampVisiblePageEffect());

  // After remount (e.g. user popped the preview out and back in), the scroll
  // container is a fresh DOM element with scrollTop=0. Snap it to whichever
  // page was visible last so the pane lands where the user left it.
  //
  // Runs only while `ctrl.restorePending` (which also suppresses the scroll-
  // driven page counter, so `visiblePage` can't be clobbered back to 0 by the
  // fresh container before the restore reads it). While pending we DO track
  // `visiblePage` and the page buffers: in a freshly opened popout the true
  // page can arrive asynchronously over the cross-window channel, and the
  // target page's DOM node only exists once `preview.pages` has grown past it
  // — each of those changes retries the restore. Once the restore lands,
  // `restorePending` flips false and the early return keeps scroll-driven
  // `visiblePage` updates from re-snapping the container under the user.
  $effect(() => {
    if (!ctrl.restorePending) return;
    const idx = preview.visiblePage;
    // Committed pages render their <img> with explicit width/height, so the
    // layout above the target is only final once every page up to it has
    // committed — before that, `offsetTop` would measure skeletons and
    // still-loading images and the snap would land short of the target.
    // Reading those slots (and `visiblePage`) retries the restore as decodes
    // land and as a late cross-window snapshot arrives.
    const settled =
      preview.paginated ||
      (ctrl.scrollEl !== null &&
        preview.pages.length > idx &&
        ctrl.committedPages.length > idx &&
        ctrl.committedPages.slice(0, idx + 1).every((fp) => fp !== null));
    if (settled) {
      untrack(() => ctrl.restoreScrollToVisiblePage());
    }
  });
</script>

<svelte:window onkeydown={(e) => ctrl.handleKeydown(e)} />

<!-- Transient cursor-sync highlight over a page. Rectangles are positioned as a
     fraction of the page so they track the image at any zoom / fit scale. The
     {#key} restarts the fade when the same page is re-highlighted. -->
{#snippet highlightOverlay(pageIndex: number)}
  {#if preview.highlight && preview.highlight.page === pageIndex}
    {@const hl = preview.highlight}
    {#key hl.nonce}
      <div class="pointer-events-none absolute inset-0 z-10">
        {#each hl.rects as r}
          <div
            class="cursor-sync-highlight absolute"
            style="left:{(r.x / hl.pageWidth) * 100}%; top:{(r.y / hl.pageHeight) * 100}%; width:{(r.width / hl.pageWidth) * 100}%; height:{(r.height / hl.pageHeight) * 100}%;"
          ></div>
        {/each}
      </div>
    {/key}
  {/if}
{/snippet}

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
            onload={() => ctrl.notifyImageLoaded(ctrl.visiblePage, ctrl.committedPages[ctrl.visiblePage]!)}
            onerror={() => ctrl.notifyImageError(ctrl.visiblePage, ctrl.committedPages[ctrl.visiblePage]!)}
          />
        </Button>
      {/if}
    </div>
  {:else if preview.paginated}
    <div class="flex flex-1 flex-col items-center overflow-auto py-4 preview-scroll">
      {#if preview.totalPages === 0}
        <div class="m-auto select-none text-xs text-muted-foreground">
          {#if workspace.mainFile}
            {preview.isCompiling ? "Compiling…" : "Loading preview…"}
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
            {@const fp = ctrl.committedPages[ctrl.visiblePage]!}
            {@const dims = ctrl.dimsFor(fp)}
            <Button
              variant="ghost"
              class="block h-auto md:h-auto rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
              onclick={(e) => ctrl.handlePageClick(e, ctrl.visiblePage)}
            >
              <img
                src={buildPreviewUrl(fp)}
                alt="Page {ctrl.visiblePage + 1}"
                width={dims?.w}
                height={dims?.h}
                draggable="false"
                class="block h-auto max-w-full"
                onload={() => ctrl.notifyImageLoaded(ctrl.visiblePage, fp)}
                onerror={() => ctrl.notifyImageError(ctrl.visiblePage, fp)}
              />
            </Button>
          {:else}
            <div class="h-[800px] w-[566px] animate-pulse bg-muted"></div>
          {/if}
          {@render highlightOverlay(ctrl.visiblePage)}
        </div>
      {/if}
    </div>
  {:else}
    <!-- A wheel event can only come from the user (programmatic scrollTo
         doesn't fire it) — treat it as taking control, so a still-pending
         mount restore can't later yank the view away. -->
    <div
      bind:this={ctrl.scrollEl}
      onwheel={() => (ctrl.restorePending = false)}
      class="flex flex-1 flex-col items-center gap-4 overflow-y-auto py-4 preview-scroll"
    >
      {#if preview.totalPages === 0}
        <div
          class="flex h-full select-none items-center justify-center text-xs text-muted-foreground"
        >
          {#if workspace.mainFile}
            {preview.isCompiling ? "Compiling…" : "Loading preview…"}
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
              {@const fp = ctrl.committedPages[i]!}
              {@const dims = ctrl.dimsFor(fp)}
              <Button
                variant="ghost"
                class="block h-auto md:h-auto rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
                onclick={(e) => ctrl.handlePageClick(e, i)}
              >
                <img
                  src={buildPreviewUrl(fp)}
                  alt="Page {i + 1}"
                  width={dims?.w}
                  height={dims?.h}
                  draggable="false"
                  class="block h-auto max-w-full"
                  onload={() => ctrl.notifyImageLoaded(i, fp)}
                  onerror={() => ctrl.notifyImageError(i, fp)}
                />
              </Button>
            {:else}
              <!-- Placeholder while page is rendering -->
              <div class="h-[800px] w-[566px] animate-pulse bg-muted"></div>
            {/if}
            {@render highlightOverlay(i)}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<ExportDialog bind:open={ctrl.exportOpen} totalPages={preview.totalPages} />

<style>
  /* Highlighter-style tint over the rendered text the caret maps to. `multiply`
     lets the page's text/background show through, and the animation fades the
     mark out (duration kept in sync with HIGHLIGHT_DURATION in the store). */
  .cursor-sync-highlight {
    background: rgba(255, 213, 0, 0.45);
    mix-blend-mode: multiply;
    border-radius: 1px;
    animation: cursor-sync-fade 1.6s ease-out forwards;
  }

  @keyframes cursor-sync-fade {
    0% {
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cursor-sync-highlight {
      animation-duration: 1.6s;
      animation-timing-function: step-end;
    }
  }
</style>
