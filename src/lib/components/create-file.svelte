<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { LucideFilePlus } from "@lucide/svelte";
    import { Input } from "$lib/components/ui/input";
    import FileTypeCombobox from "./file-type-combobox.svelte";
    import { appContext } from "@/app-context.svelte";
    import { toast } from "svelte-sonner";
    import { cn } from "tailwind-variants";
    import { twMerge } from "tailwind-merge";

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
        {#if iconTrigger}
            <LucideFilePlus />
        {:else}
            Create New File
        {/if}
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
                    if (!appContext.workspace) {
                        console.error("No workspace available");
                        toast.error("No workspace available");
                        return;
                    }
                    const name = fileDetails.name.trim();
                    const type = fileDetails.type.trim();
                    if (name && type) {
                        const fileName = name.endsWith(`.${type}`)
                            ? name
                            : `${name}.${type}`;
                        await appContext.workspace.createFile(fileName);
                        open = false;
                    }
                }}>Create file</Button
            >
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
