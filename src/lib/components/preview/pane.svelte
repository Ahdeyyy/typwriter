<script lang="ts">
    import { editorStore, previewStore } from "@/store/index.svelte";
    import { getFileType } from "@/utils";
    import TypRenderer from "./renderer/typ.svelte";
    import SvgRenderer from "./renderer/svg.svelte";
    import ImgRenderer from "./renderer/image.svelte";
    import { ScrollArea } from "@/components/ui/scroll-area";

    const file_type = $derived(getFileType(editorStore.file_path || ""));
</script>

<ScrollArea orientation="both" class="h-full w-full">
    {#if file_type === "typ"}
        {#each previewStore.items as image, index}
            <TypRenderer {image} {index} />
        {/each}
    {:else if file_type === "svg"}
        <SvgRenderer />
    {:else if file_type === "png" || file_type === "jpg" || file_type === "jpeg" || file_type === "gif" || file_type === "bmp" || file_type === "webp"}
        <ImgRenderer />
    {:else}
        <div
            class="flex h-full w-full flex-col items-center justify-center gap-2"
        >
            <p class="text-muted-foreground">
                No preview available for this file type.
            </p>
            <p class="text-sm text-muted-foreground">
                Supported types: .typ, .svg, .png, .jpg, .jpeg, .gif, .bmp,
                .webp
            </p>
        </div>
    {/if}
</ScrollArea>
