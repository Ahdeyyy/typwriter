<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import * as Select from "$lib/components/ui/select";
    import { export_main_source } from "./export";
    import { Checkbox } from "../ui/checkbox";
    import { LucideDownload } from "@lucide/svelte";
    import { workspaceStore } from "@/store/index.svelte";

    // Svelte 5 runes for local reactive state
    let format = $state<"pdf" | "svg" | "png">("pdf");
    let merged = $state(true);
    let start_page = $state(1);
    let end_page = $state(1);

    let isSubmitting = $state(false);
    let errorMessage = $state<string | null>(null);

    function validatePages() {
        errorMessage = null;

        if (format === "svg" && merged === false) {
            if (!Number.isInteger(start_page) || start_page < 1) {
                errorMessage = "Start page must be an integer ≥ 1";
                return false;
            }
            if (!Number.isInteger(end_page) || end_page < start_page) {
                errorMessage = "End page must be an integer ≥ start page";
                return false;
            }
        }

        if (format === "png") {
            if (!Number.isInteger(start_page) || start_page < 1) {
                errorMessage = "Start page must be an integer ≥ 1";
                return false;
            }
            if (!Number.isInteger(end_page) || end_page < start_page) {
                errorMessage = "End page must be an integer ≥ start page";
                return false;
            }
        }

        return true;
    }

    function buildOptions() {
        if (format === "pdf") return { format: "pdf" } as const;
        if (format === "svg") {
            if (merged) return { format: "svg", merged: true } as const;
            return {
                format: "svg",
                merged: false,
                start_page: Number(start_page) - 1,
                end_page: Number(end_page) - 1,
            } as const;
        }
        // png
        return {
            format: "png",
            start_page: Number(start_page) - 1,
            end_page: Number(end_page) - 1,
        } as const;
    }

    async function onExport() {
        errorMessage = null;
        if (!validatePages()) return;

        const options = buildOptions();

        isSubmitting = true;
        try {
            await export_main_source(options);
            // leave dialog open so user can verify or close manually; can auto-close on success if desired
            workspaceStore.refresh();
        } catch (err: unknown) {
            errorMessage =
                err && typeof err === "object" && "message" in err
                    ? String((err as any).message)
                    : String(err);
        } finally {
            isSubmitting = false;
        }
    }

    // Helpers for numeric input normalization (used inline in the template)
    function normalizeNumberInput(value: string, fallback: number) {
        const n = Number(value);
        if (Number.isNaN(n)) return fallback;
        return Math.max(1, Math.trunc(n));
    }
</script>

<Dialog.Root>
    <Dialog.Trigger class={buttonVariants({ variant: "ghost", size: "icon" })}>
        <LucideDownload />
    </Dialog.Trigger>

    <Dialog.Content class="max-w-lg">
        <Dialog.Header>
            <Dialog.Title class="text-lg font-semibold"
                >Export options</Dialog.Title
            >
            <Dialog.Description class="text-sm text-slate-500">
                Choose an export format and optional settings for page ranges or
                merging.
            </Dialog.Description>
        </Dialog.Header>

        <div class="mt-4 space-y-4">
            <div class="flex items-center justify-between gap-4">
                <Label class="min-w-[7rem]">Format</Label>
                <div class="flex-1">
                    <Select.Root type="single" bind:value={format}>
                        <Select.Trigger
                            class="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            size="default"
                        >
                            <span data-slot="select-value" class="truncate">
                                {#if format === "pdf"}PDF{:else if format === "svg"}SVG{:else}PNG{/if}
                            </span>
                        </Select.Trigger>
                        <Select.Content>
                            <Select.Item value="pdf">PDF</Select.Item>
                            <Select.Item value="svg">SVG</Select.Item>
                            <Select.Item value="png">PNG</Select.Item>
                        </Select.Content>
                    </Select.Root>
                </div>
            </div>

            {#if format === "svg"}
                <div class="flex items-start justify-between gap-4">
                    <Label class="min-w-[7rem]">SVG output</Label>
                    <div class="flex-1 space-y-3">
                        <Label class="inline-flex items-center gap-2">
                            <Checkbox
                                bind:checked={merged}
                                class="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/50"
                            />
                            <span class="text-sm"
                                >Merge all pages into one SVG</span
                            >
                        </Label>

                        {#if !merged}
                            <div class="flex gap-3">
                                <div class="flex flex-col gap-1">
                                    <Label class="text-xs">Start page</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        class="w-28 text-sm"
                                        bind:value={start_page}
                                        oninput={(e) =>
                                            (start_page = normalizeNumberInput(
                                                (e.target as HTMLInputElement)
                                                    .value,
                                                start_page,
                                            ))}
                                    />
                                </div>

                                <div class="flex flex-col gap-1">
                                    <Label class="text-xs">End page</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        class="w-28 text-sm"
                                        bind:value={end_page}
                                        oninput={(e) =>
                                            (end_page = normalizeNumberInput(
                                                (e.target as HTMLInputElement)
                                                    .value,
                                                end_page,
                                            ))}
                                    />
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            {:else if format === "png"}
                <div class="flex items-start justify-between gap-4">
                    <Label class="min-w-[7rem]">Page range</Label>
                    <div class="flex gap-3">
                        <div class="flex flex-col gap-1">
                            <Label class="text-xs">Start page</Label>
                            <Input
                                type="number"
                                min="1"
                                class="w-28 text-sm"
                                bind:value={start_page}
                                oninput={(e) =>
                                    (start_page = normalizeNumberInput(
                                        (e.target as HTMLInputElement).value,
                                        start_page,
                                    ))}
                            />
                        </div>

                        <div class="flex flex-col gap-1">
                            <Label class="text-xs">End page</Label>
                            <Input
                                type="number"
                                min="1"
                                class="w-28 text-sm"
                                bind:value={end_page}
                                oninput={(e) =>
                                    (end_page = normalizeNumberInput(
                                        (e.target as HTMLInputElement).value,
                                        end_page,
                                    ))}
                            />
                        </div>
                    </div>
                </div>
            {/if}

            {#if errorMessage}
                <div class="text-sm text-red-600">{errorMessage}</div>
            {/if}
        </div>

        <Dialog.Footer class="mt-6">
            <div class="flex items-center justify-end gap-3 w-full">
                <Dialog.Close class={buttonVariants({ variant: "outline" })}>
                    Cancel
                </Dialog.Close>

                <Button
                    variant="default"
                    size="sm"
                    onclick={onExport}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? "Exporting…" : "Export"}
                </Button>
            </div>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
