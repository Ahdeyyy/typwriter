<!-- File Tree Component -->
<script lang="ts">
    import WorkspaceSwitcher from "./workspace-switcher.svelte";
    import { Button } from "./ui/button/index";
    import {
        ChevronRightIcon,
        FileIcon,
        FolderIcon,
        LucideChevronsDownUp,
        LucideChevronsUpDown,
        LucideFilePlus,
        LucideFilePlus2,
        LucideFolderOpen,
        LucideFolderPlus,
        LucideSearch,
        LucideSettings,
    } from "@lucide/svelte";
    import * as Collapsible from "./ui/collapsible";
    import { getFileName, getFileType } from "@/utils";
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import { appContext } from "../app-context.svelte";
    import type { FileTreeNode } from "@/workspace/workspace.svelte";
    import { Badge } from "./ui/badge";
    import CreateFile from "./create-file.svelte";
    import CreateFolder from "./create-folder.svelte";
    import { toast } from "svelte-sonner";

    // Track open state of folders (keyed by their full relative path to avoid collisions)
    const openFolders = $state<string[]>([]);

    $inspect(openFolders);
    // Helper to derive a unique key for a folder based on its path in the tree
    function folderKey(parentPath: string, name: string) {
        return parentPath ? parentPath + "/" + name : name;
    }
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
        <Button
            variant="ghost"
            class="size-7"
            size="icon"
            onclick={() => {
                if (!appContext.workspace) {
                    toast.error("No workspace available");
                    return;
                }

                const chilrenName = (
                    f: FileTreeNode,
                    parentName?: string,
                ): string[] => {
                    let name = parentName ? parentName + "/" + f.name : f.name;
                    return [
                        name,
                        ...(f.children
                            ? f.children.flatMap((c) => chilrenName(c, name))
                            : []),
                    ];
                };
                const folders = appContext.workspace.fileEntries
                    .filter((f) => f.type === "directory")
                    .flatMap((f) => chilrenName(f))
                    .map((name) => name);

                if (openFolders.length === 0) {
                    // Expand all folders
                    openFolders.push(...folders);
                } else {
                    // Collapse all folders
                    openFolders.splice(0, openFolders.length);
                }
            }}
        >
            {#if openFolders.length === 0}
                <!-- expand all -->
                <LucideChevronsUpDown />
            {:else}
                <!-- collapse all -->
                <LucideChevronsDownUp />
            {/if}
        </Button>
    </header>

    <ScrollArea
        orientation="vertical"
        class="overflow-hidden flex-1 min-h-0 max-h-[calc(100svh-7.5rem)]"
    >
        <ul class="py-2 text-sm select-none">
            {#if appContext.workspace}
                {#each appContext.workspace?.fileEntries ?? [] as item, index (index)}
                    {@render Tree({ item, depth: 0, parentPath: "" })}
                {/each}
            {:else}
                <li class="p-4 text-xs text-muted-foreground">
                    No workspace loaded. Please open a workspace to view files.
                </li>
            {/if}
        </ul>
    </ScrollArea>

    <footer class="border-t-1 p-2 text-xs w-full">
        <div class="flex items-center">
            <WorkspaceSwitcher />
        </div>
    </footer>
</aside>

<!-- Recursive Tree Snippet -->
{#snippet Tree({
    item,
    depth,
    parentPath,
}: {
    item: FileTreeNode;
    depth: number;
    parentPath: string;
})}
    {@const isFolder = item.type === "directory"}
    {@const name = item.name}
    {@const children = item.children ?? []}
    {@const thisPath = isFolder ? folderKey(parentPath, name) : name}
    <!-- Derive relative current file path for active highlighting -->
    {@const currentFilePath = appContext.workspace?.document?.path ?? ""}
    {@const workspacePath = appContext.workspace?.rootPath ?? ""}
    {@const currentRel = currentFilePath.startsWith(workspacePath)
        ? currentFilePath.slice(workspacePath.length).replace(/^[\\/]/, "")
        : currentFilePath}
    {@const isActiveFile = !isFolder && name === currentRel}

    <li class="relative">
        {#if !isFolder}
            <Button
                variant="ghost"
                size="sm"
                data-active={isActiveFile}
                class="w-full justify-start h-7 pl-2 pr-2 gap-2 rounded-none font-normal tracking-tight text-left hover:bg-accent/60 data-[active=true]:bg-primary/10 data-[active=true]:text-primary focus-visible:ring-0 focus-visible:outline-none relative"
                style={`padding-left: calc(${depth} * 0.85rem + 0.5rem);`}
                onclick={() => {
                    if (!appContext.workspace) {
                        console.error("No workspace available");
                        return;
                    }
                    appContext.workspace.openFile(item.path);
                }}
            >
                <span class="truncate"
                    >{getFileName(name).replace(
                        "." + getFileType(name),
                        "",
                    )}</span
                >
                <Badge
                    class="absolute shadow right-2"
                    hidden={getFileType(name) === ""}
                    variant="secondary"
                >
                    {getFileType(name)}
                </Badge>
            </Button>
        {:else}
            <Collapsible.Root
                open={openFolders.includes(thisPath)}
                onOpenChange={(isOpen) => {
                    if (isOpen) {
                        if (thisPath.includes("sub sub")) {
                            console.log("is open");
                        }
                        openFolders.push(thisPath);
                    } else {
                        openFolders.splice(openFolders.indexOf(thisPath), 1);
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
