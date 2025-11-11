<!--
	Installed from @ieedan/shadcn-svelte-extras
-->

<script lang="ts">
    import * as Collapsible from "$lib/components/ui/collapsible/index.js";
    import FolderIcon from "@lucide/svelte/icons/folder";
    import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
    import { cn } from "$lib/utils/utils";
    import type { TreeViewFolderProps } from "./types";

    let {
        name,
        open = $bindable(true),
        class: className,
        icon,
        children,
    }: TreeViewFolderProps = $props();
</script>

<Collapsible.Root bind:open>
    <Collapsible.Trigger
        class={cn(
            "flex place-items-center gap-1 w-full min-w-0 pl-[3px]",
            className,
        )}
    >
        {#if icon}
            {@render icon({ name, open })}
        {:else if open}
            <FolderOpenIcon class="size-4" />
        {:else}
            <FolderIcon class="size-4" />
        {/if}
        <span class="truncate min-w-0 text-start">{name}</span>
    </Collapsible.Trigger>
    <Collapsible.Content
        style={" --bits-collapsible-content-width: 100%"}
        class="mx-2 border-l"
    >
        <div class="relative flex place-items-start w-full">
            <div class="bg-border mx-2 h-full w-px"></div>
            <div class="flex flex-col w-full">
                {@render children?.()}
            </div>
        </div>
    </Collapsible.Content>
</Collapsible.Root>
