<script lang="ts">
  // Project-wide search and replace.
  //
  // The editor's find panel is per-buffer. In a multi-file project — chapters,
  // includes, a shared template — "rename this label everywhere" is a daily
  // need it cannot answer.

  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Cancel01Icon,
    ArrowDown01Icon,
    ArrowRight01Icon,
    Alert01Icon,
  } from "@hugeicons/core-free-icons";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { searchWorkspace, replaceInWorkspace } from "$lib/ipc/commands";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { groupHits } from "$lib/search-results";
  import type { SearchHit, SearchQuery } from "$lib/types";
  import { logError } from "$lib/logger";
  import { toast } from "svelte-sonner";

  interface Props {
    onclose?: () => void;
  }

  let { onclose }: Props = $props();

  let query = $state("");
  let replacement = $state("");
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let regex = $state(false);
  let showReplace = $state(false);

  let hits = $state<SearchHit[]>([]);
  let filesSearched = $state(0);
  let truncated = $state(false);
  let searching = $state(false);
  let error = $state<string | null>(null);
  let collapsed = $state(new Set<string>());

  /** Bumped per request so a slow earlier search cannot overwrite a newer one. */
  let requestId = 0;

  const groups = $derived(groupHits(hits));

  function currentQuery(): SearchQuery {
    return { query, caseSensitive, wholeWord, regex, extensions: [] };
  }

  async function run() {
    const text = query.trim();
    if (!text || !workspace.rootPath) {
      hits = [];
      error = null;
      return;
    }

    const id = ++requestId;
    searching = true;
    error = null;

    const result = await searchWorkspace(currentQuery());
    if (id !== requestId) return; // a newer search already answered

    result.match(
      (results) => {
        hits = results.hits;
        filesSearched = results.filesSearched;
        truncated = results.truncated;
      },
      (err) => {
        // An invalid regex is the common case here and is the user's to fix,
        // so it is shown in place rather than logged and swallowed.
        error = err;
        hits = [];
      },
    );
    searching = false;
  }

  // Debounced: typing a query should not fire a workspace walk per keystroke.
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    query;
    caseSensitive;
    wholeWord;
    regex;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), 250);
    return () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
  });

  function toggleGroup(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function open(hit: SearchHit) {
    workspace
      .openFile(hit.path)
      .map(() => editor.requestCursorJump(hit.path, hit.offset))
      .mapErr((err) => logError("search: opening hit failed:", err));
  }

  async function replaceAll() {
    if (!query.trim() || hits.length === 0) return;

    const result = await replaceInWorkspace(currentQuery(), replacement);
    result.match(
      (outcome) => {
        toast.success(
          `Replaced ${outcome.replacements} in ${outcome.filesChanged} file(s)`,
          {
            description: outcome.restorePoint
              ? "A restore point was created first — undo it from History."
              : undefined,
          },
        );
        // Buffers still hold the pre-replace text, so reload before re-running.
        void editor.reloadAllTabsFromDisk().then(() => run());
      },
      (err) => {
        logError("search: replace failed:", err);
        toast.error(`Replace failed: ${err}`);
      },
    );
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center justify-between px-2 py-1.5">
    <span class="text-xs font-semibold">Search</span>
    {#if onclose}
      <Button variant="ghost" size="icon-sm" onclick={onclose}>
        <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
      </Button>
    {/if}
  </div>

  <div class="space-y-1.5 px-2 pb-2">
    <div class="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        title={showReplace ? "Hide replace" : "Show replace"}
        onclick={() => (showReplace = !showReplace)}
      >
        <HugeiconsIcon
          icon={showReplace ? ArrowDown01Icon : ArrowRight01Icon}
          class="size-3.5"
        />
      </Button>
      <Input
        bind:value={query}
        placeholder="Search the project…"
        spellcheck="false"
        class="h-7 flex-1 text-xs"
      />
    </div>

    {#if showReplace}
      <div class="flex items-center gap-1 pl-7">
        <Input
          bind:value={replacement}
          placeholder="Replace with…"
          spellcheck="false"
          class="h-7 flex-1 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          class="h-7 shrink-0 text-xs"
          disabled={hits.length === 0 || searching}
          onclick={replaceAll}
        >
          All
        </Button>
      </div>
    {/if}

    <div class="flex items-center gap-1 pl-7">
      <Button
        variant={caseSensitive ? "default" : "ghost"}
        size="icon-sm"
        title="Match case"
        onclick={() => (caseSensitive = !caseSensitive)}
      >
        <span class="text-[10px] font-semibold">Aa</span>
      </Button>
      <Button
        variant={wholeWord ? "default" : "ghost"}
        size="icon-sm"
        title="Whole word"
        onclick={() => (wholeWord = !wholeWord)}
      >
        <span class="text-[10px] font-semibold underline">ab</span>
      </Button>
      <Button
        variant={regex ? "default" : "ghost"}
        size="icon-sm"
        title="Regular expression"
        onclick={() => (regex = !regex)}
      >
        <span class="text-[10px] font-semibold">.*</span>
      </Button>

      <span class="text-muted-foreground ml-auto text-[10px] tabular-nums">
        {#if searching}
          searching…
        {:else if hits.length > 0}
          {hits.length}{truncated ? "+" : ""} in {groups.length} file{groups.length === 1
            ? ""
            : "s"}
        {/if}
      </span>
    </div>
  </div>

  {#if error}
    <div class="mx-2 mb-2 flex items-start gap-1.5 rounded bg-destructive/10 p-2 text-[11px]">
      <HugeiconsIcon icon={Alert01Icon} class="text-destructive mt-0.5 size-3 shrink-0" />
      <span class="min-w-0 break-words">{error}</span>
    </div>
  {/if}

  {#if !workspace.rootPath}
    <p class="text-muted-foreground px-3 py-6 text-center text-xs">
      Open a workspace to search it.
    </p>
  {:else if !searching && query.trim() && hits.length === 0 && !error}
    <p class="text-muted-foreground px-3 py-6 text-center text-xs">
      No matches in {filesSearched} file{filesSearched === 1 ? "" : "s"}.
    </p>
  {:else}
    <ScrollArea class="min-h-0 flex-1">
      <div class="px-1 pb-2">
        {#each groups as group (group.path)}
          {@const isCollapsed = collapsed.has(group.path)}
          <button
            type="button"
            class="hover:bg-sidebar-accent flex w-full items-center gap-1 rounded px-1.5 py-1
                   text-left text-xs"
            onclick={() => toggleGroup(group.path)}
          >
            <HugeiconsIcon
              icon={isCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
              class="size-3 shrink-0 opacity-60"
            />
            <span class="truncate font-medium">{group.name}</span>
            <span class="text-muted-foreground truncate text-[10px]">{group.dir}</span>
            <span class="text-muted-foreground ml-auto shrink-0 text-[10px] tabular-nums">
              {group.hits.length}
            </span>
          </button>

          {#if !isCollapsed}
            {#each group.hits as hit, hitIndex (hitIndex)}
              <button
                type="button"
                class="hover:bg-sidebar-accent flex w-full items-baseline gap-1.5 rounded
                       py-0.5 pl-6 pr-1.5 text-left"
                onclick={() => open(hit)}
              >
                <span class="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                  {hit.line}
                </span>
                <span class="truncate font-mono text-[11px]">
                  {hit.preview.slice(0, hit.matchStart)}<mark
                    class="bg-yellow-400/40 text-inherit">{hit.preview.slice(
                      hit.matchStart,
                      hit.matchEnd,
                    )}</mark
                  >{hit.preview.slice(hit.matchEnd)}
                </span>
              </button>
            {/each}
          {/if}
        {/each}

        {#if truncated}
          <p class="text-muted-foreground px-2 py-2 text-center text-[10px]">
            Showing the first {hits.length} matches. Narrow the search to see the rest.
          </p>
        {/if}
      </div>
    </ScrollArea>
  {/if}
</div>
