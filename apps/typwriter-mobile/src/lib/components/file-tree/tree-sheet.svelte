<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { toast } from "svelte-sonner";
  import {
    FilePlus,
    FolderPlus,
    PencilSimple,
    ArrowsOutCardinal,
    Star,
    Trash,
    FolderOpen,
  } from "phosphor-svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Sheet from "$lib/components/ui/sheet";
  import * as Drawer from "$lib/components/ui/drawer";
  import * as Dialog from "$lib/components/ui/dialog";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { app } from "$lib/stores/app.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import type { FileNode } from "$lib/ipc/types";
  import TreeNode from "./tree-node.svelte";

  const expanded = new SvelteSet<string>([""]); // root expanded by default

  // Long-press action drawer.
  let actionTarget = $state<FileNode | null>(null);

  // Shared single-input dialog (rename / new file / new folder).
  type DialogMode = "rename" | "newFile" | "newFolder" | "move" | "delete";
  let dialogMode = $state<DialogMode | null>(null);
  let dialogTarget = $state<FileNode | null>(null);
  /** Parent rel-path for create operations. */
  let createParent = $state("");
  let inputValue = $state("");

  function openFile(relPath: string) {
    editor.loadFile(relPath).mapErr((e) => toast.error(`Failed to open: ${e}`));
    app.closeOverlay();
  }

  function startCreate(mode: "newFile" | "newFolder", parentRel: string) {
    actionTarget = null;
    createParent = parentRel;
    inputValue = "";
    dialogMode = mode;
  }

  function startRename(node: FileNode) {
    actionTarget = null;
    dialogTarget = node;
    inputValue = node.name;
    dialogMode = "rename";
  }

  function startMove(node: FileNode) {
    actionTarget = null;
    dialogTarget = node;
    dialogMode = "move";
  }

  function startDelete(node: FileNode) {
    actionTarget = null;
    dialogTarget = node;
    dialogMode = "delete";
  }

  function joinPath(parent: string, name: string): string {
    return parent ? `${parent}/${name}` : name;
  }

  function submitDialog() {
    const name = inputValue.trim();
    if (dialogMode === "newFile" || dialogMode === "newFolder") {
      if (!name) return toast.error("Name cannot be empty");
      const relPath = joinPath(createParent, name);
      const op = dialogMode === "newFile" ? workspace.createFile(relPath) : workspace.createFolder(relPath);
      op.match(
        () => {
          if (createParent) expanded.add(createParent);
          dialogMode = null;
        },
        (e) => toast.error(`Failed: ${e}`),
      );
    } else if (dialogMode === "rename" && dialogTarget) {
      if (!name) return toast.error("Name cannot be empty");
      workspace.renameEntry(dialogTarget.relPath, name).match(
        () => (dialogMode = null),
        (e) => toast.error(`Failed to rename: ${e}`),
      );
    }
  }

  function doMove(newParentRel: string) {
    if (!dialogTarget) return;
    workspace.moveEntry(dialogTarget.relPath, newParentRel).match(
      () => (dialogMode = null),
      (e) => toast.error(`Failed to move: ${e}`),
    );
  }

  function doDelete() {
    if (!dialogTarget) return;
    workspace.deleteEntry(dialogTarget.relPath).match(
      () => (dialogMode = null),
      (e) => toast.error(`Failed to delete: ${e}`),
    );
  }

  function setAsMain(node: FileNode) {
    actionTarget = null;
    workspace.setMain(node.relPath).mapErr((e) => toast.error(`Failed: ${e}`));
  }

  const dialogTitle = $derived.by(() => {
    switch (dialogMode) {
      case "newFile":
        return "New file";
      case "newFolder":
        return "New folder";
      case "rename":
        return "Rename";
      case "move":
        return "Move to…";
      case "delete":
        return `Delete "${dialogTarget?.name}"?`;
      default:
        return "";
    }
  });
</script>

<Sheet.Root
  open={app.overlay === "filetree"}
  onOpenChange={(o) => {
    if (!o) app.closeOverlay();
  }}
>
  <Sheet.Content side="left" class="w-[85vw] max-w-80 p-0">
    <div class="flex h-full flex-col" style="padding-top: env(safe-area-inset-top);">
      <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span class="truncate text-sm font-semibold">{workspace.name ?? "Files"}</span>
        <div class="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="New file" onclick={() => startCreate("newFile", "")}>
            <FilePlus />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="New folder" onclick={() => startCreate("newFolder", "")}>
            <FolderPlus />
          </Button>
        </div>
      </div>
      <ScrollArea class="flex-1">
        <div class="p-1">
          {#if workspace.tree}
            {#each workspace.tree.children as child (child.relPath)}
              <TreeNode
                node={child}
                {expanded}
                mainFile={workspace.mainFile}
                onOpenFile={openFile}
                onLongpress={(n) => (actionTarget = n)}
              />
            {/each}
          {/if}
        </div>
      </ScrollArea>
    </div>
  </Sheet.Content>
</Sheet.Root>

<!-- Long-press action drawer -->
<Drawer.Root open={actionTarget !== null} onOpenChange={(o) => { if (!o) actionTarget = null; }}>
  <Drawer.Content>
    <Drawer.Header>
      <Drawer.Title>{actionTarget?.name}</Drawer.Title>
    </Drawer.Header>
    {#if actionTarget}
      {@const target = actionTarget}
      <div
        class="flex flex-col gap-1 p-2 pb-6"
        style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem);"
      >
        {#if target.isDir}
          <Button variant="ghost" class="justify-start" onclick={() => startCreate("newFile", target.relPath)}>
            <FilePlus /> New file inside
          </Button>
          <Button variant="ghost" class="justify-start" onclick={() => startCreate("newFolder", target.relPath)}>
            <FolderPlus /> New folder inside
          </Button>
        {:else}
          <Button variant="ghost" class="justify-start" onclick={() => openFile(target.relPath)}>
            <FolderOpen /> Open
          </Button>
          <Button variant="ghost" class="justify-start" onclick={() => setAsMain(target)}>
            <Star /> Set as main file
          </Button>
        {/if}
        <Button variant="ghost" class="justify-start" onclick={() => startRename(target)}>
          <PencilSimple /> Rename
        </Button>
        <Button variant="ghost" class="justify-start" onclick={() => startMove(target)}>
          <ArrowsOutCardinal /> Move to…
        </Button>
        <Button variant="ghost" class="text-destructive justify-start" onclick={() => startDelete(target)}>
          <Trash /> Delete
        </Button>
      </div>
    {/if}
  </Drawer.Content>
</Drawer.Root>

<!-- Shared dialog: rename / new file / new folder / move / delete -->
<Dialog.Root open={dialogMode !== null} onOpenChange={(o) => { if (!o) dialogMode = null; }}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{dialogTitle}</Dialog.Title>
    </Dialog.Header>

    {#if dialogMode === "delete"}
      <Dialog.Footer class="mt-2 flex flex-col gap-2">
        <Button variant="destructive" class="w-full" onclick={doDelete}>Delete</Button>
        <Button variant="ghost" class="w-full" onclick={() => (dialogMode = null)}>Cancel</Button>
      </Dialog.Footer>
    {:else if dialogMode === "move"}
      <div class="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
        {#each workspace.allFolders() as folder (folder.relPath)}
          <Button variant="ghost" class="justify-start font-mono text-xs" onclick={() => doMove(folder.relPath)}>
            <FolderOpen /> {folder.name}
          </Button>
        {/each}
      </div>
    {:else if dialogMode !== null}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          submitDialog();
        }}
      >
        <Input bind:value={inputValue} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <Dialog.Footer class="mt-4">
          <Button type="submit" class="w-full">
            {dialogMode === "rename" ? "Rename" : "Create"}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
