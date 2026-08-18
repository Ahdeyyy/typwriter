<script lang="ts">
  // Document statistics along the bottom of the editor pane: words, characters
  // and pages, switching to the selection's counts whenever something is
  // selected. Absent from the app until now, and the first thing a writer looks
  // for in a typesetting tool.

  import { editor } from "$lib/stores/editor.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { documentStats, selectionStats, EMPTY_STATS } from "$lib/doc-stats";
  import { extractOutline, activeOutlineIndex, outlineBreadcrumb } from "$lib/outline";

  /** Counting walks the whole syntax tree, so it is debounced off the typing
   *  hot path. Long enough to skip mid-word churn, short enough that the number
   *  has settled by the time the eye reaches it. */
  const RECOUNT_DELAY = 400;

  const tab = $derived(editor.activeTab);
  const isTypst = $derived(
    !!tab && tab.viewMode === "text" && !tab.isLoading && tab.relPath.endsWith(".typ"),
  );

  let settled = $state("");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTabId: string | null = null;

  $effect(() => {
    const id = tab?.id ?? null;
    const content = isTypst ? (tab?.content ?? "") : "";

    // Switching files re-counts at once: waiting to show a *different* file's
    // numbers reads as lag, where waiting mid-typing does not.
    if (id !== lastTabId) {
      lastTabId = id;
      if (timer) clearTimeout(timer);
      timer = null;
      settled = content;
      return;
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      settled = content;
      timer = null;
    }, RECOUNT_DELAY);

    return () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
  });

  const selection = $derived(editor.selection);
  const hasSelection = $derived(selection.to > selection.from);

  const stats = $derived(
    !isTypst
      ? EMPTY_STATS
      : hasSelection
        ? selectionStats(settled, selection.from, selection.to)
        : documentStats(settled),
  );

  // Where the caret is, so the writer can see which section they are editing
  // without opening the outline panel.
  const breadcrumb = $derived.by(() => {
    if (!isTypst) return "";
    const items = extractOutline(settled);
    const chain = outlineBreadcrumb(items, activeOutlineIndex(items, selection.to));
    return chain.map((item) => item.title).join(" › ");
  });

  const nf = new Intl.NumberFormat();
</script>

{#if isTypst}
  <div
    class="text-muted-foreground flex shrink-0 items-center gap-3 px-3 py-1 text-[11px]
           tabular-nums select-none"
  >
    {#if breadcrumb}
      <span class="min-w-0 truncate" title={breadcrumb}>{breadcrumb}</span>
    {/if}

    <span class="ml-auto shrink-0">
      {#if hasSelection}
        <span class="font-medium">{nf.format(stats.words)}</span> selected
      {:else}
        <span class="font-medium">{nf.format(stats.words)}</span>
        {stats.words === 1 ? "word" : "words"}
      {/if}
    </span>

    <span class="shrink-0">{nf.format(stats.characters)} chars</span>

    {#if !hasSelection && stats.readingMinutes > 0}
      <span class="shrink-0" title="At about 220 words per minute">
        ~{stats.readingMinutes} min read
      </span>
    {/if}

    {#if preview.totalPages > 0}
      <span class="shrink-0">
        {nf.format(preview.totalPages)}
        {preview.totalPages === 1 ? "page" : "pages"}
      </span>
    {/if}
  </div>
{/if}
