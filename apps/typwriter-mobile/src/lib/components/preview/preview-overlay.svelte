<script lang="ts">
  import { onDestroy } from "svelte";
  import { toast } from "svelte-sonner";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { Cancel01Icon, RefreshIcon, Alert02Icon, Loading03Icon, Download01Icon } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { jumpFromClick } from "$lib/ipc/commands";
  import type { PreviewJump } from "$lib/ipc/types";
  import { app } from "$lib/stores/app.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { layout } from "$lib/stores/layout.svelte";
  import { immersive } from "$lib/stores/immersive.svelte";
  import { screen } from "$lib/motion";
  import PageList from "./page-list.svelte";

  let {
    /** 0-based page the editor caret renders on, resolved while the overlay was
     *  opening (null when it couldn't be placed). Scrolled to once per open. */
    startPage = null,
    /** Render as a pane beside the editor (wide tablets) instead of a
     *  full-screen overlay. Shown for as long as it is mounted. */
    docked = false,
  }: { startPage?: number | null; docked?: boolean } = $props();

  // No pinch-to-zoom: the pinch gesture fought the scroll gesture and made
  // panning through pages miserable. Zoom is double-tap only (fit-width ↔ 2×).
  let bucket = $derived<1 | 2 | 3 | 4>(settings.previewScaleBucket);
  let committedZoom = $state(1);
  let currentPage = $state(0);
  let lastTap = 0;
  let scroller = $state<HTMLElement | null>(null);
  /** Page already jumped to for this open; plain `let` so writing it can't
   *  re-trigger the effect that sets it. */
  let jumpedTo = -1;

  const visible = $derived(docked || app.overlay === "preview");
  const total = $derived(compileStore.pages.length);

  // Land on the caret's page. Runs when the pages arrive (the overlay opens
  // before the compile finishes, showing a skeleton or the last render), and
  // only once per open — a later recompile must not yank the reader back.
  $effect(() => {
    const page = startPage;
    const pages = total;
    if (!visible) {
      jumpedTo = -1;
      lastTap = 0;
      down = null;
      cancelPendingTap();
      flash = null;
      return;
    }
    if (page === null || pages === 0 || !scroller || jumpedTo === page) return;
    jumpedTo = page;
    const target = scroller.querySelector(`[data-page-index="${Math.min(page, pages - 1)}"]`);
    target?.scrollIntoView({ block: "start" });
  });

  // Immersive reading: scrolling the full-screen preview hides its controls
  // and the status bar. The scroller only exists while the overlay is open.
  $effect(() => {
    const el = scroller;
    if (!el || docked) return;
    return immersive.bind("preview", el);
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

  // ─── Taps ──────────────────────────────────────────────────────────────────
  // One gesture handler for the whole scroller: a double tap zooms, a single tap
  // resolves to a jump (a link's destination, or the source that rendered the
  // glyph). Pans and long presses are neither.

  /** Movement, in px, still counted as a tap rather than a pan. */
  const TAP_SLOP = 12;
  /** Beyond this a press is a long press (or a slow scroll), not a tap. */
  const TAP_MAX_MS = 600;
  /** Window in which a second tap makes the pair a double tap. */
  const DOUBLE_TAP_MS = 300;

  /** `revealing`: the chrome was hidden when the press began, so this tap only
   *  brings it back (immersive reading) and must not also navigate. Read on
   *  press because `immersive` reveals before our `pointerup` runs. */
  let down: { x: number; y: number; t: number; revealing: boolean } | null = null;
  /** Pending single tap: its jump lookup is already in flight, but acting on it
   *  waits out the double-tap window so the first tap of a zoom gesture doesn't
   *  navigate away. */
  let tapTimer: ReturnType<typeof setTimeout> | null = null;
  let tapRequest = 0;

  /** Fading marker on the point a jump landed on, in scroller content px. */
  let flash = $state<{ id: number; top: number; left: number; width: number } | null>(null);
  let flashId = 0;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelPendingTap() {
    tapRequest++;
    if (tapTimer !== null) clearTimeout(tapTimer);
    tapTimer = null;
  }

  function onPointerDown(e: PointerEvent) {
    down = { x: e.clientX, y: e.clientY, t: Date.now(), revealing: !docked && immersive.previewHidden };
  }

  function onPointerCancel() {
    down = null;
    cancelPendingTap();
  }

  function onPointerUp(e: PointerEvent) {
    const start = down;
    down = null;
    // A pan or a long press: the reader was scrolling or resting a finger, not
    // pointing at anything. Either also supersedes a tap still waiting out its
    // double-tap window — having started to scroll, they don't want the jump.
    if (!start) return;
    if (
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP ||
      Date.now() - start.t > TAP_MAX_MS
    ) {
      cancelPendingTap();
      return;
    }

    const now = Date.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      cancelPendingTap(); // the first tap was the start of a zoom, not a jump
      committedZoom = committedZoom > 1.5 ? 1 : 2;
      bucket = bucketForZoom(committedZoom);
      lastTap = 0;
      return;
    }
    lastTap = now;
    // Still counts as the first half of a double tap, so zoom keeps working.
    if (start.revealing) return;
    scheduleTap(e);
  }

  /** Ask the compiler what sits under the tap, then act once the double-tap
   *  window has passed. The lookup starts now (its latency overlaps the wait);
   *  the pointer coordinates have to be read now too, since the event is gone
   *  by the time the timer fires. */
  function scheduleTap(e: PointerEvent) {
    const pageEl = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-page-index]");
    if (!pageEl) return;
    const index = Number(pageEl.dataset.pageIndex);
    const meta = compileStore.pages[index];
    if (!meta) return;

    // Rendered pages are laid out at their true aspect ratio, so the tap maps
    // to typst points by proportion — no zoom or scale bucket involved.
    const rect = pageEl.getBoundingClientRect();
    const xPt = ((e.clientX - rect.left) / rect.width) * meta.widthPt;
    const yPt = ((e.clientY - rect.top) / rect.height) * meta.heightPt;

    const lookup = jumpFromClick(index, xPt, yPt);
    cancelPendingTap();
    const request = tapRequest;
    const workspaceVersion = workspace.version;
    const generation = compileStore.lastGeneration;
    tapTimer = setTimeout(() => {
      tapTimer = null;
      void lookup.match(
        (jump) => {
          if (jump && visible && request === tapRequest && workspaceVersion === workspace.version &&
            generation === compileStore.lastGeneration) applyJump(jump);
        },
        (err) => console.error("preview jump lookup failed:", err),
      );
    }, DOUBLE_TAP_MS);
  }

  function applyJump(jump: PreviewJump) {
    if (jump.type === "position") {
      scrollToPosition(jump.page, jump.x, jump.y);
    } else if (jump.type === "url") {
      openUrl(jump.url).catch(() => toast.error("Couldn't open the link"));
    } else {
      void openSource(jump.relPath, jump.offset);
    }
  }

  /** Follow an internal link: scroll to `x`/`y` typst points on `page`. */
  function scrollToPosition(page: number, xPt: number, yPt: number) {
    const meta = compileStore.pages[page];
    const el = scroller?.querySelector<HTMLElement>(`[data-page-index="${page}"]`);
    if (!scroller || !el || !meta) return;

    const box = scroller.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    // Page geometry in the scroller's content space (pages that haven't loaded
    // their image still reserve their exact box, so this is accurate anywhere
    // in the document).
    const pageTop = rect.top - box.top + scroller.scrollTop;
    const pageLeft = rect.left - box.left + scroller.scrollLeft;
    const y = pageTop + (yPt / meta.heightPt) * rect.height;
    const x = pageLeft + (xPt / meta.widthPt) * rect.width;

    // Land the target a fifth of the way down rather than flush under the top
    // bar; centre it horizontally, which only moves anything when zoomed in.
    scroller.scrollTo({
      top: Math.max(0, y - box.height * 0.2),
      left: Math.max(0, x - box.width / 2),
      behavior: "smooth",
    });

    // The destination is a point mid-page, so mark it — otherwise a jump that
    // lands a few lines off looks like nothing happened.
    if (flashTimer !== null) clearTimeout(flashTimer);
    flash = { id: ++flashId, top: y - 12, left: pageLeft, width: rect.width };
    flashTimer = setTimeout(() => (flash = null), 1200);
  }

  /** Follow a glyph back to the source that produced it. */
  async function openSource(relPath: string, offset: number) {
    const version = workspace.version;
    await app.closeOverlayAsync();
    if (version !== workspace.version || app.screen !== "editor" || app.overlay !== "none") return;
    const res = await editor.jumpTo(relPath, offset);
    res.mapErr((e) => toast.error(`Couldn't open ${relPath}: ${e}`));
  }

  onDestroy(() => {
    cancelPendingTap();
    if (flashTimer !== null) clearTimeout(flashTimer);
  });
</script>

{#if docked}
  <section class="bg-muted/60 flex h-full min-w-0 flex-col border-l" aria-label="Preview">
    <div class="flex h-12 shrink-0 items-center gap-1 border-b px-1">
      <Button variant="ghost" size="icon" aria-label="Close preview" onclick={() => (layout.previewPinned = false)}>
        <Icon icon={Cancel01Icon} />
      </Button>
      <div class="flex-1 text-center text-sm font-medium">{@render pageLabel()}</div>
      {@render status()}
      <Button variant="ghost" size="icon" aria-label="Export document" onclick={() => app.openOverlay("export")}>
        <Icon icon={Download01Icon} />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Recompile" onclick={() => void compileStore.run()}>
        <Icon icon={RefreshIcon} />
      </Button>
    </div>
    {@render pages("relative flex-1")}
  </section>
{:else if visible}
  <!-- Full screen, edge to edge: pages run under the status bar and the
       floating controls, which slide away (with the status bar) as soon as
       the reader scrolls into the document — see `immersive`. -->
  <div
    transition:screen
    class="bg-muted fixed inset-0 z-50"
    style:--scrim-color="var(--muted)"
    style:--preview-pad-top="calc(var(--safe-top) + var(--float-header-h) + 0.5rem)"
  >
    {@render pages("absolute inset-0")}

    <div
      class="immersive-top pointer-events-none absolute inset-x-0 top-0 z-20"
      data-hidden={immersive.previewHidden}
    >
      <div class="status-scrim"></div>
      <div
        class="flex items-center gap-2 pt-2"
        style:padding-left="calc(var(--safe-left) + 0.75rem)"
        style:padding-right="calc(var(--safe-right) + 0.75rem)"
      >
        <button class="float-btn" aria-label="Close preview" onclick={() => app.closeOverlay()}>
          <Icon icon={Cancel01Icon} class="size-5" />
        </button>
        <div class="flex min-w-0 flex-1 justify-center">
          <div class="float-pill flex h-11 items-center gap-2 px-4 text-sm font-medium tabular-nums">
            {#if compileStore.status === "compiling"}
              <Icon icon={Loading03Icon} class="text-muted-foreground size-4 animate-spin" />
            {/if}
            {@render pageLabel()}
          </div>
        </div>
        {#if compileStore.status === "error"}
          <button
            class="float-pill text-destructive flex h-11 items-center gap-1.5 px-3.5 text-sm font-semibold tabular-nums"
            aria-label="{compileStore.errors.length} errors"
            onclick={() => app.openOverlay("diagnostics")}
          >
            <Icon icon={Alert02Icon} class="size-[18px]" />
            {compileStore.errors.length}
          </button>
        {/if}
        <button class="float-btn" aria-label="Export document" onclick={() => app.openOverlay("export")}>
          <Icon icon={Download01Icon} class="size-5" />
        </button>
        <button class="float-btn" aria-label="Recompile" onclick={() => void compileStore.run()}>
          <Icon icon={RefreshIcon} class="size-5" />
        </button>
      </div>
    </div>
  </div>
{/if}

{#snippet pageLabel()}
  {#if total > 0}
    Page {currentPage + 1} / {total}
  {:else}
    Preview
  {/if}
{/snippet}

{#snippet status()}
  {#if compileStore.status === "compiling"}
    <span class="text-muted-foreground flex items-center gap-1 px-2 text-xs">
      <Icon icon={Loading03Icon} class="size-[18px] animate-spin" /> Compiling…
    </span>
  {:else if compileStore.status === "error"}
    <button
      class="text-destructive flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium tabular-nums"
      onclick={() => app.openOverlay("diagnostics")}
    >
      <Icon icon={Alert02Icon} class="size-5" />
      {compileStore.errors.length}
    </button>
  {/if}
{/snippet}

{#snippet pages(placement: string)}
  <!-- Scroller (native pan; double-tap toggles zoom). Full screen, its padding
       keeps the first page clear of the floating header and the last one
       clear of the navigation bar; `scroll-padding-top` does the same for
       jumps to a page. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={scroller}
    class="{placement} overflow-auto overscroll-contain"
    style:padding-top={docked ? undefined : "var(--preview-pad-top)"}
    style:scroll-padding-top={docked ? undefined : "var(--preview-pad-top)"}
    style:padding-bottom="calc(var(--safe-bottom) + 0.5rem)"
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
  >
    {#if total === 0 && compileStore.status !== "compiling"}
      <div class="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        Nothing to preview yet.
      </div>
    {:else}
      <div class="origin-top" style:width={`${committedZoom * 100}%`}>
        <PageList pages={compileStore.pages} {bucket} onVisible={(i) => (currentPage = i)} />
      </div>
      {#if flash}
        {#key flash.id}
          <div
            class="jump-flash bg-primary/40 pointer-events-none absolute z-10 h-6 rounded-sm"
            style:top={`${flash.top}px`}
            style:left={`${flash.left}px`}
            style:width={`${flash.width}px`}
          ></div>
        {/key}
      {/if}
    {/if}
  </div>
{/snippet}

<style>
  /* Marks where an internal link landed, then gets out of the way. */
  .jump-flash {
    animation: jump-flash 1.2s ease-out forwards;
  }
  @keyframes jump-flash {
    0% {
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>
