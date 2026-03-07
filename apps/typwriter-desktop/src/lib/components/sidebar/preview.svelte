<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ZoomIn, ZoomOut, RotateCcw, Download } from "@lucide/svelte";
  import ExportDialog from "./export-dialog.svelte";

  import { preview } from "$lib/stores/preview.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { jumpFromClick, setVisiblePage } from "$lib/ipc/commands";
  import { Button } from "$lib/components/ui/button";

  // ── Local state ────────────────────────────────────────────────────────────

  let scrollEl = $state<HTMLDivElement | null>(null);
  let visiblePage = $state(0);
  let exportOpen = $state(false);
  const PAGE_BUFFER = 2;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    preview.init().catch((err) => console.error("preview init failed:", err));
  });

  onDestroy(() => {
    preview.destroy();
  });

  // ── Scroll to page when cursor sync fires ──────────────────────────────────

  $effect(() => {
    const target = preview.scrollTarget;
    if (target === null) return;
    preview.scrollTarget = null;
    const el = document.getElementById(`preview-page-${target}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    preview.zoomIn().catch(console.error);
  }
  function zoomOut() {
    preview.zoomOut().catch(console.error);
  }
  function refresh() {
    preview.triggerRefresh().catch(console.error);
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
        .mapErr((err) => console.error("jump from click failed:", err));
    }
  }

  // ── Zoom display (zoom=2.0 → "100%") ──────────────────────────────────────

  const zoomLabel = $derived(`${Math.round(preview.zoom * 50)}%`);
</script>

<div class="flex h-full flex-col bg-background text-foreground">
  <!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
  <div
    class="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2"
  >
    <Button
      variant="ghost"
      size="icon-sm"
      title="Zoom out"
      onclick={zoomOut}
      disabled={preview.zoom <= 0.5}
    >
      <ZoomOut class="size-3.5" />
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
      <ZoomIn class="size-3.5" />
    </Button>

    <div class="flex-1"></div>

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
      <Download class="size-3.5" />
    </Button>

    <Button
      variant="ghost"
      size="icon-sm"
      title="Refresh preview"
      onclick={refresh}
    >
      <RotateCcw class="size-3.5" />
    </Button>
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
      {#each preview.pages as pageData, i}
        <div
          id="preview-page-{i}"
          class="relative shrink-0 overflow-hidden rounded shadow-md"
        >
          {#if pageData && shouldRenderPage(i)}
            <button
              class="block border-0 bg-transparent p-0"
              title="Click to jump to source"
              onclick={(e) => handlePageClick(e, i)}
            >
              <img
                src="data:image/png;base64,{pageData}"
                alt="Page {i + 1}"
                draggable="false"
                loading="lazy"
                decoding="async"
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
