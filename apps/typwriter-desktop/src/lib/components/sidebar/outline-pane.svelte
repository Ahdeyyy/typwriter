<script lang="ts">
  // The document outline: every heading in the active .typ buffer, indented by
  // level, with the section the caret sits in marked.

  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { editor } from "$lib/stores/editor.svelte";
  import { activeOutlineIndex, extractOutline } from "$lib/outline";
  import { fuzzyRank, fuzzySegments } from "$lib/fuzzy";

  interface Props {
    onclose?: () => void;
  }

  let { onclose }: Props = $props();

  /** How long the buffer must be still before we re-parse it. Parsing is a
   *  whole-document pass, so doing it per keystroke would put a full parse on
   *  the typing hot path for the sake of a panel the user isn't looking at
   *  while typing. */
  const REPARSE_DELAY = 250;

  let query = $state("");
  let settled = $state("");

  const tab = $derived(editor.activeTab);
  const isTypst = $derived(!!tab && tab.viewMode === "text" && tab.relPath.endsWith(".typ"));

  // Mirror the live buffer into `settled` on a trailing debounce. Switching
  // files takes effect immediately — waiting a quarter second to show a
  // different file's outline reads as lag, where waiting mid-typing does not.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTabId: string | null = null;

  $effect(() => {
    const id = tab?.id ?? null;
    const content = isTypst ? (tab?.content ?? "") : "";

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
    }, REPARSE_DELAY);

    return () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
  });

  const items = $derived(extractOutline(settled));
  const current = $derived(activeOutlineIndex(items, editor.cursorOffset));

  // Carry the document-order index through the ranking so the "caret is here"
  // marker still refers to the outline, not to this filtered list.
  const rows = $derived(
    fuzzyRank(
      items.map((item, index) => ({ ...item, index })),
      query,
      (heading) => heading.title,
    ).map(({ item, match }) => ({ heading: item, match })),
  );

  function jump(offset: number) {
    if (editor.activeTabId) editor.requestCursorJump(editor.activeTabId, offset);
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center justify-between px-2 py-1.5">
    <span class="text-xs font-semibold">Outline</span>
    {#if onclose}
      <Button variant="ghost" size="icon-sm" onclick={onclose}>
        <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
      </Button>
    {/if}
  </div>

  {#if !isTypst}
    <p class="text-muted-foreground px-3 py-6 text-center text-xs">
      Open a <code>.typ</code> file to see its outline.
    </p>
  {:else if items.length === 0}
    <p class="text-muted-foreground px-3 py-6 text-center text-xs">
      This file has no headings yet. Start a line with <code>=</code> to add one.
    </p>
  {:else}
    <div class="flex items-center gap-1.5 px-2 pb-1.5">
      <HugeiconsIcon icon={Search01Icon} class="size-3.5 shrink-0 opacity-40" />
      <input
        bind:value={query}
        placeholder="Filter headings…"
        spellcheck="false"
        class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs
               outline-none"
      />
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="px-1 pb-2">
        {#each rows as { heading, match } (heading.from)}
          <button
            type="button"
            class="hover:bg-sidebar-accent flex w-full items-baseline gap-1.5 rounded px-1.5
                   py-1 text-left text-xs
                   {heading.index === current ? 'bg-sidebar-accent font-medium' : ''}"
            style="padding-left: {4 + (heading.level - 1) * 10}px"
            onclick={() => jump(heading.from)}
            title={heading.title}
          >
            <span class="text-muted-foreground shrink-0 text-[9px] tabular-nums">
              H{heading.level}
            </span>
            <span class="truncate">
              {#each fuzzySegments(heading.title, match.positions) as segment, segmentIndex (segmentIndex)}
                <span class={segment.hit ? "font-semibold underline" : ""}>{segment.text}</span>
              {/each}
            </span>
          </button>
        {/each}

        {#if rows.length === 0}
          <p class="text-muted-foreground px-2 py-4 text-center text-xs">
            No heading matches “{query}”.
          </p>
        {/if}
      </div>
    </ScrollArea>
  {/if}
</div>
