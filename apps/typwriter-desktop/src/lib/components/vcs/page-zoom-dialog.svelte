<!--
  vcs/page-zoom-dialog.svelte

  Full-size view of one page from the contact sheet. The sheet renders at 72
  dpi — enough to see *that* a page moved, not enough to read it — so opening
  a page here asks the backend for a genuinely sharper rasterization of that
  single page. It is cheap: the engine still holds both documents laid out, so
  this is one render, not a recompile.

  For a changed page the dialog owns the real before/after comparison: a Before
  / After toggle over the same frame, so the two renders land in exactly the
  same place and the difference is the only thing that moves. `←` / `→` walk
  the sheet without closing, `B` flips sides.
-->
<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Loading03Icon,
  } from "@hugeicons/core-free-icons";

  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { buildPreviewUrl } from "$lib/preview-url";
  import { vcsPageDiffRenderPage } from "$lib/ipc/commands";
  import type { PageChangeKind, PageDiffEntry, PageDiffSide } from "$lib/types";

  export type ZoomRow = { entry: PageDiffEntry; index: number };

  let {
    open = $bindable(false),
    rows,
    position = $bindable(0),
    kindLabel,
    chipClass,
  }: {
    open?: boolean;
    /** The sheet's currently visible rows, so navigation matches what's on
     *  screen rather than the unfiltered result. */
    rows: ZoomRow[];
    /** Index into `rows` of the page being shown. */
    position?: number;
    kindLabel: Record<PageChangeKind, string>;
    chipClass: Record<PageChangeKind, string>;
  } = $props();

  const row = $derived(rows[position]);
  const entry = $derived(row?.entry);

  /** Which sides this page actually has a render for. */
  const sides = $derived.by((): PageDiffSide[] => {
    if (!entry) return [];
    const out: PageDiffSide[] = [];
    if (entry.before_index !== null) out.push("before");
    if (entry.after_index !== null) out.push("after");
    return out;
  });

  let side = $state<PageDiffSide>("after");
  let key = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** Bumped on every request so a slow render for a page the user has already
   *  navigated away from can't overwrite the current one. */
  let generation = 0;
  /** Sheet row the currently-held image belongs to. Flipping Before/After
   *  stays on the same row, so the old render is kept under the spinner —
   *  that continuity is the whole point of comparing in place. Moving to a
   *  different page clears it, because showing the previous page under a
   *  spinner would just be wrong. */
  let shownRow: number | null = null;

  /** Device pixels per typst point for the full-size render. 2 is already
   *  crisp at the widths this dialog opens to; a HiDPI screen earns one more
   *  step. Read lazily — `devicePixelRatio` doesn't exist during prerender —
   *  and clamped again on the backend regardless. */
  function fullScale(): number {
    const dpr = typeof globalThis.window === "undefined" ? 1 : globalThis.devicePixelRatio || 1;
    return Math.min(3, Math.max(2, Math.round(dpr * 2)));
  }

  function pageNumber(e: PageDiffEntry, s: PageDiffSide): number | null {
    return s === "before" ? e.before_index : e.after_index;
  }

  const heading = $derived.by(() => {
    if (!entry) return "";
    const n = pageNumber(entry, side);
    if (n === null) return "";
    return `Page ${n + 1}`;
  });

  // Keep `side` pointing at something this page has. A changed page opens on
  // "after" (what the document looks like now); a removed page has only a
  // before, an added page only an after.
  $effect(() => {
    if (sides.length > 0 && !sides.includes(side)) {
      side = sides.includes("after") ? "after" : sides[0];
    }
  });

  // Fetch the full-size render whenever the target changes. Keyed on the page
  // *indices* rather than the entry object so re-deriving `rows` (which the
  // filter toggle does) doesn't re-request an identical image.
  $effect(() => {
    const e = entry;
    const s = side;
    const rowIndex = row?.index ?? null;
    if (!open || !e || rowIndex === null) return;
    const pageIndex = pageNumber(e, s);
    if (pageIndex === null) return;

    if (shownRow !== rowIndex) {
      key = null;
      shownRow = rowIndex;
    }

    const mine = ++generation;
    loading = true;
    error = null;
    vcsPageDiffRenderPage(s, pageIndex, fullScale()).match(
      (path) => {
        if (mine !== generation) return;
        key = path;
        loading = false;
      },
      (err) => {
        if (mine !== generation) return;
        key = null;
        error = err;
        loading = false;
      }
    );
  });

  function step(delta: number) {
    const next = position + delta;
    if (next < 0 || next >= rows.length) return;
    position = next;
  }

  function flipSide() {
    if (sides.length < 2) return;
    side = side === "before" ? "after" : "before";
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      flipSide();
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="flex h-[92vh] w-full max-w-[min(96vw,1200px)] flex-col gap-2 p-3 sm:max-w-[min(96vw,1200px)]"
    onkeydown={onkeydown}
  >
    <Dialog.Header class="shrink-0 pr-10">
      <Dialog.Title class="flex items-center gap-2 text-sm">
        {heading}
        {#if entry && entry.kind !== "unchanged"}
          <span class="rounded-sm px-1.5 text-[10px] leading-4 {chipClass[entry.kind]}">
            {kindLabel[entry.kind]}
          </span>
        {/if}
        {#if sides.length > 1}
          <!-- Two buttons over one frame rather than a side-by-side split:
               at this size a split halves each page, and flipping in place is
               what makes a small change visible at all. -->
          <span class="ml-1 flex items-center rounded border border-border">
            {#each sides as s (s)}
              <Button
                variant={side === s ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={side === s}
                onclick={() => (side = s)}
              >
                {s === "before" ? "Before" : "After"}
              </Button>
            {/each}
          </span>
        {/if}
      </Dialog.Title>
      <Dialog.Description class="text-[11px] text-muted-foreground">
        {#if rows.length > 1}
          {position + 1} of {rows.length} · <kbd class="font-sans">←</kbd>
          <kbd class="font-sans">→</kbd> to move
        {/if}
        {#if sides.length > 1}
          · <kbd class="font-sans">B</kbd> to flip
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex min-h-0 flex-1 items-center gap-2">
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        disabled={position <= 0}
        onclick={() => step(-1)}
        aria-label="Previous page"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} class="size-4" />
      </Button>

      <div class="relative flex h-full min-w-0 flex-1 items-center justify-center overflow-auto">
        {#if error}
          <p class="max-w-md px-6 text-center text-sm text-muted-foreground">{error}</p>
        {:else if key}
          <img
            src={buildPreviewUrl(key)}
            alt={heading}
            class="mx-auto max-h-full w-auto bg-white shadow-sm"
            draggable="false"
          />
        {/if}
        {#if loading}
          <div
            class="absolute inset-0 flex items-center justify-center bg-popover/60 text-muted-foreground"
          >
            <HugeiconsIcon icon={Loading03Icon} class="size-5 animate-spin" />
          </div>
        {/if}
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        disabled={position >= rows.length - 1}
        onclick={() => step(1)}
        aria-label="Next page"
      >
        <HugeiconsIcon icon={ArrowRight01Icon} class="size-4" />
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
