<script lang="ts">
  // Browse the Typst Universe registry and insert an import.
  //
  // The index was already being fetched and cached for autocomplete; this makes
  // it browsable. Searching by description is the point — nobody knows the
  // package is called `cetz` when what they want is "draw a diagram".

  import { tick } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Search01Icon, PackageIcon, FolderAddIcon } from "@hugeicons/core-free-icons";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { toast } from "svelte-sonner";

  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { page } from "$lib/stores/page.svelte";
  import { fuzzyRank, fuzzySegments } from "$lib/fuzzy";
  import { listPackages, initPackageWorkspace } from "$lib/ipc/commands";
  import { importLineFor } from "$lib/packages";
  import type { PackageEntry } from "$lib/types";
  import { logError } from "$lib/logger";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";

  let query = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);
  let selected = $state(0);

  let filterMode = $state<"all" | "templates">("all");
  let packages = $state<PackageEntry[]>([]);
  let loading = $state(false);
  let loaded = false;

  // Initialize workspace from template state
  let initDialogOpen = $state(false);
  let targetTemplate = $state<PackageEntry | null>(null);
  let targetWorkspaceName = $state("");
  let targetParentDir = $state("");
  let targetCreating = $state(false);

  function openInitDialog(entry: PackageEntry) {
    targetTemplate = entry;
    targetWorkspaceName = entry.name;
    targetParentDir = "";
    initDialogOpen = true;
  }

  async function handleSelectTargetParent() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) {
      targetParentDir = selected as string;
    }
  }

  async function handleInitWorkspace() {
    if (!targetTemplate || targetCreating || !targetWorkspaceName.trim() || !targetParentDir) return;
    targetCreating = true;
    const spec = `@${targetTemplate.namespace}/${targetTemplate.name}:${targetTemplate.version}`;
    const res = await initPackageWorkspace(targetParentDir, targetWorkspaceName.trim(), spec);
    if (res.isErr()) {
      logError("Failed to initialize template workspace:", res.error);
      toast.error(`Failed to initialize template: ${res.error}`);
      targetCreating = false;
      return;
    }

    const newPath = res.value.workspacePath;
    targetCreating = false;
    initDialogOpen = false;
    ui.packageBrowserOpen = false;

    // Enter the newly initialized workspace
    workspace.init(newPath).match(
      () => {},
      (err) => {
        logError("Failed to open workspace:", err);
        toast.error(`Failed to open workspace: ${err}`);
        page.back("home");
      },
    );
    page.navigate("workspace");
  }

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

  const filteredPackages = $derived(
    filterMode === "templates" ? packages.filter((p) => p.isTemplate) : packages,
  );

  const matches = $derived(
    fuzzyRank(
      filteredPackages,
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
      class="modal-surface bg-popover text-popover-foreground mt-[12vh] flex h-fit max-h-[70vh] w-full
             max-w-2xl flex-col overflow-hidden rounded-xl shadow-2xl"
    >
      <div class="flex items-center gap-2 px-4 py-3">
        <HugeiconsIcon icon={Search01Icon} class="size-4 shrink-0 opacity-50" />
        <input
          bind:this={inputEl}
          bind:value={query}
          class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder={filterMode === "templates" ? "Search templates by name or description…" : "Search packages by name or what they do…"}
          spellcheck="false"
          autocomplete="off"
        />
        <div class="flex items-center gap-1 rounded-md bg-muted/60 p-0.5 text-xs">
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer {filterMode === 'all' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => { filterMode = 'all'; }}
          >
            All
          </button>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer {filterMode === 'templates' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => { filterMode = 'templates'; }}
          >
            Templates
          </button>
        </div>
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
          <p class="text-muted-foreground px-2 py-8 text-center text-sm">
            {filterMode === "templates" ? "No templates match." : "No packages match."}
          </p>
        {:else}
          {#each matches as { item, match }, index (item.namespace + "/" + item.name)}
            <button
              type="button"
              data-row={index}
              class="group/row flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left cursor-pointer
                     {index === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
              onclick={() => insert(item)}
              onmousemove={() => (selected = index)}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-baseline gap-2 min-w-0">
                  <HugeiconsIcon icon={PackageIcon} class="size-3.5 shrink-0 opacity-50" />
                  <span class="truncate font-mono text-sm">
                    {#each fuzzySegments(item.name, match.positions) as segment, segmentIndex (segmentIndex)}
                      <span class={segment.hit ? "font-semibold underline" : ""}>{segment.text}</span>
                    {/each}
                  </span>
                  <span class="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                    {item.version}
                  </span>
                  {#if item.isTemplate}
                    <span class="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary shrink-0">
                      Template
                    </span>
                  {/if}
                </span>

                {#if item.isTemplate}
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-6 px-2 text-[11px] gap-1 shrink-0 opacity-80 group-hover/row:opacity-100 hover:bg-primary hover:text-primary-foreground"
                    onclick={(e) => {
                      e.stopPropagation();
                      openInitDialog(item);
                    }}
                  >
                    <HugeiconsIcon icon={FolderAddIcon} class="size-3" />
                    Init Project
                  </Button>
                {/if}
              </div>

              {#if item.description}
                <span class="text-muted-foreground truncate pl-5 text-xs">
                  {item.description}
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <div class="text-muted-foreground bg-muted/40 flex items-center justify-between px-4 py-2 text-[10px]">
        <div class="flex items-center gap-3">
          <span><kbd class="font-semibold">↑↓</kbd> navigate</span>
          <span><kbd class="font-semibold">↵</kbd> insert import</span>
          <span><kbd class="font-semibold">esc</kbd> close</span>
        </div>
        <div>
          <span>Templates can be initialized as new projects via <kbd class="font-semibold">Init Project</kbd></span>
        </div>
      </div>
    </div>
  </div>
{/if}

<Dialog.Root bind:open={initDialogOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Initialize Project from Template</Dialog.Title>
      <Dialog.Description>
        Create a new workspace initialized from <code>{targetTemplate ? `@${targetTemplate.namespace}/${targetTemplate.name}` : ""}</code>.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-2">
      <div class="flex flex-col gap-1.5">
        <label for="init-ws-name" class="text-sm font-medium">Workspace Name</label>
        <Input
          id="init-ws-name"
          bind:value={targetWorkspaceName}
          disabled={targetCreating}
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="init-ws-loc" class="text-sm font-medium">Location</label>
        <div class="flex gap-2">
          <Input
            readonly
            id="init-ws-loc"
            value={targetParentDir}
            placeholder="Select a parent folder…"
            class="flex-1 cursor-default text-muted-foreground"
            disabled={targetCreating}
          />
          <Button
            variant="outline"
            size="sm"
            onclick={handleSelectTargetParent}
            disabled={targetCreating}
          >
            Browse
          </Button>
        </div>
        {#if targetParentDir && targetWorkspaceName.trim()}
          <p class="text-xs text-muted-foreground break-all">
            Will create: {targetParentDir}/{targetWorkspaceName.trim()}
          </p>
        {/if}
      </div>
    </div>

    <Dialog.Footer>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" disabled={targetCreating}>Cancel</Button>
        {/snippet}
      </Dialog.Close>
      <Button
        onclick={handleInitWorkspace}
        disabled={targetCreating || !targetWorkspaceName.trim() || !targetParentDir}
      >
        {targetCreating ? "Initializing…" : "Create & Open"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
