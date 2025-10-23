<script lang="ts">
    import { editorStore, previewStore } from "@/store/index.svelte";
    import { watch, IsInViewport, ElementRect } from "runed";
    type Props = {
        image: HTMLImageElement;
        index: number;
        onclick?: (
            event: MouseEvent,
            page: number,
            x: number,
            y: number,
        ) => void;
    };
    let { image, index, onclick }: Props = $props();
    let dpr = $state(1);

    let canvas: HTMLCanvasElement = $state()!;
    let rect = new ElementRect(() => canvas);
    const inViewport = new IsInViewport(() => canvas);

    watch(
        () => [editorStore.file_path],
        () => {
            const ctx = canvas.getContext("2d");
            if (ctx) {
                const naturalWidth = image.naturalWidth;
                const naturalHeight = image.naturalHeight;
                const displayWidth =
                    (image.width || naturalWidth) * previewStore.zoom;
                const displayHeight =
                    (image.height || naturalHeight) * previewStore.zoom;
                // internal canvas resolution considers zoom & dpr for sharpness
                const cw = displayWidth * dpr;
                const ch = displayHeight * dpr;
                if (canvas.width !== cw || canvas.height !== ch) {
                    canvas.width = cw;
                    canvas.height = ch;
                }
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr * previewStore.zoom, dpr * previewStore.zoom);
                ctx.clearRect(0, 0, naturalWidth, naturalHeight);
                ctx.drawImage(image, 0, 0);
                ctx.restore();
            }
            // previewStore.current_index = index;
        },
    );

    function handleClick(event: MouseEvent) {
        const c = event.target! as HTMLCanvasElement;
        const rect = c.getBoundingClientRect();

        // 1. Calculate the click position relative to the element's position on the page
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // 2. Calculate the scaling ratio between the canvas's internal resolution and its display size
        const scaleX = c.width / rect.width;
        const scaleY = c.height / rect.height;

        // 3. Apply the ratio to get the final, accurate coordinates on the canvas's drawing surface
        const x = mouseX / previewStore.zoom;
        const y = mouseY / previewStore.zoom;

        console.log(`Click coordinates on canvas: x=${x}, y=${y}`);
        if (onclick) {
            onclick(event, index, x, y);
        }
    }
</script>

<canvas
    bind:this={canvas}
    width={image.width}
    height={image.height}
    style="height: {image.height}px; width: {image.width}px;"
    onclick={handleClick}
>
</canvas>
