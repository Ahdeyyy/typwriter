<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { LucideFilePlus } from "@lucide/svelte";
    import { Input } from "$lib/components/ui/input";
    import FileTypeCombobox from "./file-type-combobox.svelte";
    import { toast } from "svelte-sonner";
    import { twMerge } from "tailwind-merge";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import { workspaceStore } from "@/store/index.svelte";

    let { iconTrigger }: { iconTrigger: boolean } = $props();
    let open = $state(false);
    let variant = buttonVariants({
        variant: iconTrigger ? "ghost" : "secondary",
        size: iconTrigger ? "icon" : "default",
    });
    let size = iconTrigger ? "size-7" : "";

    let fileDetails = $state({ name: "", type: "typ" });
</script>

<Dialog.Root bind:open>
    <Dialog.Trigger class={twMerge(variant, size)}>
        <Tooltip.Provider>
            <Tooltip.Root>
                <Tooltip.Trigger>
                    {#if iconTrigger}
                        <LucideFilePlus />
                    {:else}
                        Create New File
                    {/if}
                </Tooltip.Trigger>
                <Tooltip.Content>
                    <p>Create a new file</p>
                </Tooltip.Content>
            </Tooltip.Root>
        </Tooltip.Provider>
    </Dialog.Trigger>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>Create New File</Dialog.Title>
        </Dialog.Header>
        <div class="grid gap-4 py-4">
            <div class="flex gap-4 py-4">
                <Input placeholder="File name" bind:value={fileDetails.name} />
                <FileTypeCombobox bind:value={fileDetails.type} />
            </div>
        </div>
        <Dialog.Footer>
            <Button
                type="submit"
                onclick={async () => {
                    if (!workspaceStore.name) {
                        toast.error("No workspace available");
                        return;
                    }
                    const name = fileDetails.name.trim();
                    const type = fileDetails.type.trim();
                    if (name && type) {
                        const fileName = name.endsWith(`.${type}`)
                            ? name
                            : `${name}.${type}`;
                        await workspaceStore.createFile(fileName, false);
                        open = false;
                    }
                }}>Create file</Button
            >
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
