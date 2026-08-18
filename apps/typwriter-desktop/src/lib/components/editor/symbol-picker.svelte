<script lang="ts">
  // Searchable grid of Typst symbols.
  //
  // Search is over the name, the meaning ("not equal" finds `eq.not`) and the
  // character itself, so pasting a `≠` from elsewhere tells you what to type.

  import { tick } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Search01Icon } from "@hugeicons/core-free-icons";

  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { fuzzyRank } from "$lib/fuzzy";
  import {
    insertionFor,
    isInMath,
    SYMBOLS,
    SYMBOL_CATEGORIES,
    type TypstSymbol,
  } from "$lib/typst-symbols";

  let query = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);

  /** Whether the caret is inside `$…$`, which decides what gets inserted.
   *  Read when the picker opens: the caret cannot move while it is up. */
  let inMath = $state(false);

  $effect(() => {
    if (!ui.symbolPickerOpen) return;
    const view = editorSearch.getActiveView();
    inMath = view ? isInMath(view.state.doc.toString(), view.state.selection.main.head) : false;
    query = "";
    void tick().then(() => inputEl?.focus());
  });

  const matches = $derived(
    fuzzyRank(
      SYMBOLS,
      query,
      (symbol) => symbol.name,
      (symbol) => [...(symbol.keywords ?? []), symbol.char, symbol.category],
    ).map((result) => result.item),
  );

  /** Grouped while unfiltered, flat once searching — a ranked list should stay
   *  in rank order rather than being re-sorted into buckets. */
  const grouped = $derived(
    query.trim()
      ? null
      : SYMBOL_CATEGORIES.map((category) => ({
          category,
          symbols: matches.filter((symbol) => symbol.category === category),
        })).filter((group) => group.symbols.length > 0),
  );

  function insert(symbol: TypstSymbol) {
    const view = editorSearch.getActiveView();
    if (!view) return;

    const text = insertionFor(symbol, inMath);
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    ui.symbolPickerOpen = false;
    view.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      ui.symbolPickerOpen = false;
      editorSearch.getActiveView()?.focus();
      return;
    }
    // Enter takes the top match, so a symbol can be inserted without the mouse.
    if (event.key === "Enter" && matches.length > 0) {
      event.preventDefault();
      insert(matches[0]);
    }
  }
</script>

{#snippet cell(symbol: TypstSymbol, isTopMatch: boolean)}
  <Tooltip.Root>
    <Tooltip.Trigger
      class="hover:bg-accent hover:text-accent-foreground flex aspect-square w-full
             flex-col items-center justify-center rounded-md text-lg
             {isTopMatch ? 'ring-accent-foreground/30 ring-1' : ''}"
      onclick={() => insert(symbol)}
    >
      {symbol.char}
    </Tooltip.Trigger>
    <Tooltip.Content>
      <span class="font-medium">{symbol.name}</span>
      <span class="opacity-70">— inserts</span>
      <code>{insertionFor(symbol, inMath)}</code>
    </Tooltip.Content>
  </Tooltip.Root>
{/snippet}

{#if ui.symbolPickerOpen}
  <!-- Its own provider: the grid wants a short hover delay of its own, and no
       hoverable content, so sweeping across symbols never traps the pointer. -->
  <Tooltip.Provider delayDuration={200} disableHoverableContent>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex justify-center bg-black/40 backdrop-blur-[2px]"
      onclick={(event) => {
        if (event.target === event.currentTarget) ui.symbolPickerOpen = false;
      }}
      {onkeydown}
      role="presentation"
    >
      <div
        class="bg-popover text-popover-foreground mt-[12vh] flex h-fit max-h-[70vh] w-full
               max-w-xl flex-col overflow-hidden rounded-xl shadow-2xl"
      >
        <div class="flex items-center gap-2 px-4 py-3">
          <HugeiconsIcon icon={Search01Icon} class="size-4 shrink-0 opacity-50" />
          <input
            bind:this={inputEl}
            bind:value={query}
            class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm
                   outline-none"
            placeholder="Search symbols — try “not equal” or paste ≠"
            spellcheck="false"
            autocomplete="off"
          />
          <span class="text-muted-foreground shrink-0 text-[10px]">
            {inMath ? "math mode" : "markup"}
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {#if matches.length === 0}
            <p class="text-muted-foreground px-2 py-8 text-center text-sm">
              No symbol matches “{query}”.
            </p>
          {:else if grouped}
            {#each grouped as group (group.category)}
              <div
                class="text-muted-foreground px-2 pb-1 pt-3 text-[10px] font-semibold uppercase
                       tracking-wider first:pt-1"
              >
                {group.category}
              </div>
              <div class="grid grid-cols-8 gap-1">
                {#each group.symbols as symbol (symbol.name)}
                  {@render cell(symbol, false)}
                {/each}
              </div>
            {/each}
          {:else}
            <div class="grid grid-cols-8 gap-1 pt-1">
              {#each matches as symbol, index (symbol.name)}
                {@render cell(symbol, index === 0)}
              {/each}
            </div>
          {/if}
        </div>

        <div
          class="text-muted-foreground bg-muted/40 flex items-center gap-3 px-4 py-2 text-[10px]"
        >
          <span><kbd class="font-semibold">↵</kbd> insert top match</span>
          <span><kbd class="font-semibold">esc</kbd> close</span>
          <span class="ml-auto truncate">
            {matches.length} of {SYMBOLS.length}
          </span>
        </div>
      </div>
    </div>
  </Tooltip.Provider>
{/if}
