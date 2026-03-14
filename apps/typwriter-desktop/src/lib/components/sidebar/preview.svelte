<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { MagnifyingGlassPlus, MagnifyingGlassMinus, ArrowCounterClockwise, DownloadSimple } from "phosphor-svelte";
  import ExportDialog from "./export-dialog.svelte";

  import { openUrl } from "@tauri-apps/plugin-opener";

  import { preview } from "$lib/stores/preview.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { jumpFromClick, setVisiblePage } from "$lib/ipc/commands";
  import { Button } from "$lib/components/ui/button";
  import { logError } from "$lib/logger";

  // ── Local state ────────────────────────────────────────────────────────────

  let scrollEl = $state<HTMLDivElement | null>(null);
  let visiblePage = $state(0);
  let exportOpen = $state(false);
  const PAGE_BUFFER = 2;

  // ── Double-buffer: hold last decoded page data to avoid flash on update ────
  let committedPages = $state<(string | null)[]>([]);

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

      const idx = i;
      const img = new Image();
      img.onload = () => {
        if (preview.pages[idx] === data) committedPages[idx] = data;
      };
      img.src = `data:image/png;base64,${data}`;
    }
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    preview.init().catch((err) => logError("preview init failed:", err));
  });

  onDestroy(() => {
    preview.destroy();
  });

  // ── Scroll to page when cursor sync fires ──────────────────────────────────

  $effect(() => {
    const target = preview.scrollTarget;
    if (target === null) return;
    preview.scrollTarget = null;

    // Pre-render the target page by moving visiblePage before scrolling.
    // This ensures shouldRenderPage(target) returns true and the actual image
    // is in the DOM (correct height) when scrollIntoView fires.
    visiblePage = target;

    // One rAF lets Svelte flush the DOM update triggered by visiblePage change.
    requestAnimationFrame(() => {
      const el = document.getElementById(`preview-page-${target}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // ── IntersectionObserver for page counter ──────────────────────────────────

  $effect(() => {
    const el = scrollEl;
    const count = preview.totalPages;
    if (!el || count === 0) return;

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

  function shouldRenderPage(index: number) {
    return Math.abs(index - visiblePage) <= PAGE_BUFFER;
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
      const relPath = workspace.toRel(jump.path);
      editor
        .openFile(relPath)
        .map(() => editor.requestCursorJump(relPath, jump.start_byte))
        .mapErr((err) => logError("jump from click failed:", err));
    } else if (jump.type === "url") {
      openUrl(jump.url).catch((err) => logError("open url failed:", err));
    } else if (jump.type === "position") {
      preview.scrollTarget = jump.page;
    }
  }

  // ── Zoom display (zoom=2.0 → "100%") ──────────────────────────────────────

  const zoomLabel = $derived(`${Math.round(preview.zoom * 50)}%`);

  // ── Narrow toolbar ─────────────────────────────────────────────────────────

  let toolbarWidth = $state(0);
  const isNarrow = $derived(toolbarWidth > 0 && toolbarWidth < 240);
</script>

<div class="flex h-full flex-col bg-background text-foreground">
  <!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
  <div
    bind:clientWidth={toolbarWidth}
    class={isNarrow
      ? "flex flex-col shrink-0 border-b border-border px-2 py-0.5"
      : "flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2"}
  >
    <!-- Zoom controls -->
    <div class={isNarrow ? "flex items-center gap-0.5 w-full" : "flex items-center gap-0.5"}>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Zoom out"
        onclick={zoomOut}
        disabled={preview.zoom <= 0.5}
      >
        <MagnifyingGlassMinus class="size-3.5" />
      </Button>

      <span class="w-12 text-center text-xs text-muted-foreground tabular-nums">
        {zoomLabel}
      </span>

      <Button
        variant="ghost"
        size="icon-sm"
        title="Zoom in"
        onclick={zoomIn}
        disabled={preview.zoom >= 8.0}
      >
        <MagnifyingGlassPlus class="size-3.5" />
      </Button>
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

      {#if preview.totalPages > 0}
        <span class="text-xs text-muted-foreground tabular-nums">
          {visiblePage + 1} / {preview.totalPages}
        </span>
      {/if}

      <Button
        variant="ghost"
        size="icon-sm"
        title="Export document"
        onclick={() => (exportOpen = true)}
        disabled={preview.totalPages === 0}
      >
        <DownloadSimple class="size-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        title="Refresh preview"
        onclick={refresh}
      >
        <ArrowCounterClockwise class="size-3.5" />
      </Button>
    </div>
  </div>

  <!-- ── Page list ──────────────────────────────────────────────────────── -->
  <div
    bind:this={scrollEl}
    class="flex flex-1 flex-col items-center gap-4 overflow-y-auto py-4 preview-scroll"
  >
    {#if preview.totalPages === 0}
      <div
        class="flex h-full select-none items-center justify-center text-xs text-muted-foreground"
      >
        Select a main `.typ` file in the explorer to render a preview.
      </div>
    {:else}
      {#each preview.pages as _, i}
        <div
          id="preview-page-{i}"
          class="relative shrink-0 overflow-hidden rounded shadow-md"
        >
          {#if committedPages[i] && shouldRenderPage(i)}
            <button
              class="block border-0 bg-transparent p-0"
              title="Click to jump to source"
              onclick={(e) => handlePageClick(e, i)}
            >
              <img
                src="data:image/png;base64,{committedPages[i]}"
                alt="Page {i + 1}"
                draggable="false"
                class="block max-w-full"
              />
            </button>
          {:else}
            <!-- Placeholder while page is rendering -->
            <div class="h-[800px] w-[566px] animate-pulse bg-muted"></div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<ExportDialog bind:open={exportOpen} totalPages={preview.totalPages} />
