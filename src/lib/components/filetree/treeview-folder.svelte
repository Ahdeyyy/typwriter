<script lang="ts">
    import * as TreeView from "@/components/ui/tree-view";
    import * as Rename from "$lib/components/ui/rename";
    import * as ContextMenu from "@/components/ui/context-menu";
    import type { TreeViewFolderProps } from "../ui/tree-view/types";
    import { workspaceStore } from "@/store/index.svelte";

    let {
        children,
        open = $bindable(),
        ...props
    }: TreeViewFolderProps & { path: string } = $props();

    async function handleDelete() {
        await workspaceStore.deleteFile(props.path, true);
    }
</script>

<ContextMenu.Root>
    <ContextMenu.Trigger>
        <TreeView.Folder bind:open {...props}>
            {#if children}
                {@render children()}
            {/if}
        </TreeView.Folder>
    </ContextMenu.Trigger>
    <ContextMenu.Content>
        <ContextMenu.Item onSelect={handleDelete}>Delete</ContextMenu.Item>
    </ContextMenu.Content>
</ContextMenu.Root>
