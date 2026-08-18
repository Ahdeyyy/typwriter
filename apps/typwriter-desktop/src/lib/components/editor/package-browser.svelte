<script lang="ts">
  // Browse the Typst Universe registry and insert an import.
  //
  // The index was already being fetched and cached for autocomplete; this makes
  // it browsable. Searching by description is the point — nobody knows the
  // package is called `cetz` when what they want is "draw a diagram".

  import { tick } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Search01Icon, PackageIcon } from "@hugeicons/core-free-icons";

  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { fuzzyRank, fuzzySegments } from "$lib/fuzzy";
  import { listPackages } from "$lib/ipc/commands";
  import { importLineFor } from "$lib/packages";
  import type { PackageEntry } from "$lib/types";
  import { logError } from "$lib/logger";

  let query = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);
  let selected = $state(0);

  let packages = $state<PackageEntry[]>([]);
  let loading = $state(false);
  let loaded = false;

  $effect(() => {
    if (!ui.packageBrowserOpen) return;
    query = "";
    selected = 0;
    void tick().then(() => inputEl?.focus());

    // Fetched once per session. The Rust side caches the index for the app
    // lifetime, so a second call would be cheap anyway — this just avoids the
    // round-trip and the loading flash.
    if (loaded) return;
    loading = true;
    void listPackages().match(
      (entries) => {
        packages = entries;
        loaded = true;
        loading = false;
      },
      (err) => {
        logError("package browser: listing failed:", err);
        loading = false;
      },
    );
  });

  const matches = $derived(
    fuzzyRank(
      packages,
      query,
      (entry) => entry.name,
      // Searching what a package *does* matters more than its name here.
      (entry) => entry.description ?? "",
    ).slice(0, 100),
  );

  // Re-ranking invalidates the old index.
  $effect(() => {
    query;
    selected = 0;
  });

  function scrollSelectedIntoView() {
    listEl?.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function move(delta: number) {
    if (matches.length === 0) return;
    selected = (((selected + delta) % matches.length) + matches.length) % matches.length;
    void tick().then(scrollSelectedIntoView);
  }

  function insert(entry: PackageEntry) {
    const view = editorSearch.getActiveView();
    ui.packageBrowserOpen = false;
    if (!view) return;

    const line = importLineFor(entry.namespace, entry.name, entry.version);
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert: line },
      selection: { anchor: pos + line.length },
    });
    view.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter": {
        event.preventDefault();
        const entry = matches[selected]?.item;
        if (entry) insert(entry);
        break;
      }
      case "Escape":
        event.preventDefault();
        ui.packageBrowserOpen = false;
        break;
    }
  }
</script>

{#if ui.packageBrowserOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex justify-center bg-black/40 backdrop-blur-[2px]"
    onclick={(event) => {
      if (event.target === event.currentTarget) ui.packageBrowserOpen = false;
    }}
    {onkeydown}
    role="presentation"
  >
    <div
      class="bg-popover text-popover-foreground mt-[12vh] flex h-fit max-h-[70vh] w-full
             max-w-2xl flex-col overflow-hidden rounded-xl shadow-2xl"
    >
      <div class="flex items-center gap-2 px-4 py-3">
        <HugeiconsIcon icon={Search01Icon} class="size-4 shrink-0 opacity-50" />
        <input
          bind:this={inputEl}
          bind:value={query}
          class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder="Search packages by name or what they do…"
          spellcheck="false"
          autocomplete="off"
        />
        <kbd class="text-muted-foreground shrink-0 text-[10px] tabular-nums">
          {matches.length}
        </kbd>
      </div>

      <div bind:this={listEl} class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {#if loading}
          <p class="text-muted-foreground px-2 py-8 text-center text-sm">Loading the registry…</p>
        {:else if packages.length === 0}
          <p class="text-muted-foreground px-2 py-8 text-center text-sm">
            The package index could not be fetched. Check your connection and reopen.
          </p>
        {:else if matches.length === 0}
          <p class="text-muted-foreground px-2 py-8 text-center text-sm">No packages match.</p>
        {:else}
          {#each matches as { item, match }, index (item.namespace + "/" + item.name)}
            <button
              type="button"
              data-row={index}
              class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left
                     {index === selected ? 'bg-accent text-accent-foreground' : ''}"
              onclick={() => insert(item)}
              onmousemove={() => (selected = index)}
            >
              <span class="flex items-baseline gap-2">
                <HugeiconsIcon icon={PackageIcon} class="size-3.5 shrink-0 opacity-50" />
                <span class="truncate font-mono text-sm">
                  {#each fuzzySegments(item.name, match.positions) as segment, segmentIndex (segmentIndex)}
                    <span class={segment.hit ? "font-semibold underline" : ""}>{segment.text}</span>
                  {/each}
                </span>
                <span class="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                  {item.version}
                </span>
              </span>
              {#if item.description}
                <span class="text-muted-foreground truncate pl-5 text-xs">
                  {item.description}
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <div class="text-muted-foreground bg-muted/40 flex items-center gap-3 px-4 py-2 text-[10px]">
        <span><kbd class="font-semibold">↑↓</kbd> navigate</span>
        <span><kbd class="font-semibold">↵</kbd> insert import</span>
        <span><kbd class="font-semibold">esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}
