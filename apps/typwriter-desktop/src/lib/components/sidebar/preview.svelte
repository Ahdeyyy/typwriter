<script lang="ts">
  import { untrack } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ZoomInAreaIcon, ZoomOutAreaIcon, RotateLeft01Icon, Download01Icon, Refresh01Icon, PresentationBarChart01Icon, Cancel01Icon, ArrowLeft01Icon, ArrowRight01Icon, Menu01Icon, File01Icon } from "@hugeicons/core-free-icons";
  import ExportDialog from "./export-dialog.svelte";

  import { openUrl } from "@tauri-apps/plugin-opener";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  import { preview } from "$lib/stores/preview.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { jumpFromClick, setVisiblePage } from "$lib/ipc/commands";
  import { emitPreviewSourceJump } from "$lib/ipc/events";
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { logError } from "$lib/logger";
  import { toast } from "svelte-sonner";

  const isPopout = (() => {
    try {
      return getCurrentWindow().label === "preview";
    } catch {
      return false;
    }
  })();

  type Props = { onPresentationMode?: () => void };
  let { onPresentationMode }: Props = $props();

  // ── Local state ────────────────────────────────────────────────────────────

  let scrollEl = $state<HTMLDivElement | null>(null);
  let visiblePage = $state(0);
  let exportOpen = $state(false);

  // ── Double-buffer: hold last decoded page data to avoid flash on update ────
  let committedPages = $state<(string | null)[]>([]);
  const pending = new Map<number, string>();

  $effect(() => {
    const incoming = preview.pages;

    // Sync length
    const curLen = untrack(() => committedPages.length);
    if (curLen < incoming.length) {
      for (let i = curLen; i < incoming.length; i++) committedPages.push(null);
    } else if (curLen > incoming.length) {
      committedPages.splice(incoming.length);
    }

    for (let i = 0; i < incoming.length; i++) {
      const data = incoming[i];
      if (!data) continue;
      if (data === untrack(() => committedPages[i])) continue;
      if (pending.get(i) === data) continue;

      const idx = i;
      pending.set(idx, data);

      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      img.decode()
        .then(() => {
          if (pending.get(idx) === data) pending.delete(idx);
          if (preview.pages[idx] === data) committedPages[idx] = data;
        })
        .catch(() => {
          if (pending.get(idx) === data) pending.delete(idx);
          console.warn(`preview: failed to decode page ${idx}`);
        });
    }
  });

  // ── Scroll to page when cursor sync fires ──────────────────────────────────

  $effect(() => {
    const target = preview.scrollTarget;
    if (target === null) return;
    preview.scrollTarget = null;

    // Pre-render the target page by moving visiblePage before scrolling.
    visiblePage = target.page;
    if (preview.paginated) {
      setVisiblePage(target.page);
      return;
    }

    requestAnimationFrame(() => {
      const pageEl = document.getElementById(`preview-page-${target.page}`);
      if (!pageEl || !scrollEl) return;

      // y is in typst points; renderer produces naturalHeight = pageHeightPt * zoom,
      // so 1pt = zoom px. Pixel offset within the page image = y * zoom.
      const yPx = target.y * preview.zoom;
      const yAbs = pageEl.offsetTop + yPx;

      // If the target is already on screen, don't scroll — the user is likely
      // already looking at it (e.g. they just clicked there).
      const viewTop = scrollEl.scrollTop;
      const viewBottom = viewTop + scrollEl.clientHeight;
      const margin = 24;
      if (yAbs >= viewTop + margin && yAbs <= viewBottom - margin) return;

      // Otherwise scroll to put the target into the upper third of the viewport.
      const scrollTo = yAbs - scrollEl.clientHeight / 3;
      scrollEl.scrollTo({ top: scrollTo, behavior: "smooth" });
    });
  });

  // ── IntersectionObserver for page counter ──────────────────────────────────

  $effect(() => {
    const el = scrollEl;
    const count = preview.totalPages;
    if (!el || count === 0 || preview.paginated) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = parseInt(
              entry.target.id.replace("preview-page-", ""),
              10,
            );
            if (!isNaN(idx)) {
              visiblePage = idx;
              setVisiblePage(idx);
            }
          }
        }
      },
      { root: el, threshold: 0.5 },
    );

    for (let i = 0; i < count; i++) {
      const pageEl = document.getElementById(`preview-page-${i}`);
      if (pageEl) observer.observe(pageEl);
    }

    return () => observer.disconnect();
  });

  // ── Toolbar actions ────────────────────────────────────────────────────────

  function zoomIn() {
    preview.zoomIn().catch((err) => logError("preview zoom in failed:", err));
  }
  function zoomOut() {
    preview.zoomOut().catch((err) => logError("preview zoom out failed:", err));
  }
  function refresh() {
    preview
      .triggerRefresh()
      .catch((err) => logError("preview refresh failed:", err));
  }

  function togglePaginated() {
    preview.togglePaginated();
  }

  function goToPage(idx: number) {
    if (preview.totalPages === 0) return;
    const clamped = Math.max(0, Math.min(preview.totalPages - 1, idx));
    visiblePage = clamped;
    setVisiblePage(clamped);
  }

  function nextPage() {
    goToPage(visiblePage + 1);
  }
  function prevPage() {
    goToPage(visiblePage - 1);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!preview.paginated) return;
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
    }
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      nextPage();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      prevPage();
    } else if (e.key === "Home") {
      e.preventDefault();
      goToPage(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goToPage(preview.totalPages - 1);
    }
  }

  // Clamp visiblePage when total pages shrinks
  $effect(() => {
    const total = preview.totalPages;
    if (total === 0) return;
    if (visiblePage >= total) {
      visiblePage = total - 1;
    }
  });

  function togglePresentation() {
    if (!isPopout) {
      onPresentationMode?.();
      return;
    }
    const entering = !preview.presentationMode;
    preview
      .togglePresentationMode()
      .then(() => {
        if (entering) {
          toast.info("Press Esc to exit presenter mode");
        }
      })
      .catch((err) => logError("preview presentation mode failed:", err));
  }

  // ── Page click → editor cursor ─────────────────────────────────────────────

  async function handlePageClick(e: MouseEvent, pageIndex: number) {
    // e.target is the <img>; e.currentTarget is the <button> wrapper.
    // Use the img for accurate natural-size coordinate mapping.
    const img = e.target as HTMLImageElement;
    const px = (e.offsetX / img.clientWidth) * img.naturalWidth;
    const py = (e.offsetY / img.clientHeight) * img.naturalHeight;

    const result = await jumpFromClick(pageIndex, px, py);
    if (result.isErr() || !result.value) return;

    const jump = result.value;
    if (jump.type === "file") {
      if (isPopout) {
        emitPreviewSourceJump({ path: jump.path, offset: jump.start_byte }).mapErr(
          (err) => logError("emit preview:source-jump failed:", err)
        );
        return;
      }
      if (!workspace.rootPath) return;
      const relPath = workspace.toRel(jump.path);
      editor
        .openFile(relPath)
        .map(() => editor.requestCursorJump(relPath, jump.start_byte))
        .mapErr((err) => logError("jump from click failed:", err));
    } else if (jump.type === "url") {
      openUrl(jump.url).catch((err) => logError("open url failed:", err));
    } else if (jump.type === "position") {
      preview.scrollTarget = { page: jump.page, x: jump.x, y: jump.y };
    }
  }

  // ── Zoom display (zoom=2.0 → "100%") ──────────────────────────────────────

  const zoomLabel = $derived(`${Math.round(preview.zoom * 50)}%`);

  // ── Narrow toolbar ─────────────────────────────────────────────────────────

  let toolbarWidth = $state(0);
  const isNarrow = $derived(toolbarWidth > 0 && toolbarWidth < 240);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-col bg-background text-foreground">
  <!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
  {#if !preview.presentationMode}
  <div
    bind:clientWidth={toolbarWidth}
    class={isNarrow
      ? "flex flex-col shrink-0 border-b border-border px-2 py-0.5"
      : "flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2"}
  >
    <!-- Zoom controls -->
    <div class={isNarrow ? "flex items-center gap-0.5 w-full" : "flex items-center gap-0.5"}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={zoomOut}
              disabled={preview.zoom <= 0.5}
            >
              <HugeiconsIcon icon={ZoomOutAreaIcon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Zoom out</Tooltip.Content>
      </Tooltip.Root>

      <span class="w-12 text-center text-xs text-muted-foreground tabular-nums">
        {zoomLabel}
      </span>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              onclick={zoomIn}
              disabled={preview.zoom >= 8.0}
            >
              <HugeiconsIcon icon={ZoomInAreaIcon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Zoom in</Tooltip.Content>
      </Tooltip.Root>
    </div>

    {#if !isNarrow}
      <div class="flex-1"></div>
    {/if}

    <!-- Status + actions -->
    <div class={isNarrow ? "flex items-center gap-0.5 w-full" : "flex items-center gap-0.5"}>
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
                onclick={prevPage}
                disabled={visiblePage <= 0}
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
          {visiblePage + 1} / {preview.totalPages}
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
                onclick={nextPage}
                disabled={visiblePage >= preview.totalPages - 1}
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
              onclick={togglePaginated}
              disabled={preview.totalPages === 0}
              class={preview.paginated ? "bg-accent/30 text-foreground" : ""}
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
              onclick={() => (exportOpen = true)}
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
              onclick={refresh}
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
              onclick={togglePresentation}
              disabled={preview.totalPages === 0}
              class={preview.presentationMode ? "bg-accent/30 text-foreground" : ""}
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
      {#if committedPages[visiblePage]}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                class="block h-full w-full rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
                onclick={(e) => handlePageClick(e, visiblePage)}
              >
                <img
                  src="data:image/png;base64,{committedPages[visiblePage]}"
                  alt="Page {visiblePage + 1}"
                  draggable="false"
                  class="block h-full w-full object-cover"
                />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Click to jump to source</Tooltip.Content>
        </Tooltip.Root>
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
          id="preview-page-{visiblePage}"
          class="relative shrink-0 overflow-hidden rounded shadow-md"
        >
          {#if committedPages[visiblePage]}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    class="block h-auto rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
                    onclick={(e) => handlePageClick(e, visiblePage)}
                  >
                    <img
                      src="data:image/png;base64,{committedPages[visiblePage]}"
                      alt="Page {visiblePage + 1}"
                      draggable="false"
                      class="block max-w-full"
                    />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Click to jump to source</Tooltip.Content>
            </Tooltip.Root>
          {:else}
            <div class="h-[800px] w-[566px] animate-pulse bg-muted"></div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div
      bind:this={scrollEl}
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
            {#if committedPages[i]}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="ghost"
                      class="block h-auto rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
                      onclick={(e) => handlePageClick(e, i)}
                    >
                      <img
                        src="data:image/png;base64,{committedPages[i]}"
                        alt="Page {i + 1}"
                        draggable="false"
                        class="block max-w-full"
                      />
                    </Button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>Click to jump to source</Tooltip.Content>
              </Tooltip.Root>
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

<ExportDialog bind:open={exportOpen} totalPages={preview.totalPages} />
