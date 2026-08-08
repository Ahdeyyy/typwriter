<script lang="ts">
  import { Cancel01Icon, RefreshIcon, Alert02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { app } from "$lib/stores/app.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import PageList from "./page-list.svelte";

  let {
    /** 0-based page the editor caret renders on, resolved while the overlay was
     *  opening (null when it couldn't be placed). Scrolled to once per open. */
    startPage = null,
  }: { startPage?: number | null } = $props();

  // No pinch-to-zoom: the pinch gesture fought the scroll gesture and made
  // panning through pages miserable. Zoom is double-tap only (fit-width ↔ 2×).
  let bucket = $state<1 | 2 | 3 | 4>(settings.previewScaleBucket);
  let committedZoom = $state(1);
  let currentPage = $state(0);
  let lastTap = 0;
  let scroller = $state<HTMLElement | null>(null);
  /** Page already jumped to for this open; plain `let` so writing it can't
   *  re-trigger the effect that sets it. */
  let jumpedTo = -1;

  const visible = $derived(app.overlay === "preview");
  const total = $derived(compileStore.pages.length);

  // Land on the caret's page. Runs when the pages arrive (the overlay opens
  // before the compile finishes, showing a skeleton or the last render), and
  // only once per open — a later recompile must not yank the reader back.
  $effect(() => {
    const page = startPage;
    const pages = total;
    if (!visible) {
      jumpedTo = -1;
      return;
    }
    if (page === null || pages === 0 || !scroller || jumpedTo === page) return;
    jumpedTo = page;
    const target = scroller.querySelector(`[data-page-index="${Math.min(page, pages - 1)}"]`);
    target?.scrollIntoView({ block: "start" });
  });

  function bucketForZoom(zoom: number): 1 | 2 | 3 | 4 {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const eff = zoom * dpr;
    const table: [number, 1 | 2 | 3 | 4][] = [
      [1.0, 1],
      [1.5, 2],
      [2.0, 3],
      [3.0, 4],
    ];
    let best = table[0];
    for (const entry of table) {
      if (Math.abs(entry[0] - eff) < Math.abs(best[0] - eff)) best = entry;
    }
    return best[1];
  }

  // Double-tap toggles fit-width ↔ 2×.
  function onPointerUp() {
    const now = Date.now();
    if (now - lastTap < 300) {
      committedZoom = committedZoom > 1.5 ? 1 : 2;
      bucket = bucketForZoom(committedZoom);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }
</script>

{#if visible}
  <div class="bg-muted/95 fixed inset-0 z-50 flex flex-col backdrop-blur" style="padding-top: env(safe-area-inset-top);">
    <div class="flex h-12 shrink-0 items-center gap-1 border-b px-1">
      <Button variant="ghost" size="icon" aria-label="Close preview" onclick={() => app.closeOverlay()}>
        <Icon icon={Cancel01Icon} />
      </Button>
      <div class="flex-1 text-center text-sm font-medium">
        {#if total > 0}
          Page {currentPage + 1} / {total}
        {:else}
          Preview
        {/if}
      </div>

      {#if compileStore.status === "compiling"}
        <span class="text-muted-foreground flex items-center gap-1 px-2 text-xs">
          <Icon icon={Loading03Icon} class="size-4 animate-spin" /> Compiling…
        </span>
      {:else if compileStore.status === "error"}
        <button
          class="text-destructive flex items-center gap-1 px-2 text-xs"
          onclick={() => app.openOverlay("diagnostics")}
        >
          <Icon icon={Alert02Icon} class="size-4" />
          {compileStore.errors.length}
        </button>
      {/if}

      <Button variant="ghost" size="icon" aria-label="Recompile" onclick={() => void compileStore.run()}>
        <Icon icon={RefreshIcon} />
      </Button>
    </div>

    <!-- Scroller (native pan; double-tap toggles zoom) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={scroller}
      class="relative flex-1 overflow-auto overscroll-contain"
      style="padding-bottom: env(safe-area-inset-bottom);"
      onpointerup={onPointerUp}
    >
      {#if total === 0 && compileStore.status !== "compiling"}
        <div class="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
          Nothing to preview yet.
        </div>
      {:else}
        <div class="origin-top" style:width={`${committedZoom * 100}%`}>
          <PageList pages={compileStore.pages} {bucket} onVisible={(i) => (currentPage = i)} />
        </div>
      {/if}
    </div>
  </div>
{/if}
