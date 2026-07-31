<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { toast } from "svelte-sonner";
  import {
    FileAddIcon,
    FolderAddIcon,
    PencilEdit01Icon,
    Move02Icon,
    StarIcon,
    Delete02Icon,
    FolderOpenIcon,
    ArrowShrink01Icon,
    Settings01Icon,
    Home01Icon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
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

  /** Does the entered name already end in an extension (e.g. `.md`, `.png`)? */
  function hasExtension(name: string): boolean {
    return /\.[A-Za-z0-9]+$/.test(name);
  }

  function submitDialog() {
    let name = inputValue.trim();
    if (dialogMode === "newFile" || dialogMode === "newFolder") {
      if (!name) return toast.error("Name cannot be empty");
      // A new file with no extension defaults to a Typst document.
      if (dialogMode === "newFile" && !hasExtension(name)) name += ".typ";
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

  function collapseAll() {
    expanded.clear();
  }

  function openSettings() {
    app.openOverlay("settings");
  }

  /** Total files and folders in the workspace, for the footer summary. */
  const counts = $derived.by(() => {
    let files = 0;
    let folders = 0;
    const walk = (node: FileNode) => {
      for (const child of node.children) {
        if (child.isDir) {
          folders++;
          walk(child);
        } else {
          files++;
        }
      }
    };
    if (workspace.tree) walk(workspace.tree);
    return { files, folders };
  });

  /** Parent folder of the action target, shown as a subtitle in the drawer. */
  function parentDir(relPath: string): string {
    const i = relPath.lastIndexOf("/");
    return i === -1 ? "/" : relPath.slice(0, i);
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
  <Sheet.Content side="left" class="w-[85vw] max-w-80 p-0" showCloseButton={false}>
    <div class="flex h-full flex-col" style="padding-top: env(safe-area-inset-top);">
      <ScrollArea class="min-h-0 flex-1">
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

      <!-- Action toolbar -->
      <div class="border-border/60 flex items-center gap-1 border-t px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="Go to home" onclick={() => app.goHome()}>
          <Icon icon={Home01Icon} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="New file" onclick={() => startCreate("newFile", "")}>
          <Icon icon={FileAddIcon} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="New folder" onclick={() => startCreate("newFolder", "")}>
          <Icon icon={FolderAddIcon} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Collapse all" onclick={collapseAll}>
          <Icon icon={ArrowShrink01Icon} />
        </Button>
      </div>

      <!-- Footer: vault name, counts, settings -->
      <div
        class="border-border/60 flex items-center gap-2 border-t px-3 py-2.5"
        style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.625rem);"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold">{workspace.name ?? "Files"}</div>
          <div class="text-muted-foreground truncate text-xs">
            {counts.files} file{counts.files === 1 ? "" : "s"}, {counts.folders} folder{counts.folders === 1 ? "" : "s"}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Settings" onclick={openSettings}>
          <Icon icon={Settings01Icon} />
        </Button>
      </div>
    </div>
  </Sheet.Content>
</Sheet.Root>

<!-- A single tappable row inside a grouped action card. -->
{#snippet actionRow(
  icon: IconSvgElement,
  label: string,
  onclick: () => void,
  destructive = false,
)}
  <button
    type="button"
    {onclick}
    class="active:bg-accent flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors {destructive
      ? 'text-destructive'
      : ''}"
  >
    <Icon icon={icon} class="size-5 shrink-0 {destructive ? '' : 'text-muted-foreground'}" />
    <span class="min-w-0 flex-1 truncate">{label}</span>
  </button>
{/snippet}

<!-- Long-press action drawer -->
<Drawer.Root open={actionTarget !== null} onOpenChange={(o) => { if (!o) actionTarget = null; }}>
  <Drawer.Content>
    {#if actionTarget}
      {@const target = actionTarget}
      <div class="px-4 pb-2 pt-1">
        <Drawer.Title class="truncate text-base font-semibold">{target.name}</Drawer.Title>
        <Drawer.Description class="text-muted-foreground truncate text-xs">
          {target.isDir ? "Folder" : "File"} · {parentDir(target.relPath)}
        </Drawer.Description>
      </div>
      <div
        class="flex flex-col gap-3 px-3 pb-4 pt-2"
        style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem);"
      >
        <!-- Primary actions -->
        <div class="bg-muted/40 divide-border/60 divide-y overflow-hidden rounded-xl">
          {#if target.isDir}
            {@render actionRow(FileAddIcon, "New file inside", () => startCreate("newFile", target.relPath))}
            {@render actionRow(FolderAddIcon, "New folder inside", () => startCreate("newFolder", target.relPath))}
          {:else}
            {@render actionRow(FolderOpenIcon, "Open", () => openFile(target.relPath))}
            {@render actionRow(StarIcon, "Set as main file", () => setAsMain(target))}
          {/if}
        </div>

        <!-- File management -->
        <div class="bg-muted/40 divide-border/60 divide-y overflow-hidden rounded-xl">
          {@render actionRow(PencilEdit01Icon, "Rename", () => startRename(target))}
          {@render actionRow(Move02Icon, "Move to…", () => startMove(target))}
        </div>

        <!-- Destructive -->
        <div class="bg-muted/40 overflow-hidden rounded-xl">
          {@render actionRow(Delete02Icon, "Delete", () => startDelete(target), true)}
        </div>
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
            <Icon icon={FolderOpenIcon} /> {folder.name}
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
