<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowUp01Icon, ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, RotateClockwiseIcon, ReplaceAllIcon } from "@hugeicons/core-free-icons";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
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
    const total = editorSearch.totalMatchesCapped
      ? `${editorSearch.totalMatches}+`
      : `${editorSearch.totalMatches}`;
    return `${editorSearch.currentMatch || "?"} of ${total}`;
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
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            class="toggle-btn mt-[2px] size-5 shrink-0 rounded p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onclick={() => editorSearch.toggleReplace()}
            aria-label={editorSearch.replaceVisible
              ? "Toggle Replace"
              : "Toggle Replace"}
          >
            {#if editorSearch.replaceVisible}
              <HugeiconsIcon icon={ArrowDown01Icon} class="size-3" />
            {:else}
              <HugeiconsIcon icon={ArrowRight01Icon} class="size-3" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>{editorSearch.replaceVisible ? "Hide Replace" : "Show Replace"}</Tooltip.Content>
    </Tooltip.Root>

    <div class="flex flex-col gap-1">
      <!-- Search row -->
      <div class="flex items-center gap-1">
        <div
          class="input-wrap flex h-8 items-center rounded border border-input bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50"
          class:!border-destructive={editorSearch.regexError || noResults}
        >
          <input
            bind:this={searchInput}
            type="text"
            placeholder="Find"
            bind:value={editorSearch.query}
            oninput={() => editorSearch.applyQuery()}
            onkeydown={onSearchKey}
            class="h-full w-80 bg-transparent px-2.5 text-sm outline-none"
            spellcheck="false"
            aria-label="Find"
          />
          <span
            class="counter shrink-0 px-1.5 text-[11px] tabular-nums text-muted-foreground select-none"
          >
            {counterText}
          </span>
          <div class="flex items-center gap-px pr-0.5">
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    class="opt-btn {editorSearch.caseSensitive ? 'active' : ''}"
                    onclick={() => editorSearch.toggleCaseSensitive()}
                    aria-label="Match Case"
                    aria-pressed={editorSearch.caseSensitive}
                  >
                    Aa
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Match Case</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    class="opt-btn {editorSearch.wholeWord ? 'active' : ''}"
                    onclick={() => editorSearch.toggleWholeWord()}
                    aria-label="Match Whole Word"
                    aria-pressed={editorSearch.wholeWord}
                  >
                    <span class="underline">ab</span>
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Match Whole Word</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    class="opt-btn {editorSearch.regex ? 'active' : ''}"
                    onclick={() => editorSearch.toggleRegex()}
                    aria-label="Use Regular Expression"
                    aria-pressed={editorSearch.regex}
                  >
                    .*
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Use Regular Expression</Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>

        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                class="action-btn"
                onclick={() => { editorSearch.prev(); searchInput?.focus(); }}
                disabled={!editorSearch.query || editorSearch.totalMatches === 0}
                aria-label="Previous Match"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} class="size-3" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Previous Match (Shift+Enter)</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                class="action-btn"
                onclick={() => { editorSearch.next(); searchInput?.focus(); }}
                disabled={!editorSearch.query || editorSearch.totalMatches === 0}
                aria-label="Next Match"
              >
                <HugeiconsIcon icon={ArrowDown01Icon} class="size-3" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Next Match (Enter)</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                class="action-btn"
                onclick={() => editorSearch.closePanel()}
                aria-label="Close"
              >
                <HugeiconsIcon icon={Cancel01Icon} class="size-3" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Close (Escape)</Tooltip.Content>
        </Tooltip.Root>
      </div>

      {#if editorSearch.replaceVisible}
        <div class="flex items-center gap-1">
          <div
            class="input-wrap flex h-8 items-center rounded border border-input bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50"
          >
            <input
              bind:this={replaceInput}
              type="text"
              placeholder="Replace"
              value={editorSearch.replace}
              oninput={(e) =>
                editorSearch.setReplace((e.target as HTMLInputElement).value)}
              onkeydown={onReplaceKey}
              class="h-full w-80 bg-transparent px-2.5 text-sm outline-none"
              spellcheck="false"
              aria-label="Replace"
            />
          </div>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  class="action-btn"
                  onclick={() => editorSearch.replaceCurrent()}
                  disabled={!editorSearch.query || editorSearch.totalMatches === 0}
                  aria-label="Replace"
                >
                  <HugeiconsIcon icon={RotateClockwiseIcon} class="size-3" />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>Replace (Enter)</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  class="action-btn"
                  onclick={() => editorSearch.replaceAllMatches()}
                  disabled={!editorSearch.query || editorSearch.totalMatches === 0}
                  aria-label="Replace All"
                >
                  <HugeiconsIcon icon={ReplaceAllIcon} class="size-3" />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>Replace All (Ctrl+Enter)</Tooltip.Content>
          </Tooltip.Root>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .search-panel {
    min-width: max-content;
  }

  :global(.opt-btn) {
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

  :global(.opt-btn:hover) {
    background-color: color-mix(in srgb, var(--accent) 60%, transparent);
    color: var(--accent-foreground);
  }

  :global(.opt-btn.active),
  :global(.opt-btn.active:hover) {
    background-color: color-mix(in srgb, var(--accent) 60%, transparent);
    color: var(--accent-foreground);
  }

  :global(.action-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    height: 1.25rem;
    width: 1.25rem;
    border-radius: 3px;
    color: var(--foreground);
    transition: background-color 120ms;
  }

  :global(.action-btn:hover:not(:disabled)) {
    background-color: var(--accent);
    color: var(--accent-foreground);
  }

  :global(.action-btn:disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
