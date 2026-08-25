<!--
  vcs/page-diff-view.svelte

  "Which pages changed since this restore point." The file diff next door
  answers it in source terms; this answers it in *printed* terms, which is the
  question you actually have before sending a document out.

  Rendered as a contact sheet: one card per page of the newer document, in
  reading order, with removed pages sitting where they used to be. Status is
  carried by a colored ring rather than a badge alone, so a run of untouched
  pages reads as quiet grey and the edits pop out at a glance.

  Changed pages hold both renders. Hovering a card crossfades to the old one —
  the fastest way to see *what* moved without leaving the overview. Clicking
  any card opens it full size in `page-zoom-dialog`, which re-renders that one
  page at a resolution you can actually read.

  Thumbnails come from the same `previewimg://` scheme the live preview uses;
  the backend rasterizes them at 72 dpi into its own cache. A page whose
  render fell outside the budget arrives with no key and shows a placeholder
  rather than a broken image. It still opens, though: the dialog renders from
  the documents the backend kept, so the budget only ever costs a page its
  thumbnail.
-->
<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Image01Icon,
    Layers01Icon,
    Loading03Icon,
    RefreshIcon,
  } from "@hugeicons/core-free-icons";

  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { buildPreviewUrl } from "$lib/preview-url";
  import { vcs } from "$lib/stores/vcs.svelte";
  import type { PageChangeKind, PageDiffEntry } from "$lib/types";
  import PageZoomDialog from "./page-zoom-dialog.svelte";

  let { onrefresh }: { onrefresh?: () => void } = $props();

  let showUnchanged = $state(true);

  /** Which sheet row the zoom dialog is showing. Position into `rows` (not
   *  the entry list) so its ← / → navigation matches what's on screen. */
  let zoomOpen = $state(false);
  let zoomPosition = $state(0);

  const diff = $derived(vcs.pageDiff);

  const rows = $derived.by(() => {
    const entries = diff?.entries ?? [];
    const indexed = entries.map((entry, index) => ({ entry, index }));
    return showUnchanged ? indexed : indexed.filter((r) => r.entry.kind !== "unchanged");
  });

  /** 1-based page number to show on the card. Removed pages have no number in
   *  the new document, so they fall back to the one they used to have. */
  function pageLabel(entry: PageDiffEntry): string {
    if (entry.kind === "removed") return `was p.${(entry.before_index ?? 0) + 1}`;
    return `p.${(entry.after_index ?? 0) + 1}`;
  }

  /** The image a card shows at rest, and the one it reveals on hover. */
  function restKey(entry: PageDiffEntry): string | null {
    return entry.kind === "removed" ? entry.before_key : entry.after_key;
  }
  function revealKey(entry: PageDiffEntry): string | null {
    return entry.kind === "changed" ? entry.before_key : null;
  }

  const kindLabel: Record<PageChangeKind, string> = {
    unchanged: "unchanged",
    changed: "changed",
    added: "added",
    removed: "removed",
  };

  /** Ring + text color per status. Kept as whole class strings so Tailwind
   *  sees them literally rather than assembling names at runtime. */
  const ringClass: Record<PageChangeKind, string> = {
    unchanged: "ring-border/60",
    changed: "ring-amber-500/70",
    added: "ring-emerald-500/70",
    removed: "ring-red-500/70",
  };
  const chipClass: Record<PageChangeKind, string> = {
    unchanged: "bg-muted text-muted-foreground",
    changed: "bg-amber-500-15 text-amber-600 dark:text-amber-400",
    added: "bg-emerald-500-15 text-emerald-600 dark:text-emerald-400",
    removed: "bg-red-500-15 text-red-600 dark:text-red-400",
  };

  /** Non-zero status counts, in the order they read best. */
  const summary = $derived.by(() => {
    const d = diff;
    if (!d) return [] as { kind: PageChangeKind; count: number }[];
    return (
      [
        { kind: "changed" as const, count: d.changed },
        { kind: "added" as const, count: d.added },
        { kind: "removed" as const, count: d.removed },
      ] satisfies { kind: PageChangeKind; count: number }[]
    ).filter((s) => s.count > 0);
  });

  function openZoom(position: number) {
    zoomPosition = position;
    zoomOpen = true;
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  {#if vcs.pageDiffLoading}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <HugeiconsIcon icon={Loading03Icon} class="size-5 animate-spin" />
      <p class="text-sm">Compiling that restore point…</p>
      <p class="max-w-xs text-center text-[11px] text-muted-foreground/70">
        Page-level comparison needs the old version of the document laid out, so this
        takes about as long as a normal compile.
      </p>
    </div>
  {:else if vcs.pageDiffError}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <HugeiconsIcon icon={Image01Icon} class="size-6 text-muted-foreground/40" />
      <p class="max-w-md text-sm text-muted-foreground">{vcs.pageDiffError}</p>
      {#if onrefresh}
        <Button variant="outline" size="xs" onclick={onrefresh}>
          <HugeiconsIcon icon={RefreshIcon} class="size-3" />
          Try again
        </Button>
      {/if}
    </div>
  {:else if !diff}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <HugeiconsIcon icon={Layers01Icon} class="size-6 text-muted-foreground/40" />
      <p class="text-sm text-muted-foreground">Compare the rendered pages of this restore point.</p>
      {#if onrefresh}
        <Button variant="outline" size="xs" onclick={onrefresh}>Compare pages</Button>
      {/if}
    </div>
  {:else}
    <!-- Summary strip ─────────────────────────────────────────────────── -->
    <div
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[11px]"
    >
      <span class="tabular-nums text-muted-foreground">
        {diff.before_pages} → {diff.after_pages} pages
      </span>
      {#each summary as item (item.kind)}
        <span class="rounded-sm px-1.5 py-0.5 tabular-nums {chipClass[item.kind]}">
          {item.count}
          {kindLabel[item.kind]}
        </span>
      {/each}
      {#if summary.length === 0}
        <span class="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
          No pages changed
        </span>
      {/if}
      <span class="text-muted-foreground/50">·</span>
      <span class="tabular-nums text-muted-foreground/60">{Math.round(diff.elapsed_ms)} ms</span>

      <div class="ml-auto flex items-center gap-1">
        {#if diff.unchanged > 0}
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={showUnchanged}
            onclick={() => (showUnchanged = !showUnchanged)}
          >
            {showUnchanged ? "Hide" : "Show"} unchanged
          </Button>
        {/if}
        {#if onrefresh}
          <Button variant="ghost" size="icon-xs" onclick={onrefresh} aria-label="Recompute">
            <HugeiconsIcon icon={RefreshIcon} class="size-3" />
          </Button>
        {/if}
      </div>
    </div>

    {#if diff.truncated}
      <p class="shrink-0 bg-amber-500-15 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-400">
        This document is long enough that some thumbnails were skipped. The page
        statuses are still complete, and any page still opens full size on click.
      </p>
    {/if}

    <!-- Contact sheet ─────────────────────────────────────────────────── -->
    <ScrollArea.Root class="min-h-0 flex-1">
      {#if rows.length === 0}
        <p class="py-12 text-center text-sm text-muted-foreground">
          Every page is unchanged.
        </p>
      {:else}
        <!-- `items-start` keeps cards at their natural height. The frame has
             no forced aspect ratio: a slide deck is 16:9 and would sit
             letterboxed inside an A4 box, and since every page of one document
             shares a size the grid still tiles evenly. -->
        <div
          class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] items-start gap-3 p-3"
        >
          {#each rows as { entry, index }, position (index)}
            {@const rest = restKey(entry)}
            {@const reveal = revealKey(entry)}
            <!-- Every card opens, including ones whose thumbnail fell
                 outside the render budget: the dialog renders on demand from
                 the documents the backend still holds, so the budget only
                 ever cost this page its *preview*, not its detail view. -->
            <Tooltip.Root delayDuration={500} disableHoverableContent>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <button
                    {...props}
                    type="button"
                    class="group relative flex cursor-zoom-in flex-col gap-1 text-left focus-visible:outline-none"
                    onclick={() => openZoom(position)}
                  >
                    <div
                      class={[
                        "relative w-full overflow-hidden rounded-sm bg-white ring-2",
                        "group-focus-visible:ring-ring group-focus-visible:ring-offset-2",
                        "group-focus-visible:ring-offset-background",
                        ringClass[entry.kind],
                        entry.kind === "unchanged" && "opacity-55 group-hover:opacity-100",
                        entry.kind === "removed" && "opacity-70",
                      ]}
                    >
                      {#if rest}
                        <!-- In flow, so this image is what gives the frame its
                             height and therefore its true page proportions. -->
                        <img
                          src={buildPreviewUrl(rest)}
                          alt="{pageLabel(entry)} ({kindLabel[entry.kind]})"
                          class="block h-auto w-full"
                          loading="lazy"
                          draggable="false"
                        />
                      {:else}
                        <!-- Nothing to measure, so fall back to a portrait box.
                             Still clickable — the full-size view doesn't depend on
                             a thumbnail having been made. -->
                        <div
                          class="flex aspect-[1/1.414] items-center justify-center bg-muted px-2 text-center text-[10px] text-muted-foreground"
                        >
                          click to render
                        </div>
                      {/if}

                      {#if reveal}
                        <!-- The old render, crossfaded in on hover / focus. A peek,
                             not a comparison — the dialog does that properly. -->
                        <img
                          src={buildPreviewUrl(reveal)}
                          alt="{pageLabel(entry)} before the change"
                          class="absolute inset-0 size-full object-contain opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                          loading="lazy"
                          draggable="false"
                        />
                        <span
                          class="absolute bottom-1 left-1 rounded-sm bg-black/70 px-1 text-[9px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                          before
                        </span>
                      {/if}
                    </div>

                    <div class="flex items-center gap-1 text-[10px]">
                      <span class="tabular-nums text-muted-foreground">{pageLabel(entry)}</span>
                      {#if entry.kind !== "unchanged"}
                        <span class="rounded-sm px-1 leading-4 {chipClass[entry.kind]}">
                          {kindLabel[entry.kind]}
                        </span>
                      {/if}
                      {#if entry.kind === "unchanged" && entry.before_index !== entry.after_index}
                        <!-- Same content, different page number: the give-away that
                             something upstream grew or shrank. -->
                        <span class="tabular-nums text-muted-foreground/60">
                          moved from {(entry.before_index ?? 0) + 1}
                        </span>
                      {/if}
                    </div>
                  </button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">
                {pageLabel(entry)} — {reveal
                  ? "hover for the old render, click to open full size"
                  : `${kindLabel[entry.kind]}, click to open full size`}
              </Tooltip.Content>
            </Tooltip.Root>
          {/each}
        </div>
      {/if}
    </ScrollArea.Root>

    <PageZoomDialog bind:open={zoomOpen} bind:position={zoomPosition} {rows} {kindLabel} {chipClass} />
  {/if}
</div>

<style>
  /* Soft status tints. Declared here too (not only in diff-window) so this
     view renders correctly wherever it's mounted. */
  :global(.bg-amber-500-15) {
    background-color: color-mix(in srgb, rgb(245 158 11) 15%, transparent);
  }
  :global(.bg-emerald-500-15) {
    background-color: color-mix(in srgb, rgb(16 185 129) 15%, transparent);
  }
  :global(.bg-red-500-15) {
    background-color: color-mix(in srgb, rgb(239 68 68) 15%, transparent);
  }
</style>
