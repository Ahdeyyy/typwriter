<script lang="ts">
    import * as DropdownMenu from "@/components/ui/dropdown-menu";
    import Button from "@/components/ui/button/button.svelte";
    import { ChevronDown, Check, ChevronsUpDown } from "@lucide/svelte";
    import { getFolderName } from "@/utils";
    import {
        editorStore,
        mainSourceStore,
        previewStore,
        workspaceStore,
    } from "@/store/index.svelte";
    import { toast } from "svelte-sonner";

    let dropdownOpen = $state(false);

    async function handleSelectRecent(path: string) {
        if (path === "") {
            toast.error("Invalid path");
            return;
        }
        workspaceStore.openWorkspace(path);
        editorStore.reset();
        previewStore.reset();
        mainSourceStore.reset();
        dropdownOpen = false;
    }

    async function handleOpenWorkspace() {
        workspaceStore.openWorkspace();
        editorStore.reset();
        previewStore.reset();
        mainSourceStore.reset();
        dropdownOpen = false;
    }
</script>

<div class="w-full">
    <DropdownMenu.Root bind:open={dropdownOpen}>
        <DropdownMenu.Trigger>
            {#snippet child({ props })}
                <Button
                    {...props}
                    variant="ghost"
                    class="w-full justify-start text-sm"
                >
                    <ChevronsUpDown class="mr-1" />
                    <span class="truncate">
                        {workspaceStore.name || "Select workspace"}
                    </span>
                </Button>
            {/snippet}
        </DropdownMenu.Trigger>

        <DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width)">
            {#each workspaceStore.recent_workspaces.state.paths as w}
                <DropdownMenu.Item>
                    {#snippet child({ props })}
                        <Button
                            {...props}
                            variant="ghost"
                            class="w-full flex items-center justify-between px-2 py-1.5 text-sm"
                            onclick={async () => await handleSelectRecent(w)}
                        >
                            <span class="truncate">{getFolderName(w)}</span>
                            {#if workspaceStore.path === w}
                                <Check class="size-4" />
                            {/if}
                        </Button>
                    {/snippet}
                </DropdownMenu.Item>
            {/each}
            <DropdownMenu.Separator
                hidden={workspaceStore.recent_workspaces.state.paths.values
                    .length === 0}
            />
            <DropdownMenu.Item>
                {#snippet child({ props })}
                    <Button
                        {...props}
                        variant="ghost"
                        class="w-full justify-start px-2 py-1.5 text-sm"
                        onclick={handleOpenWorkspace}
                    >
                        Open Workspace
                    </Button>
                {/snippet}
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </DropdownMenu.Root>
</div>
