<script lang="ts">
    import { previewStore } from "@/store/index.svelte";
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

    let canvas: HTMLCanvasElement = $state()!;
    let rect = new ElementRect(() => canvas);
    const inViewport = new IsInViewport(() => canvas);

    watch(
        () => [inViewport, previewStore.items],
        () => {
            if (inViewport.current) {
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.save();
                    ctx.clearRect(0, 0, image.width, image.height);
                    ctx.drawImage(image, 0, 0);
                    ctx.restore();
                }
                previewStore.current_index = index;
            }
        },
    );

    function handleClick(event: MouseEvent) {
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (onclick) {
            onclick(event, index, x, y);
        }
    }
</script>

<canvas
    bind:this={canvas}
    width={image.width}
    height={image.height}
    class="w-full h-auto"
    onclick={handleClick}
>
</canvas>
