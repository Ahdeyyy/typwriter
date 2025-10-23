<script lang="ts">
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import * as Empty from "$lib/components/ui/empty/index";
    // import { appContext } from "@/app-context.svelte";
    // import { getFileType } from "@/utils";
    import { editorStore, previewStore } from "@/store/index.svelte";
    type Props = {
        onclick: (
            event: MouseEvent,
            page: number,
            x: number,
            y: number,
        ) => void;
    };

    let { onclick }: Props = $props();
    // let pages = $derived.by(() => {
    // if (!appContext.workspace) return [];
    // return appContext.workspace.renderedContent;
    // });

    // Hold references to per-page canvas elements
    let canvasEls: HTMLCanvasElement[] = $state([]);
    // Hold references to per-page wrapper divs (for scroll calculations)
    let pageWrappers: HTMLDivElement[] = $state([]);
    // Reference to scroll area viewport element
    let scrollViewport = $state<HTMLElement>();

    // Initialize ScrollState with the viewport element

    let dpr = $state(1);
    let zoom = $state(1); // 1 = 100%
    const MIN_ZOOM = 0.25;
    const MAX_ZOOM = 4;
    const ZOOM_STEP = 0.1;

    export function zoomIn() {
        zoom = Math.min(MAX_ZOOM, +(zoom + ZOOM_STEP).toFixed(3));
    }
    export function zoomOut() {
        zoom = Math.max(MIN_ZOOM, +(zoom - ZOOM_STEP).toFixed(3));
    }
    export function resetZoom() {
        zoom = 1;
    }
    if (typeof window !== "undefined") {
        dpr = window.devicePixelRatio || 1;
        // Listen for DPR changes (e.g., dragging window between monitors)
        const mq = window.matchMedia(
            `(resolution: ${window.devicePixelRatio}dppx)`,
        );
        mq.addEventListener?.("change", () => {
            dpr = window.devicePixelRatio || 1;
        });
    }

    type PreviewPositionEventPayload = {
        page: number;
        x: number;
        y: number;
    };
    // Extracted scroll-to logic so it can be reused/tested separately.
    function scrollToPreviewPosition(payload: PreviewPositionEventPayload) {
        const { page, x, y } = payload;
        // Convert 1-based page to 0-based index
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

        scrollViewport.scrollTo({
            left: Math.max(0, targetScrollLeft),
            top: Math.max(0, targetScrollTop),
            behavior: "smooth",
        });
    }

    $effect(() => {
        if (previewStore.current_position) {
            const pos = previewStore.current_position;
            if (pos) {
                scrollToPreviewPosition(pos);
            }
        }
    });
    // Redraw canvases whenever pages array changes or DPR updates.
    // Each entry in `pages` is still an HTMLImageElement produced elsewhere; we now
    // use it only as a bitmap source, drawing into a high-DPR canvas for sharper text.
    $effect(() => {
        // console.log("Redrawing canvases at zoom", zoom, "and dpr", dpr)
        if (!previewStore.items) return;
        previewStore.items.forEach((img, index) => {
            const canvas = canvasEls[index];
            if (!canvas || !img) {
                // console.warn("No canvas or image for page", index);
                return;
            }

            if (!img.complete) {
                // Image not loaded yet
                // console.warn("Image not loaded yet for page", index);
                img.onload = () => {
                    // Redraw when image loads
                    draw();
                };
            }
            draw();

            function draw() {
                const naturalWidth = img.naturalWidth;
                const naturalHeight = img.naturalHeight;
                const displayWidth = (img.width || naturalWidth) * zoom;
                const displayHeight = (img.height || naturalHeight) * zoom;
                // internal canvas resolution considers zoom & dpr for sharpness
                const cw = displayWidth * dpr;
                const ch = displayHeight * dpr;
                if (canvas.width !== cw || canvas.height !== ch) {
                    canvas.width = cw;
                    canvas.height = ch;
                }
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    console.warn("No 2D context for canvas");
                    return;
                }
                ctx.save();
                // console.log("drawing");
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr * zoom, dpr * zoom);
                ctx.clearRect(0, 0, naturalWidth, naturalHeight);
                ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
                // console.log("drawn");
                ctx.restore();
            }
        });
    });
</script>

<ScrollArea orientation="both" class="w-full h-svh">
    <div bind:this={scrollViewport} style="overflow: auto; height: 100%;">
        <div class="flex flex-col gap-4">
            {#each previewStore.items as page, index}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    bind:this={pageWrappers[index]}
                    onclick={(event) => {
                        const canvas = event.target as HTMLCanvasElement;
                        const rect = canvas.getBoundingClientRect();
                        const displayX = event.clientX - rect.left;
                        const displayY = event.clientY - rect.top;
                        // convert back to natural coordinates by dividing by zoom
                        const x = displayX / zoom;
                        const y = displayY / zoom;
                        onclick(event, index, x, y);
                    }}
                    style="height: {page.height * zoom}px; width: {page.width *
                        zoom}px;"
                >
                    <canvas
                        bind:this={canvasEls[index]}
                        width={page.width * zoom * dpr}
                        height={page.height * zoom * dpr}
                        style="width: {page.width *
                            zoom}px; height: {page.height *
                            zoom}px;  margin: 0 auto;"
                    ></canvas>
                </div>
            {:else}
                <Empty.Root
                    class="from-muted/50 to-background h-full bg-gradient-to-b from-30%"
                >
                    <Empty.Header>
                        <Empty.Title>No Preview</Empty.Title>
                        <Empty.Description
                            >No preview available.</Empty.Description
                        >
                    </Empty.Header>
                    <Empty.Content>
                        Open a .typ file and compile to see a preview here.
                    </Empty.Content>
                </Empty.Root>
            {/each}
        </div>
    </div>
</ScrollArea>

<style>
    div {
        height: 94svh;
        width: 100%;
    }
</style>
