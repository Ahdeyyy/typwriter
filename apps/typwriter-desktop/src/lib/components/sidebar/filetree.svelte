<script lang="ts">
  import {
    ChevronsUpDown,
    ChevronsDownUp,
    FilePlus,
    FolderPlus,
    PanelLeft,
    Search,
    X,
  } from "@lucide/svelte";
  import { tick } from "svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
  import { workspace, basename } from "$lib/stores/workspace.svelte";
  import TreeNode from "./tree-node.svelte";
  import { toast } from "svelte-sonner";

  // ─── Props ──────────────────────────────────────────────────────────────────

  interface Props { ontoggle: () => void; }
  let { ontoggle }: Props = $props();

  // ─── Root-level create ───────────────────────────────────────────────────────

  let creatingRoot = $state<"file" | "folder" | null>(null);
  let newRootName = $state("");
  let rootCreateInputEl = $state<HTMLInputElement | null>(null);

  async function startRootCreate(kind: "file" | "folder") {
    creatingRoot = kind;
    newRootName = "";
    await tick();
    rootCreateInputEl?.focus();
  }

  async function commitRootCreate() {
    const name = newRootName.trim();
    const kind = creatingRoot;
    creatingRoot = null;
    if (!name || !workspace.rootPath || !kind) return;
    const path = workspace.rootPath + "/" + name;
    const result = await (kind === "folder"
      ? workspace.createFolderAction(path)
      : workspace.createFileAction(path));
    result.mapErr(err => toast.error(`Create failed: ${err}`));
  }

  function cancelRootCreate() {
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

  function onRootDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer && (e.dataTransfer.dropEffect = "move");
    rootDropTarget = true;
  }

  function onRootDragLeave() {
    rootDropTarget = false;
  }

  async function onRootDrop(e: DragEvent) {
    e.preventDefault();
    rootDropTarget = false;
    const src = workspace.dragSrcPath;
    workspace.dragSrcPath = null;
    if (!src || !workspace.rootPath) return;
    // Already at root (relative path has no directory separator)
    if (!src.includes('/')) return;
    const dst = workspace.rootPath + "/" + basename(src);
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

  // ─── Workspace name ───────────────────────────────────────────────────────

  const workspaceName = $derived(
    workspace.rootPath ? basename(workspace.rootPath) : "Explorer"
  );
</script>

<!-- ─── Sidebar shell ──────────────────────────────────────────────────────── -->
<div class="flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">

  <!-- Header: title + toolbar -->
  <div class="flex flex-col gap-1 px-2 pt-2 pb-1 border-b border-sidebar-border">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-0.5 min-w-0">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Toggle sidebar"
          onclick={ontoggle}
        >
          <PanelLeft class="size-3.5" />
        </Button>
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {workspaceName}
        </span>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Expand all"
          onclick={() => workspace.expandAll()}
        >
          <ChevronsUpDown class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Collapse all"
          onclick={() => workspace.collapseAll()}
        >
          <ChevronsDownUp class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="New file"
          onclick={() => startRootCreate("file")}
        >
          <FilePlus class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="New folder"
          onclick={() => startRootCreate("folder")}
        >
          <FolderPlus class="size-3.5" />
        </Button>
      </div>
    </div>
    <!-- Search -->
    <div class="relative">
      <Search class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
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
          <X class="size-3" />
        </button>
      {/if}
    </div>
  </div>

  <!-- Tree area -->
  <ScrollArea.Root class="flex-1 min-h-0 px-2">
    <!-- Root-level context menu (empty area) -->
    <ContextMenu.Root>
      <ContextMenu.Trigger class="block min-h-full">
        <div
          class="py-1 {rootDropTarget ? 'ring-1 ring-inset ring-sidebar-primary' : ''}"
          ondragover={onRootDragOver}
          ondragleave={onRootDragLeave}
          ondrop={onRootDrop}
          role="tree"
          aria-label="File explorer"
        >
          <!-- Root-level create input -->
          {#if creatingRoot}
            <div class="flex items-center gap-1 px-2 py-0.5">
              <input
                bind:this={rootCreateInputEl}
                class="h-5 flex-1 rounded border border-input bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                placeholder="{creatingRoot === 'folder' ? 'folder-name' : 'file.typ'}"
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
        <ContextMenu.Item onclick={() => startRootCreate("file")}>
          New File
        </ContextMenu.Item>
        <ContextMenu.Item onclick={() => startRootCreate("folder")}>
          New Folder
        </ContextMenu.Item>
        <ContextMenu.Item onclick={handleImportFiles}>
          Import Files…
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  </ScrollArea.Root>
</div>
