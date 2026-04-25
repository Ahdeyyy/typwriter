<script lang="ts">
  import {
    ArrowUp,
    ArrowDown,
    CaretDown,
    CaretRight,
    X,
    ArrowsClockwise,
    Repeat,
  } from "phosphor-svelte";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { tick } from "svelte";

  let searchInput = $state<HTMLInputElement | null>(null);
  let replaceInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (editorSearch.open) {
      tick().then(() => {
        searchInput?.focus();
        searchInput?.select();
      });
    }
  });

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      editorSearch.closePanel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) editorSearch.prev();
      else editorSearch.next();
      // findNext/findPrevious call view.focus() internally; steal it back.
      searchInput?.focus();
    }
  }

  function onReplaceKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      editorSearch.closePanel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.altKey) {
        editorSearch.replaceAllMatches();
      } else {
        editorSearch.replaceCurrent();
      }
    }
  }

  const counterText = $derived.by(() => {
    if (editorSearch.regexError) return editorSearch.regexError;
    if (!editorSearch.query) return "";
    if (editorSearch.totalMatches === 0) return "No results";
    return `${editorSearch.currentMatch || "?"} of ${editorSearch.totalMatches}`;
  });

  const noResults = $derived(
    !!editorSearch.query &&
      editorSearch.totalMatches === 0 &&
      !editorSearch.regexError,
  );
</script>

{#if editorSearch.open}
  <div
    class="search-panel absolute top-1 right-5 z-50 flex items-start gap-1 rounded-md border border-border bg-popover px-1 py-1 text-popover-foreground shadow-md"
    role="search"
    aria-label="Find and replace"
  >
    <button
      type="button"
      class="toggle-btn mt-[2px] flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      onclick={() => editorSearch.toggleReplace()}
      aria-label={editorSearch.replaceVisible
        ? "Toggle Replace"
        : "Toggle Replace"}
      title={editorSearch.replaceVisible ? "Hide Replace" : "Show Replace"}
    >
      {#if editorSearch.replaceVisible}
        <CaretDown class="size-3" />
      {:else}
        <CaretRight class="size-3" />
      {/if}
    </button>

    <div class="flex flex-col gap-1">
      <!-- Search row -->
      <div class="flex items-center gap-1">
        <div
          class="input-wrap flex h-6 items-center rounded border border-input bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50"
          class:!border-destructive={editorSearch.regexError || noResults}
        >
          <input
            bind:this={searchInput}
            type="text"
            placeholder="Find"
            bind:value={editorSearch.query}
            oninput={() => editorSearch.applyQuery()}
            onkeydown={onSearchKey}
            class="h-full w-56 bg-transparent px-2 text-xs outline-none"
            spellcheck="false"
            aria-label="Find"
          />
          <span
            class="counter shrink-0 px-1.5 text-[11px] tabular-nums text-muted-foreground select-none"
          >
            {counterText}
          </span>
          <div class="flex items-center gap-px pr-0.5">
            <button
              type="button"
              class="opt-btn"
              class:active={editorSearch.caseSensitive}
              onclick={() => editorSearch.toggleCaseSensitive()}
              title="Match Case"
              aria-label="Match Case"
              aria-pressed={editorSearch.caseSensitive}
            >
              Aa
            </button>
            <button
              type="button"
              class="opt-btn"
              class:active={editorSearch.wholeWord}
              onclick={() => editorSearch.toggleWholeWord()}
              title="Match Whole Word"
              aria-label="Match Whole Word"
              aria-pressed={editorSearch.wholeWord}
            >
              <span class="underline">ab</span>
            </button>
            <button
              type="button"
              class="opt-btn"
              class:active={editorSearch.regex}
              onclick={() => editorSearch.toggleRegex()}
              title="Use Regular Expression"
              aria-label="Use Regular Expression"
              aria-pressed={editorSearch.regex}
            >
              .*
            </button>
          </div>
        </div>

        <button
          type="button"
          class="action-btn"
          onclick={() => { editorSearch.prev(); searchInput?.focus(); }}
          disabled={!editorSearch.query || editorSearch.totalMatches === 0}
          title="Previous Match (Shift+Enter)"
          aria-label="Previous Match"
        >
          <ArrowUp class="size-3.5" />
        </button>
        <button
          type="button"
          class="action-btn"
          onclick={() => { editorSearch.next(); searchInput?.focus(); }}
          disabled={!editorSearch.query || editorSearch.totalMatches === 0}
          title="Next Match (Enter)"
          aria-label="Next Match"
        >
          <ArrowDown class="size-3.5" />
        </button>
        <button
          type="button"
          class="action-btn"
          onclick={() => editorSearch.closePanel()}
          title="Close (Escape)"
          aria-label="Close"
        >
          <X class="size-3.5" />
        </button>
      </div>

      {#if editorSearch.replaceVisible}
        <div class="flex items-center gap-1">
          <div
            class="input-wrap flex h-6 items-center rounded border border-input bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50"
          >
            <input
              bind:this={replaceInput}
              type="text"
              placeholder="Replace"
              value={editorSearch.replace}
              oninput={(e) =>
                editorSearch.setReplace((e.target as HTMLInputElement).value)}
              onkeydown={onReplaceKey}
              class="h-full w-56 bg-transparent px-2 text-xs outline-none"
              spellcheck="false"
              aria-label="Replace"
            />
          </div>
          <button
            type="button"
            class="action-btn"
            onclick={() => editorSearch.replaceCurrent()}
            disabled={!editorSearch.query || editorSearch.totalMatches === 0}
            title="Replace (Enter)"
            aria-label="Replace"
          >
            <ArrowsClockwise class="size-3.5" />
          </button>
          <button
            type="button"
            class="action-btn"
            onclick={() => editorSearch.replaceAllMatches()}
            disabled={!editorSearch.query || editorSearch.totalMatches === 0}
            title="Replace All (Ctrl+Enter)"
            aria-label="Replace All"
          >
            <Repeat class="size-3.5" />
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .search-panel {
    min-width: max-content;
  }

  .opt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1.125rem;
    min-width: 1.25rem;
    padding: 0 0.25rem;
    font-size: 10.5px;
    font-family: var(--font-mono, monospace);
    line-height: 1;
    border-radius: 2px;
    color: var(--muted-foreground);
    transition: background-color 120ms, color 120ms;
  }

  .opt-btn:hover {
    background-color: color-mix(in srgb, var(--accent) 60%, transparent);
    color: var(--accent-foreground);
  }

  .opt-btn.active {
    background-color: color-mix(in srgb, var(--primary) 18%, transparent);
    color: var(--primary);
    box-shadow: inset 0 0 0 1px
      color-mix(in srgb, var(--primary) 35%, transparent);
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    height: 1.5rem;
    width: 1.5rem;
    border-radius: 3px;
    color: var(--foreground);
    transition: background-color 120ms;
  }

  .action-btn:hover:not(:disabled) {
    background-color: var(--accent);
    color: var(--accent-foreground);
  }

  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
