<script lang="ts">
  // The command palette: one overlay, three lists.
  //
  // The mode is derived from a prefix character in the input rather than being
  // separate UI, so a user who opened the file list can reach the command list
  // by typing `>` without closing anything — the same muscle memory VS Code and
  // Obsidian train. `ui.paletteMode` only decides which prefix we seed.

  import { tick } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    File01Icon,
    CommandIcon,
    Heading01Icon,
    Search01Icon,
  } from "@hugeicons/core-free-icons";

  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace, type FileNode } from "$lib/stores/workspace.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { shortcutLabel } from "$lib/keybindings";
  import { fuzzySegments } from "$lib/fuzzy";
  import { extractOutline } from "$lib/outline";
  import { buildCommands, type CommandContext } from "$lib/commands/registry";
  import {
    buildRows,
    groupOf,
    moveSelection,
    parseQuery,
    rowEnabled,
    seedFor,
    MAX_ROWS,
    type PaletteRow,
  } from "$lib/commands/palette-model";
  import { logError } from "$lib/logger";

  interface Props {
    /** Everything except `toggleSidebar`, which this component supplies —
     *  `useSidebar()` only resolves inside the provider, and the provider is
     *  rendered by our parent, so the parent cannot read it. */
    ctx: Omit<CommandContext, "toggleSidebar">;
  }

  let { ctx: hostCtx }: Props = $props();

  const sidebarCtx = Sidebar.useSidebar();
  const ctx = $derived<CommandContext>({
    ...hostCtx,
    toggleSidebar: () => sidebarCtx.setOpen(!sidebarCtx.open),
  });

  let query = $state("");
  let selected = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  // ── Mode ──────────────────────────────────────────────────────────────────

  const parsed = $derived(parseQuery(query));
  const mode = $derived(parsed.mode);
  const term = $derived(parsed.term);

  const PLACEHOLDERS = {
    files: "Search files by name…",
    commands: "Search commands…",
    outline: "Search headings in this file…",
  } as const;

  const MODE_ICONS = {
    files: File01Icon,
    commands: CommandIcon,
    outline: Heading01Icon,
  } as const;

  // ── Sources ───────────────────────────────────────────────────────────────

  function flattenFiles(nodes: readonly FileNode[], out: FileNode[] = []): FileNode[] {
    for (const node of nodes) {
      if (node.is_dir) flattenFiles(node.children, out);
      else out.push(node);
    }
    return out;
  }

  // Each of these is only read while its mode is active, and `$derived` is
  // lazy — so the outline is not re-parsed while the file list is showing.
  const files = $derived(
    flattenFiles(workspace.tree).map((node) => ({ name: node.name, path: node.path })),
  );
  const commands = $derived(buildCommands(ctx));
  const outline = $derived(
    editor.activeTab?.viewMode === "text" ? extractOutline(editor.activeTab.content) : [],
  );

  const rows = $derived(buildRows(mode, term, { files, commands, outline }));

  /** Group headers, but only in command mode — files and headings are ranked
   *  purely by score, and grouping them would fight the ranking. */
  const showGroups = $derived(mode === "commands");

  // ── Selection ─────────────────────────────────────────────────────────────

  // Any change to the query re-ranks the list, so the old index points at an
  // unrelated row. Reset rather than clamp.
  $effect(() => {
    query;
    selected = 0;
  });

  $effect(() => {
    if (ui.paletteOpen) {
      query = seedFor(ui.paletteMode);
      selected = 0;
      void tick().then(() => {
        inputEl?.focus();
        // Put the caret after the prefix so typing continues the query.
        inputEl?.setSelectionRange(query.length, query.length);
      });
    }
  });

  function move(delta: number) {
    if (rows.length === 0) return;
    selected = moveSelection(selected, delta, rows.length);
    void tick().then(scrollSelectedIntoView);
  }

  function scrollSelectedIntoView() {
    listEl?.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // ── Running ───────────────────────────────────────────────────────────────

  function run(row: PaletteRow) {
    if (!rowEnabled(row)) return;

    // Close first: a command that opens the palette again in another mode
    // (`Go to file…`) must not be undone by this close.
    ui.closePalette();

    if (row.kind === "file") {
      workspace.openFile(row.path).mapErr((err) => logError("palette open file failed:", err));
      return;
    }
    if (row.kind === "outline") {
      const tabId = editor.activeTabId;
      if (tabId) editor.requestCursorJump(tabId, row.item.from);
      return;
    }
    void row.command.run();
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
      case "PageDown":
        event.preventDefault();
        move(10);
        break;
      case "PageUp":
        event.preventDefault();
        move(-10);
        break;
      case "Home":
        event.preventDefault();
        selected = 0;
        void tick().then(scrollSelectedIntoView);
        break;
      case "End":
        event.preventDefault();
        selected = Math.max(rows.length - 1, 0);
        void tick().then(scrollSelectedIntoView);
        break;
      case "Enter": {
        event.preventDefault();
        const row = rows[selected];
        if (row) run(row);
        break;
      }
      case "Escape":
        event.preventDefault();
        ui.closePalette();
        break;
    }
  }
</script>

{#if ui.paletteOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex justify-center bg-black/40 backdrop-blur-[2px]"
    onclick={(event) => {
      if (event.target === event.currentTarget) ui.closePalette();
    }}
    onkeydown={onkeydown}
    role="presentation"
  >
    <div
      class="bg-popover text-popover-foreground mt-[12vh] flex h-fit max-h-[70vh] w-full
             max-w-2xl flex-col overflow-hidden rounded-xl shadow-2xl"
    >
      <!-- Input -->
      <div class="flex items-center gap-2 px-4 py-3">
        <HugeiconsIcon icon={MODE_ICONS[mode]} class="size-4 shrink-0 opacity-50" />
        <input
          bind:this={inputEl}
          bind:value={query}
          class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm
                 outline-none"
          placeholder={PLACEHOLDERS[mode]}
          spellcheck="false"
          autocomplete="off"
        />
        <kbd class="text-muted-foreground shrink-0 text-[10px] tabular-nums">
          {rows.length}{rows.length === MAX_ROWS ? "+" : ""}
        </kbd>
      </div>

      <!-- Results -->
      <div bind:this={listEl} class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {#if rows.length === 0}
          <div class="text-muted-foreground px-2 py-8 text-center text-sm">
            {#if mode === "outline" && outline.length === 0}
              This file has no headings.
            {:else}
              No matches.
            {/if}
          </div>
        {:else}
          {#each rows as row, index (index)}
            {@const enabled = rowEnabled(row)}
            {@const group = groupOf(row)}
            {@const newGroup = showGroups && group !== groupOf(rows[index - 1] ?? row)}

            {#if showGroups && (index === 0 || newGroup)}
              <div
                class="text-muted-foreground px-2 pb-1 pt-3 text-[10px] font-semibold
                       uppercase tracking-wider first:pt-1"
              >
                {group}
              </div>
            {/if}

            <button
              type="button"
              data-row={index}
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm
                     {index === selected ? 'bg-accent text-accent-foreground' : ''}
                     {enabled ? '' : 'opacity-40'}"
              disabled={!enabled}
              onclick={() => run(row)}
              onmousemove={() => (selected = index)}
            >
              {#if row.kind === "file"}
                <HugeiconsIcon icon={File01Icon} class="size-4 shrink-0 opacity-50" />
                <span class="truncate">
                  {#each fuzzySegments(row.name, row.match.positions) as segment, segmentIndex (segmentIndex)}
                    <span class={segment.hit ? "font-semibold underline" : ""}
                      >{segment.text}</span
                    >
                  {/each}
                </span>
                {#if row.dir}
                  <span class="text-muted-foreground truncate text-xs">{row.dir}</span>
                {/if}
              {:else if row.kind === "outline"}
                <span
                  class="text-muted-foreground w-6 shrink-0 text-right text-[10px] tabular-nums"
                >
                  H{row.item.level}
                </span>
                <span class="truncate" style="padding-left: {(row.item.level - 1) * 12}px">
                  {#each fuzzySegments(row.item.title, row.match.positions) as segment, segmentIndex (segmentIndex)}
                    <span class={segment.hit ? "font-semibold underline" : ""}
                      >{segment.text}</span
                    >
                  {/each}
                </span>
                <span class="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {row.item.line}
                </span>
              {:else}
                <HugeiconsIcon icon={Search01Icon} class="size-4 shrink-0 opacity-0" />
                <span class="truncate">
                  {#each fuzzySegments(row.command.title, row.match.positions) as segment, segmentIndex (segmentIndex)}
                    <span class={segment.hit ? "font-semibold underline" : ""}
                      >{segment.text}</span
                    >
                  {/each}
                </span>
                {#if row.command.shortcut}
                  {@const label = shortcutLabel(row.command.shortcut)}
                  {#if label}
                    <kbd
                      class="bg-muted text-muted-foreground ml-auto shrink-0 rounded px-1.5
                             py-0.5 text-[10px]"
                    >
                      {label}
                    </kbd>
                  {/if}
                {/if}
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <!-- Mode hints -->
      <div
        class="text-muted-foreground bg-muted/40 flex items-center gap-3 px-4 py-2 text-[10px]"
      >
        <span><kbd class="font-semibold">↑↓</kbd> navigate</span>
        <span><kbd class="font-semibold">↵</kbd> select</span>
        <span><kbd class="font-semibold">esc</kbd> close</span>
        <span class="ml-auto">
          <kbd class="font-semibold">&gt;</kbd> commands · <kbd class="font-semibold">@</kbd>
          headings
        </span>
      </div>
    </div>
  </div>
{/if}
