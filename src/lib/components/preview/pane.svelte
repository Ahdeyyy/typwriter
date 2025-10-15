<script lang="ts">
    import {
        editorStore,
        previewPageClick,
        previewStore,
    } from "@/store/index.svelte";
    import { getFileType } from "@/utils";
    import TypRenderer from "./renderer/typ.svelte";
    import SvgRenderer from "./renderer/svg.svelte";
    import ImgRenderer from "./renderer/image.svelte";
    import { ScrollArea } from "@/components/ui/scroll-area";
    import { ScrollState, watch } from "runed";

    const file_type = $derived(getFileType(editorStore.file_path || ""));

    let scroll_area_root = $state<HTMLElement>();
    // let scroll = ScrollState(() => scroll_viewport)
    let scrollViewport = $state<HTMLElement | undefined>(undefined);
    let canvases: HTMLCanvasElement[] = $state([]);
    let pageWrappers: HTMLDivElement[] = $state([]);

    $effect(() => {
        scroll_area_root =
            document.querySelector<HTMLElement>("[data-scroll-area-root]") ||
            undefined;
        // if (scroll_area_root) {
        // scroll_viewport =
        // scroll_area_root.querySelector<HTMLElement>(
        // "[data-scroll-area-viewport]",
        // ) || undefined;
        // }
    });

    const scroll = new ScrollState({
        element: () => scrollViewport,
    });

    watch(
        () => previewStore.current_position,
        () => {
            const { page, x, y } = previewStore.current_position;
            const zoom = previewStore.zoom;
            const pageIndex = page - 1;
            if (
                !scrollViewport ||
                !pageWrappers[pageIndex] ||
                pageIndex < 0 ||
                pageIndex >= pageWrappers.length
            )
                return;

            const wrapper = pageWrappers[pageIndex];

            // Get the container that holds all pages (the flex column)
            const container = wrapper.parentElement;
            if (!container) return;

            // Calculate position relative to the container's top-left
            const containerRect = container.getBoundingClientRect();
            const wrapperRect = wrapper.getBoundingClientRect();

            // Position within the page (scaled coordinates)
            const scaledX = x * zoom;
            const scaledY = y * zoom;

            // Absolute position within the container
            const absoluteX = wrapperRect.left - containerRect.left + scaledX;
            const absoluteY = wrapperRect.top - containerRect.top + scaledY;

            // Center the target position in the viewport
            const targetScrollLeft = absoluteX - scrollViewport.clientWidth / 2;
            const targetScrollTop = absoluteY - scrollViewport.clientHeight / 2;

            console.log("scroll to", {
                top: targetScrollTop,
                left: targetScrollLeft,
            });

            // scrollViewport.scrollTo({
            //     left: Math.max(0, targetScrollLeft),
            //     top: Math.max(0, targetScrollTop),
            //     behavior: "smooth",
            // });

            scroll.scrollTo(0, targetScrollTop);
        },
    );
</script>

{#if file_type === "typ"}
    <ScrollArea orientation="both" class="h-svh w-full">
        <div bind:this={scrollViewport} class="overflow-auto h-full">
            <div class="flex flex-col gap-2">
                {#each previewStore.items as image, index (index)}
                    <TypRenderer
                        {image}
                        {index}
                        mount={(c, w) => {
                            canvases[index] = c;
                            pageWrappers[index] = w;
                        }}
                        onclick={(e, page, x, y) => {
                            // console.log(page, x, y);
                            previewPageClick(x, y, page);
                        }}
                    />
                {/each}
            </div>
        </div>
    </ScrollArea>
{:else if file_type === "svg"}
    <SvgRenderer />
{:else if file_type === "png" || file_type === "jpg" || file_type === "jpeg" || file_type === "gif" || file_type === "bmp" || file_type === "webp"}
    <ImgRenderer />
{:else}
    <div class="flex h-full w-full flex-col items-center justify-center gap-2">
        <p class="text-muted-foreground">
            No preview available for this file type.
        </p>
        <p class="text-sm text-muted-foreground">
            Supported types: .typ, .svg, .png, .jpg, .jpeg, .gif, .bmp, .webp
        </p>
    </div>
{/if}
