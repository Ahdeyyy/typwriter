<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { LucideFolderPlus } from "@lucide/svelte";
    import { Input } from "$lib/components/ui/input";
    import { appContext } from "@/app-context.svelte";
    import { toast } from "svelte-sonner";
    import { twMerge } from "tailwind-merge";

    let { iconTrigger }: { iconTrigger: boolean } = $props();
    let open = $state(false);
    let variant = buttonVariants({
        variant: iconTrigger ? "ghost" : "secondary",
        size: iconTrigger ? "icon" : "default",
    });
    let size = iconTrigger ? "size-7" : "";

    let folderName = $state("");
</script>

<Dialog.Root bind:open>
    <Dialog.Trigger class={twMerge(variant, size)}>
        {#if iconTrigger}
            <LucideFolderPlus />
        {:else}
            Create New Folder
        {/if}
    </Dialog.Trigger>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>Create New Folder</Dialog.Title>
        </Dialog.Header>
        <div class="grid gap-4 py-4">
            <div class="flex gap-4 py-4">
                <Input bind:value={folderName} placeholder="Folder name" />
            </div>
        </div>
        <Dialog.Footer>
            <Button
                type="submit"
                onclick={async () => {
                    if (!appContext.workspace) {
                        console.error("No workspace available");
                        toast.error("No workspace available");
                        return;
                    }
                    const name = folderName.trim();
                    if (!name) {
                        toast.error("Please enter a folder name");
                        return;
                    }
                    await appContext.workspace.createFolder(name);
                    open = false;
                    folderName = "";
                }}
            >
                Create folder
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
