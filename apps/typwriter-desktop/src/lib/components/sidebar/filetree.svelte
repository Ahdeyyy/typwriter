<script lang="ts">
  import {
    ChevronsUpDown,
    ChevronsDownUp,
    FilePlus,
    FolderPlus,
    PanelLeft,
    Search,
    TriangleAlert,
    X,
    XCircle,
  } from "@lucide/svelte";
  import { tick } from "svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { workspace, basename } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import type { SerializedDiagnostic } from "$lib/types";
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

  // ─── Problems dialog ──────────────────────────────────────────────────────

  let dialogOpen = $state(false);

  const activeFileDiags = $derived.by(() => {
    const relPath = editor.activeTab?.relPath ?? null;
    if (!relPath) return { errors: [] as SerializedDiagnostic[], warnings: [] as SerializedDiagnostic[] };
    return {
      errors:   diagnostics.errors.filter(d => d.file_path === relPath),
      warnings: diagnostics.warnings.filter(d => d.file_path === relPath),
    };
  });

  const diagCount = $derived(activeFileDiags.errors.length + activeFileDiags.warnings.length);

  function lineColToOffset(content: string, line: number, col: number): number {
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    return offset + Math.min(col, lines[line]?.length ?? 0);
  }

  function jumpToDiagnostic(diag: SerializedDiagnostic) {
    const tab = editor.activeTab;
    if (!tab || !diag.range) return;
    const offset = lineColToOffset(tab.content, diag.range.start_line, diag.range.start_col);
    editor.requestCursorJump(tab.id, offset);
    dialogOpen = false;
  }

  // ─── Workspace name ───────────────────────────────────────────────────────

  const workspaceName = $derived(
    workspace.rootPath ? basename(workspace.rootPath) : "Explorer"
  );
</script>

<!-- ─── Sidebar shell ──────────────────────────────────────────────────────── -->
<div class="flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">

  <!-- Header: title + toolbar (aligned with tab bar) -->
  <div class="flex h-9 items-center justify-between border-b border-sidebar-border px-2">
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
      <Button
        variant="ghost"
        size="icon-sm"
        title="Problems"
        onclick={() => (dialogOpen = true)}
        class="relative"
      >
        <TriangleAlert class="size-3.5 {activeFileDiags.errors.length > 0 ? 'text-destructive' : activeFileDiags.warnings.length > 0 ? 'text-yellow-500' : ''}" />
        {#if diagCount > 0}
          <span class="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground leading-none">
            {diagCount > 9 ? '9+' : diagCount}
          </span>
        {/if}
      </Button>
    </div>
  </div>

  <!-- Search bar -->
  <div class="border-b border-sidebar-border px-2 py-1 relative">
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

  <!-- Tree area -->
  <Dialog.Root bind:open={dialogOpen}>
    <Dialog.Content class="max-w-lg">
      <Dialog.Header>
        <Dialog.Title>Problems — {editor.activeTab?.name ?? 'No file open'}</Dialog.Title>
        <Dialog.Description>
          Errors and warnings in the current file.
        </Dialog.Description>
      </Dialog.Header>
      <ScrollArea.Root class="max-h-96">
        {#if diagCount === 0}
          <p class="py-6 text-center text-sm text-muted-foreground">No problems detected.</p>
        {:else}
          {#each activeFileDiags.errors as diag}
            <button
              class="flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => jumpToDiagnostic(diag)}
            >
              <XCircle class="mt-0.5 size-4 shrink-0 text-destructive" />
              <div class="min-w-0">
                <p class="font-medium">{diag.message}</p>
                {#if diag.range}
                  <p class="text-xs text-muted-foreground">Line {diag.range.start_line + 1}, Col {diag.range.start_col + 1}</p>
                {/if}
                {#each diag.hints as hint}
                  <p class="text-xs text-muted-foreground italic">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}
          {#each activeFileDiags.warnings as diag}
            <button
              class="flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => jumpToDiagnostic(diag)}
            >
              <TriangleAlert class="mt-0.5 size-4 shrink-0 text-yellow-500" />
              <div class="min-w-0">
                <p class="font-medium">{diag.message}</p>
                {#if diag.range}
                  <p class="text-xs text-muted-foreground">Line {diag.range.start_line + 1}, Col {diag.range.start_col + 1}</p>
                {/if}
                {#each diag.hints as hint}
                  <p class="text-xs text-muted-foreground italic">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}
        {/if}
      </ScrollArea.Root>
    </Dialog.Content>
  </Dialog.Root>

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
