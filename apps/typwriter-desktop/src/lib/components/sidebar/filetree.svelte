<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowUpDownIcon, FilePlusIcon, FolderAddIcon, Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
  import { ChevronsDownUp } from "@lucide/svelte";
  import { tick } from "svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
  import { workspace, basename } from "$lib/stores/workspace.svelte";
  import TreeNode from "./tree-node.svelte";
  import { toast } from "svelte-sonner";

  // ─── Context-menu action deferral ──────────────────────────────────────────

  let pendingAction = $state<(() => void) | null>(null);

  function onMenuOpenChange(open: boolean) {
    if (!open && pendingAction) {
      const action = pendingAction;
      pendingAction = null;
      requestAnimationFrame(() => action());
    }
  }

  // ─── Blur guard ────────────────────────────────────────────────────────────
  // After an input is focused, ignore blur events for a short grace period
  // to prevent bits-ui's focus restoration from cancelling the operation.

  let blurGuardUntil = $state(0);

  // ─── Root-level create ───────────────────────────────────────────────────────

  let creatingRoot = $state<"file" | "folder" | null>(null);
  let newRootName = $state("");
  let rootCreateInputEl = $state<HTMLInputElement | null>(null);

  async function startRootCreate(kind: "file" | "folder") {
    creatingRoot = kind;
    newRootName = "";
    await tick();
    blurGuardUntil = Date.now() + 80;
    rootCreateInputEl?.focus();
  }

  async function commitRootCreate() {
    const name = newRootName.trim();
    const kind = creatingRoot;
    creatingRoot = null;
    if (!name || !workspace.rootPath || !kind) return;
    const path = name;
    const result = await (kind === "folder"
      ? workspace.createFolderAction(path)
      : workspace.createFileAction(path));
    result.mapErr(err => toast.error(`Create failed: ${err}`));
  }

  function cancelRootCreate() {
    if (Date.now() < blurGuardUntil) return;
    creatingRoot = null;
    newRootName = "";
  }

  function handleRootCreateKey(e: KeyboardEvent) {
    if (e.key === "Enter")  { e.preventDefault(); commitRootCreate(); }
    if (e.key === "Escape") { e.preventDefault(); cancelRootCreate(); }
  }

  // ─── Import files ──────────────────────────────────────────────────────────

  async function handleImportFiles() {
    if (!workspace.rootPath) return;
    try {
      await workspace.importFilesAction(workspace.rootPath);
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    }
  }

  // ─── Root drop target ─────────────────────────────────────────────────────

  let rootDropTarget = $state(false);
  let rootDragEnterCount = 0;

  function onRootDragEnter(e: DragEvent) {
    e.preventDefault();
    rootDragEnterCount++;
    if (rootDragEnterCount === 1) rootDropTarget = true;
  }

  function onRootDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer && (e.dataTransfer.dropEffect = "move");
  }

  function onRootDragLeave() {
    rootDragEnterCount--;
    if (rootDragEnterCount <= 0) {
      rootDragEnterCount = 0;
      rootDropTarget = false;
    }
  }

  async function onRootDrop(e: DragEvent) {
    e.preventDefault();
    rootDragEnterCount = 0;
    rootDropTarget = false;
    const src = workspace.dragSrcPath;
    workspace.dragSrcPath = null;
    if (!src || !workspace.rootPath) return;
    // Already at root (relative path has no directory separator)
    if (!src.includes('/')) return;
    const dst = basename(src);
    const srcIsDir = findIsDir(src);
    const result = await workspace.moveAction(src, dst, srcIsDir);
    result.mapErr(err => toast.error(`Move failed: ${err}`));
  }

  function findIsDir(path: string): boolean {
    function walk(nodes: typeof workspace.tree): boolean {
      for (const n of nodes) {
        if (n.path === path) return n.is_dir;
        if (n.is_dir && walk(n.children)) return true;
      }
      return false;
    }
    return walk(workspace.tree);
  }
</script>

<!-- ─── Toolbar ─────────────────────────────────────────────────────────────── -->
<div class="flex h-8 shrink-0 items-center justify-between border-b border-sidebar-border px-1">
  <div class="flex items-center gap-0 shrink-0">
    <Button
      variant="ghost"
      size="icon-sm"
      title={workspace.anyFolderExpanded ? "Collapse all" : "Expand all"}
      onclick={() => workspace.anyFolderExpanded ? workspace.collapseAll() : workspace.expandAll()}
    >
      {#if workspace.anyFolderExpanded}
        <ChevronsDownUp class="size-3.5" />
      {:else}
        <HugeiconsIcon icon={ArrowUpDownIcon} class="size-3.5" />
      {/if}
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      title="New file"
      onclick={() => startRootCreate("file")}
    >
      <HugeiconsIcon icon={FilePlusIcon} class="size-3.5" />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      title="New folder"
      onclick={() => startRootCreate("folder")}
    >
      <HugeiconsIcon icon={FolderAddIcon} class="size-3.5" />
    </Button>
  </div>
</div>

<!-- ─── Search bar ─────────────────────────────────────────────────────────── -->
<div class="shrink-0 border-b border-sidebar-border px-2 py-1.5">
  <div class="relative">
    <HugeiconsIcon icon={Search01Icon} class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
    <Input
      class="h-6 pl-6 pr-6 text-xs"
      placeholder="Search files…"
      bind:value={workspace.searchQuery}
    />
    {#if workspace.searchQuery}
      <button
        class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onclick={() => (workspace.searchQuery = "")}
        aria-label="Clear search"
      >
        <HugeiconsIcon icon={Cancel01Icon} class="size-3" />
      </button>
    {/if}
  </div>
</div>

<!-- ─── Root drop zone ─────────────────────────────────────────────────────── -->
<div
  class="relative flex-1 min-h-0 overflow-y-auto px-2"
  ondragenter={onRootDragEnter}
  ondragover={onRootDragOver}
  ondragleave={onRootDragLeave}
  ondrop={onRootDrop}
>
  {#if rootDropTarget}
    <div class="pointer-events-none absolute inset-0 z-10 rounded-sm bg-sidebar-primary/5"></div>
  {/if}
  <!-- Root-level context menu (empty area) -->
  <ContextMenu.Root onOpenChange={onMenuOpenChange}>
    <ContextMenu.Trigger class="block min-h-full">
      <div
        role="presentation"
        class="py-1"
        aria-label="File explorer"
      >
        <!-- Root-level create input -->
        {#if creatingRoot}
          <div class="flex items-center gap-1 px-2 py-0.5">
            <input
              bind:this={rootCreateInputEl}
              class="h-5 flex-1 rounded border border-input bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              placeholder={creatingRoot === "folder" ? "folder-name" : "file.typ"}
              bind:value={newRootName}
              onkeydown={handleRootCreateKey}
              onblur={cancelRootCreate}
            />
          </div>
        {/if}

        {#if workspace.filteredTree.length === 0 && !workspace.searchQuery}
          <p class="px-3 py-4 text-xs text-muted-foreground">
            No files in workspace.
          </p>
        {:else if workspace.filteredTree.length === 0}
          <p class="px-3 py-4 text-xs text-muted-foreground">
            No files match "{workspace.searchQuery}".
          </p>
        {:else}
          {#each workspace.filteredTree as node (node.path)}
            <TreeNode {node} depth={0} />
          {/each}
        {/if}
      </div>
    </ContextMenu.Trigger>

    <ContextMenu.Content>
      <ContextMenu.Item onclick={() => { pendingAction = () => startRootCreate("file"); }}>
        New File
      </ContextMenu.Item>
      <ContextMenu.Item onclick={() => { pendingAction = () => startRootCreate("folder"); }}>
        New Folder
      </ContextMenu.Item>
      <ContextMenu.Item onclick={handleImportFiles}>
        Import Files…
      </ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Root>
</div>
