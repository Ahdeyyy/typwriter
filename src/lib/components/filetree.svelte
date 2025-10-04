<!-- File Tree Component -->
<script lang="ts">
  import { appState } from "@/states.svelte"
  import WorkspaceSwitcher from "./workspace-switcher.svelte"
  import { Button } from "./ui/button/index"
  import {
    ChevronRightIcon,
    FileIcon,
    FolderIcon,
    LucideFilePlus,
    LucideFolderOpen,
  } from "@lucide/svelte"
  import * as Collapsible from "./ui/collapsible"
  import { getFileName } from "@/utils"
  import { ScrollArea } from "$lib/components/ui/scroll-area"

  // Track open state of folders (keyed by their full relative path to avoid collisions)
  const openFolders = $state<string[]>([])

  // Helper to derive a unique key for a folder based on its path in the tree
  function folderKey(parentPath: string, name: string) {
    return parentPath ? parentPath + "/" + name : name
  }
</script>

<aside
  class="h-full w-full flex flex-col bg-background/40 border-r border-border relative"
>
  <header class="px-2 py-1 border-b border-border/60">
    <Button
      variant="ghost"
      class="size-7"
      size="icon"
      onclick={() => appState.createNewFile()}
    >
      <LucideFilePlus />
    </Button>
  </header>

  <ScrollArea
    orientation="vertical"
    class="overflow-hidden flex-1 min-h-0 max-h-[calc(100svh-7.5rem)]"
  >
    <ul class="py-2 text-sm select-none">
      {#each appState.entries as item, index (index)}
        {@render Tree({ item, depth: 0, parentPath: "" })}
      {/each}
    </ul>
  </ScrollArea>

  <footer class="border-t-1 p-2 text-xs text-muted-foreground">
    <WorkspaceSwitcher />
  </footer>
</aside>

<!-- Recursive Tree Snippet -->
<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
{#snippet Tree({
  item,
  depth,
  parentPath,
}: {
  item: string | any[]
  depth: number
  parentPath: string
})}
  {@const isFolder = Array.isArray(item)}
  {@const [name, rawChildren] = isFolder
    ? (item as [string, any[]])
    : [item, []]}
  {@const children = isFolder ? rawChildren : []}
  {@const thisPath = isFolder
    ? folderKey(parentPath, name as string)
    : (name as string)}
  <!-- Derive relative current file path for active highlighting -->
  {@const currentRel = appState.currentFilePath.startsWith(
    appState.workspacePath
  )
    ? appState.currentFilePath
        .slice(appState.workspacePath.length)
        .replace(/^[\\/]/, "")
    : appState.currentFilePath}
  {@const isActiveFile = !isFolder && name === currentRel}

  <li class="relative">
    {#if !isFolder}
      <Button
        variant="ghost"
        size="sm"
        data-active={isActiveFile}
        class="w-full justify-start h-7 pl-2 pr-2 gap-2 rounded-none font-normal tracking-tight text-left hover:bg-accent/60 data-[active=true]:bg-primary/10 data-[active=true]:text-primary focus-visible:ring-0 focus-visible:outline-none"
        style={`padding-left: calc(${depth} * 0.85rem + 0.5rem);`}
        onclick={() => appState.openFile(name)}
      >
        <FileIcon />
        <span class="truncate">{getFileName(name)}</span>
      </Button>
    {:else}
      <Collapsible.Root
        open={openFolders.includes(thisPath)}
        onOpenChange={(isOpen) => {
          if (isOpen) {
            openFolders.push(thisPath)
          } else {
            openFolders.splice(openFolders.indexOf(thisPath), 1)
          }
        }}
        class="group"
      >
        <Collapsible.Trigger class="w-full">
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="sm"
              class="w-full justify-start h-7 gap-2 rounded-none font-medium pl-2 pr-2 text-left hover:bg-accent/60 focus-visible:ring-0 focus-visible:outline-none [&>svg:first-child]:transition-transform"
              style={`padding-left: calc(${depth} * 0.85rem + 0.25rem);`}
            >
              <ChevronRightIcon
                class="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90"
              />
              {#if openFolders.includes(thisPath)}
                <LucideFolderOpen />
              {:else}
                <FolderIcon />
              {/if}
              <span class="truncate">{name}</span>
            </Button>
          {/snippet}
        </Collapsible.Trigger>
        <Collapsible.Content class="overflow-hidden">
          <ul class="ml-1 border-l border-border/40">
            {#each children as subItem, index (index)}
              {@render Tree({
                item: subItem,
                depth: depth + 1,
                parentPath: thisPath,
              })}
            {/each}
          </ul>
        </Collapsible.Content>
      </Collapsible.Root>
    {/if}
  </li>
{/snippet}
