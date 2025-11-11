<script lang="ts">
    import CheckIcon from "@lucide/svelte/icons/check";
    import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
    import { tick } from "svelte";
    import * as Command from "$lib/components/ui/command";
    import * as Popover from "$lib/components/ui/popover";
    import { Button } from "$lib/components/ui/button";
    import { cn } from "$lib/utils.js";
    let fileTypes = [
        { value: "typ", label: "typ" },
        { value: "yml", label: "yaml or yml" },
        { value: "bib", label: "bib" },
        { value: "json", label: "json" },
        { value: "xml", label: "xml" },
        { value: "csv", label: "csv" },
        { value: "toml", label: "toml" },
        { value: "cbor", label: "cbor" },
        { value: "txt", label: "text file" },
    ];

    let { value = $bindable() }: { value: string } = $props();
    let open = $state(false);
    let triggerRef = $state<HTMLButtonElement>(null!);

    const selectedValue = $derived(
        fileTypes.find((f) => f.value === value)?.label,
    );

    // We want to refocus the trigger button when the user selects
    // an item from the list so users can continue navigating the
    // rest of the form with the keyboard.
    function closeAndFocusTrigger() {
        open = false;
        tick().then(() => {
            triggerRef.focus();
        });
    }
</script>

<Popover.Root bind:open>
    <Popover.Trigger bind:ref={triggerRef}>
        {#snippet child({ props })}
            <Button
                variant="outline"
                class="w-[200px] justify-between"
                {...props}
                role="combobox"
                aria-expanded={open}
            >
                {selectedValue || "Select a file type..."}
                <ChevronsUpDownIcon class="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
        {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[200px] p-0">
        <Command.Root>
            <Command.Input placeholder="Search file types..." />
            <Command.List>
                <Command.Empty>No file type found.</Command.Empty>
                <Command.Group>
                    {#each fileTypes as fileType}
                        <Command.Item
                            value={fileType.value}
                            onSelect={() => {
                                value = fileType.value;
                                closeAndFocusTrigger();
                            }}
                        >
                            <CheckIcon
                                class={cn(
                                    "mr-2 size-4",
                                    value !== fileType.value &&
                                        "text-transparent",
                                )}
                            />
                            {fileType.label}
                        </Command.Item>
                    {/each}
                </Command.Group>
            </Command.List>
        </Command.Root>
    </Popover.Content>
</Popover.Root>
