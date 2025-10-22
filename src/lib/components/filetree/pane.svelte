<!-- File Tree Component -->
<script lang="ts">
  import WorkspaceSwitcher from "./workspace-switcher.svelte"
  import { Button } from "@/components/ui/button"
  import {
    LucideChevronsDownUp,
    LucideChevronsUpDown,
    LucideSearch,
  } from "@lucide/svelte"
  import { getFileName, getFileType } from "@/utils"
  import { ScrollArea } from "$lib/components/ui/scroll-area"

  import CreateFile from "./create-file.svelte"
  import CreateFolder from "./create-folder.svelte"
  import { toast } from "svelte-sonner"
  import * as TreeView from "$lib/components/ui/tree-view"
  import * as Tooltip from "$lib/components/ui/tooltip/index.js"
  import {
    editorStore,
    mainSourceStore,
    paneStore,
    workspaceStore,
  } from "@/store/index.svelte"
  import type { FileTreeNode } from "@/store/workspace.svelte"
  import { PressedKeys } from "runed"

  const keys = new PressedKeys()

  keys.onKeys(["Control", "b"], () => {
    paneStore.isFileTreePaneOpen = !paneStore.isFileTreePaneOpen
  })

  const shouldExpandFolders = $derived(
    workspaceStore.files
      .filter((f) => f.type === "directory")
      .every((v) => !v.open)
  )

  const chilrenName = (f: FileTreeNode, parentName?: string): string[] => {
    let name = parentName ? parentName + "/" + f.name : f.name
    return [
      name,
      ...(f.children ? f.children.flatMap((c) => chilrenName(c, name)) : []),
    ]
  }

  // Helper to derive a unique key for a folder based on its path in the tree
  function folderKey(parentPath: string, name: string) {
    return parentPath ? parentPath + "/" + name : name
  }

  const toggleFoldersHandler = () => {
    if (!workspaceStore.name) {
      toast.error("No workspace available")
      return
    }

    if (shouldExpandFolders) {
      // expand all
      workspaceStore.files
        .filter((f) => f.type === "directory")
        .forEach((f) => (f.open = true))
    } else {
      // collapse all
      workspaceStore.files
        .filter((f) => f.type === "directory")
        .forEach((f) => (f.open = false))
    }
  }

  // $inspect(editorStore.content);
</script>

<aside
  class="h-full w-full flex flex-col bg-background/40 border-r border-border relative"
>
  <header
    class="px-2 py-1 flex align-center space-x-2 border-b border-border/60"
  >
    <CreateFile iconTrigger />
    <CreateFolder iconTrigger />
    <Button
      variant="ghost"
      class="size-7"
      size="icon"
      disabled
      onclick={() => console.log("Search")}
    >
      <LucideSearch />
    </Button>

    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            variant="ghost"
            class="size-7"
            size="icon"
            onclick={toggleFoldersHandler}
          >
            {#if shouldExpandFolders}
              <!-- expand all -->
              <LucideChevronsUpDown />
            {:else}
              <!-- collapse all -->
              <LucideChevronsDownUp />
            {/if}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
          <p>
            {shouldExpandFolders ? "Expand All" : "Collapse All"}
          </p>
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  </header>

  <ScrollArea
    orientation="vertical"
    class="overflow-hidden flex-1 min-h-0 max-h-[calc(100svh-7.5rem)]"
  >
    <div class="py-2 text-sm select-none p-2">
      {#each workspaceStore.files as item, index (index)}
        <TreeView.Root>
          {@render Tree({ item, parentPath: "" })}
        </TreeView.Root>
      {:else}
        <p class="p-4 text-xs text-muted-foreground">
          No workspace loaded. Please open a workspace to view files.
        </p>
      {/each}
    </div>
  </ScrollArea>

  <footer class="border-t-1 p-2 text-xs w-full">
    <WorkspaceSwitcher />
  </footer>
</aside>

<!-- Recursive Tree Snippet -->
{#snippet Tree({
  item,
  parentPath,
}: {
  item: FileTreeNode
  parentPath: string
})}
  {@const isFolder = item.type === "directory"}
  {@const name = item.name}
  {@const children = item.children ?? []}
  {@const thisPath = isFolder ? folderKey(parentPath, name) : name}

  {@const isActiveFile = !isFolder && item.path === editorStore.file_path}

  {#if !isFolder}
    <TreeView.File
      class={[
        "truncate px-3 py-1 rounded w-full hover:bg-accent",
        isActiveFile && "bg-accent text-accent-foreground",
        mainSourceStore.file_path === item.path &&
          "border-l-4 border-l-emerald-600",
      ]}
      disabled={isActiveFile}
      name={getFileName(name)}
      onclick={() => {
        // console.log("Clicked file", $state.snapshot(item));
        editorStore.openFile(item.path)
      }}
    />
  {:else}
    <TreeView.Folder
      class="truncate px-3 py-1 w-full hover:bg-accent"
      bind:open={item.open}
      {name}
    >
      {#each children as subItem, index (index)}
        {@render Tree({
          item: subItem,
          parentPath: thisPath,
        })}
      {/each}
    </TreeView.Folder>
  {/if}
{/snippet}
