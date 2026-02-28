<script lang="ts">
  import { tick } from "svelte";
  import { ChevronRight } from "@lucide/svelte";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { workspace, type FileNode, basename } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { toast } from "svelte-sonner";

  // ─── Props ──────────────────────────────────────────────────────────────────

  interface Props {
    node: FileNode;
    depth: number;
  }

  let { node, depth }: Props = $props();

  // ─── State ──────────────────────────────────────────────────────────────────

  let isDropTarget = $state(false);
  let renameInputEl = $state<HTMLInputElement | null>(null);

  // ─── Derived ────────────────────────────────────────────────────────────────

  const isActive   = $derived(workspace.activeFilePath === node.path);
  const isMainFile = $derived(workspace.mainFile === node.path);
  const indentPx   = $derived(depth * 12);

  // ─── Click ──────────────────────────────────────────────────────────────────

  function handleClick() {
    if (node.isEditing) return;
    if (node.is_dir) {
      workspace.toggleFolder(node.path);
    } else {
      workspace.openFile(node.path);
      editor.loadFile(node.path).mapErr(err => {
        toast.error(`Failed to open file: ${err}`);
      });
    }
  }

  // ─── Rename ─────────────────────────────────────────────────────────────────

  async function startRename() {
    node.editName = node.name;
    node.isEditing = true;
    await tick();
    renameInputEl?.select();
  }

  async function commitRename() {
    if (!node.isEditing) return;
    const newName = node.editName.trim();
    node.isEditing = false;
    if (!newName || newName === node.name) return;
    const result = await workspace.renameAction(node.path, newName);
    result.mapErr(err => toast.error(`Rename failed: ${err}`));
  }

  function cancelRename() {
    node.isEditing = false;
    node.editName = node.name;
  }

  function handleRenameKey(e: KeyboardEvent) {
    if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
  }

  // ─── Create child ────────────────────────────────────────────────────────────

  let newChildName = $state("");
  let creatingChild = $state<"file" | "folder" | null>(null);
  let createInputEl = $state<HTMLInputElement | null>(null);

  async function startCreate(kind: "file" | "folder") {
    if (!node.is_dir) return;
    if (!node.expanded) workspace.toggleFolder(node.path);
    creatingChild = kind;
    newChildName = "";
    await tick();
    createInputEl?.focus();
  }

  async function commitCreate() {
    const name = newChildName.trim();
    const kind = creatingChild;
    creatingChild = null;
    newChildName = "";
    if (!name || !kind) return;
    const path = node.path + "/" + name;
    const result = await (kind === "folder"
      ? workspace.createFolderAction(path)
      : workspace.createFileAction(path));
    result.mapErr(err => toast.error(`Create failed: ${err}`));
  }

  function cancelCreate() {
    creatingChild = null;
    newChildName = "";
  }

  function handleCreateKey(e: KeyboardEvent) {
    if (e.key === "Enter")  { e.preventDefault(); commitCreate(); }
    if (e.key === "Escape") { e.preventDefault(); cancelCreate(); }
  }

  // ─── Import files ────────────────────────────────────────────────────────────

  async function handleImportFiles() {
    try {
      await workspace.importFilesAction(node.path);
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete() {
    const result = await (node.is_dir
      ? workspace.deleteFolderAction(node.path)
      : workspace.deleteFileAction(node.path));
    result.mapErr(err => toast.error(`Delete failed: ${err}`));
  }

  // ─── Set main file ───────────────────────────────────────────────────────────

  async function handleSetMainFile() {
    const result = await workspace.setMainFileAction(node.path);
    result.mapErr(err => toast.error(`Set main file failed: ${err}`));
  }

  // ─── Drag & Drop ─────────────────────────────────────────────────────────────

  function onDragStart(e: DragEvent) {
    workspace.dragSrcPath = node.path;
    e.dataTransfer?.setData("text/plain", node.path);
    e.dataTransfer && (e.dataTransfer.effectAllowed = "move");
  }

  function onDragOver(e: DragEvent) {
    if (!node.is_dir) return;
    e.preventDefault();
    e.dataTransfer && (e.dataTransfer.dropEffect = "move");
    isDropTarget = true;
  }

  function onDragLeave() {
    isDropTarget = false;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    isDropTarget = false;
    const src = workspace.dragSrcPath;
    workspace.dragSrcPath = null;
    if (!src || !node.is_dir || src === node.path) return;
    // Don't drop a folder into its own descendant
    if (src.startsWith(node.path + "/") || src.startsWith(node.path + "\\")) return;
    const dst = node.path + "/" + basename(src);
    const srcIsDir = workspace.filteredTree
      ? findIsDir(workspace.tree, src)
      : false;
    const result = await workspace.moveAction(src, dst, srcIsDir);
    result.mapErr(err => toast.error(`Move failed: ${err}`));
  }

  function findIsDir(nodes: FileNode[], path: string): boolean {
    for (const n of nodes) {
      if (n.path === path) return n.is_dir;
      if (findIsDir(n.children, path)) return true;
    }
    return false;
  }

  function onDragEnd() {
    workspace.dragSrcPath = null;
  }
</script>

<!-- ─── Node row ─────────────────────────────────────────────────────────── -->

<ContextMenu.Root>
  <ContextMenu.Trigger>
    <div
      role="treeitem"
      aria-selected={isActive}
      aria-expanded={node.is_dir ? node.expanded : undefined}
      tabindex="0"
      draggable="true"
      class="group flex w-full cursor-pointer select-none items-center gap-1 border-l-2 py-1 pr-2 text-sm outline-none
             hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
             focus-visible:ring-1 focus-visible:ring-sidebar-ring
             {isActive   ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground'}
             {isMainFile ? 'border-sidebar-primary' : 'border-transparent'}
             {isDropTarget ? 'ring-1 ring-inset ring-sidebar-primary bg-sidebar-accent/50' : ''}"
      style="padding-left: {indentPx + 8}px"
      onclick={handleClick}
      onkeydown={(e) => e.key === "Enter" && handleClick()}
      ondragstart={onDragStart}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
      ondragend={onDragEnd}
    >
      <!-- Expand chevron for folders; spacer for files -->
      {#if node.is_dir}
        <ChevronRight
          class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150
                 {node.expanded ? 'rotate-90' : ''}"
        />
      {:else}
        <span class="w-3.5 shrink-0"></span>
      {/if}

      <!-- Label or rename input -->
      {#if node.isEditing}
        <Input
          bind:ref={renameInputEl}
          class="h-5 flex-1 px-1 py-0 text-xs"
          bind:value={node.editName}
          onkeydown={handleRenameKey}
          onblur={commitRename}
          onclick={(e) => e.stopPropagation()}
        />
      {:else}
        <span class="flex-1 truncate text-xs leading-5">{node.name}</span>
      {/if}
    </div>
  </ContextMenu.Trigger>

  <!-- ─── Context menu ───────────────────────────────────────────────── -->
  <ContextMenu.Content>
    {#if node.is_dir}
      <ContextMenu.Item onclick={() => startCreate("file")}>
        New File
      </ContextMenu.Item>
      <ContextMenu.Item onclick={() => startCreate("folder")}>
        New Folder
      </ContextMenu.Item>
      <ContextMenu.Item onclick={handleImportFiles}>
        Import Files…
      </ContextMenu.Item>
      <ContextMenu.Separator />
    {:else}
      <ContextMenu.Item onclick={handleClick}>Open</ContextMenu.Item>
      <ContextMenu.Item
        onclick={handleSetMainFile}
        disabled={isMainFile}
      >
        Set as Main File
      </ContextMenu.Item>
      <ContextMenu.Separator />
    {/if}
    <ContextMenu.Item onclick={startRename}>Rename</ContextMenu.Item>
    <ContextMenu.Item variant="destructive" onclick={handleDelete}>
      Delete
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>

<!-- ─── Children + inline create ──────────────────────────────────────────── -->

{#if node.is_dir && node.expanded}
  <!-- Inline create input -->
  {#if creatingChild}
    <div
      class="flex items-center gap-1 px-1 py-0.5"
      style="padding-left: {indentPx + 4 + 12}px"
    >
      <Input
        bind:ref={createInputEl}
        class="h-5 flex-1 px-1 py-0 text-xs"
        placeholder="{creatingChild === 'folder' ? 'folder-name' : 'file.typ'}"
        bind:value={newChildName}
        onkeydown={handleCreateKey}
        onblur={cancelCreate}
      />
    </div>
  {/if}

  <!-- Recursive children -->
  {#each node.children as child (child.path)}
    <svelte:self node={child} depth={depth + 1} />
  {/each}
{/if}
