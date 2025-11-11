<script lang="ts">
    import * as ContextMenu from "@/components/ui/context-menu";
    import * as Rename from "$lib/components/ui/rename";
    import * as TreeView from "$lib/components/ui/tree-view";

    import type { TreeViewFileProps } from "../ui/tree-view/types";
    import { workspaceStore } from "@/store/index.svelte";
    import { Badge } from "../ui/badge";
    import { getFileType, joinFsPath } from "@/utils";

    let props: TreeViewFileProps & { path: string } = $props();
    let renameMode = $state<"view" | "edit">("view");
    let validateName = (name: string) => {
        console.log("validating name");
        return name.length > 0;
    };
    function handleMove() {}
    async function handleRename(value: string) {
        console.log("new name: ", value);
        await workspaceStore.renameFile(
            props.path,
            joinFsPath(workspaceStore.path, value),
        );
    }
    async function handleDelete() {
        await workspaceStore.deleteFile(props.path, false);
    }
</script>

<Rename.Provider>
    <ContextMenu.Root>
        <ContextMenu.Trigger class="w-full">
            <div class="w-full relative pr-8">
                <TreeView.File {...props}>
                    <Rename.Root
                        this="span"
                        value={props.name}
                        blurBehavior="exit"
                        validate={validateName}
                        class="text-foreground outline-ring flex h-7 w-full !rounded-xs text-start focus:!ring-0 focus:outline-1 data-[mode=view]:place-items-center min-w-0"
                        textClass="!truncate w-full min-w-0"
                        bind:mode={renameMode}
                        fallbackSelectionBehavior="all"
                        onSave={handleRename}
                    />
                </TreeView.File>
                <Badge
                    variant="secondary"
                    class="absolute top-0 translate-y-1/2 right-0 size-5 px-3.5 py-0.5 text-xs flex-shrink-0"
                >
                    {getFileType(props.name)}
                </Badge>
            </div>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
            <Rename.Edit>
                {#snippet child({ edit })}
                    <ContextMenu.Item onSelect={edit}>Rename</ContextMenu.Item>
                {/snippet}
            </Rename.Edit>
            <ContextMenu.Item onSelect={handleDelete}>Delete</ContextMenu.Item>
        </ContextMenu.Content>
    </ContextMenu.Root>
</Rename.Provider>
