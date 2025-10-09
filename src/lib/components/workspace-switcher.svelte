<script lang="ts">
    import * as DropdownMenu from "@/components/ui/dropdown-menu";
    import Button from "@/components/ui/button/button.svelte";
    import { ChevronDown, Check } from "@lucide/svelte";
    import { openWorkspace } from "@/workspace/workspace.svelte";
    import { appContext } from "@/app-context.svelte";
    import { getFolderName } from "@/utils";
    import { open_workspace } from "@/ipc";
    // import { appState } from "@/states.svelte"

    let dropdownOpen = $state(false);

    async function handleSelectRecent(path: string) {
        const opened = await openWorkspace(path);
        if (opened) {
            appContext.workspace = opened;
            await open_workspace(path);
            appContext.addToRecentWorkspaces(path);
        }
        dropdownOpen = false;
    }

    async function handleOpenWorkspace() {
        const opened = await openWorkspace();
        if (opened) {
            appContext.workspace = opened;
            open_workspace(opened.rootPath);
            appContext.addToRecentWorkspaces(opened.rootPath);
        }

        dropdownOpen = false;
    }
</script>

<div>
    <DropdownMenu.Root bind:open={dropdownOpen}>
        <DropdownMenu.Trigger>
            {#snippet child({ props })}
                <Button
                    {...props}
                    variant="ghost"
                    size="sm"
                    class=" text-sm w-full"
                >
                    <span class="truncate">
                        {appContext.workspace?.name || "Select workspace"}
                    </span>
                    <ChevronDown class="ml-1" />
                </Button>
            {/snippet}
        </DropdownMenu.Trigger>

        <DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width)">
            {#if appContext.recent_workspaces.state.paths.length > 0}
                {#each appContext.recent_workspaces.state.paths as w}
                    <DropdownMenu.Item>
                        {#snippet child({ props })}
                            <Button
                                {...props}
                                variant="ghost"
                                class="w-full flex items-center justify-between px-2 py-1.5 text-sm"
                                onclick={async () =>
                                    await handleSelectRecent(w)}
                            >
                                <span class="truncate">{getFolderName(w)}</span>
                                {#if appContext.workspace?.rootPath === w}
                                    <Check class="size-4" />
                                {/if}
                            </Button>
                        {/snippet}
                    </DropdownMenu.Item>
                {/each}
                <DropdownMenu.Separator />
            {/if}
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
