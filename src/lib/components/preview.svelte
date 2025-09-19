<script lang="ts">
  import { ScrollArea } from "$lib/components/ui/scroll-area"
  type Props = {
    pages: HTMLImageElement[]
    onclick: (event: MouseEvent, page: number, x: number, y: number) => void
  }

  let { onclick, pages }: Props = $props()

  // Hold references to per-page canvas elements
  let canvasEls: HTMLCanvasElement[] = []
  let dpr = $state(1)
  let zoom = $state(1) // 1 = 100%
  const MIN_ZOOM = 0.25
  const MAX_ZOOM = 4
  const ZOOM_STEP = 0.1

  export function zoomIn() {
    zoom = Math.min(MAX_ZOOM, +(zoom + ZOOM_STEP).toFixed(3))
  }
  export function zoomOut() {
    zoom = Math.max(MIN_ZOOM, +(zoom - ZOOM_STEP).toFixed(3))
  }
  export function resetZoom() {
    zoom = 1
  }
  if (typeof window !== "undefined") {
    dpr = window.devicePixelRatio || 1
    // Listen for DPR changes (e.g., dragging window between monitors)
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mq.addEventListener?.("change", () => {
      dpr = window.devicePixelRatio || 1
    })
  }

  // Redraw canvases whenever pages array changes or DPR updates.
  // Each entry in `pages` is still an HTMLImageElement produced elsewhere; we now
  // use it only as a bitmap source, drawing into a high-DPR canvas for sharper text.
  $effect(() => {
    if (!(pages && pages.length)) return
    pages.forEach((img, index) => {
      const canvas = canvasEls[index]
      if (!canvas || !img || !img.complete) return
      const naturalWidth = img.naturalWidth
      const naturalHeight = img.naturalHeight
      const displayWidth = (img.width || naturalWidth) * zoom
      const displayHeight = (img.height || naturalHeight) * zoom
      // internal canvas resolution considers zoom & dpr for sharpness
      const cw = displayWidth * dpr
      const ch = displayHeight * dpr
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
      }
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr * zoom, dpr * zoom)
      ctx.clearRect(0, 0, naturalWidth, naturalHeight)
      ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight)
      ctx.restore()
    })
  })
</script>

<ScrollArea orientation="both" class="h-95svh w-full">
  <div class="flex flex-col gap-6">
    {#if pages && pages.length > 0}
      {#each pages as page, index}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          onclick={(event) => {
            const canvas = event.target as HTMLCanvasElement
            const rect = canvas.getBoundingClientRect()
            const displayX = event.clientX - rect.left
            const displayY = event.clientY - rect.top
            // convert back to natural coordinates by dividing by zoom
            const x = displayX / zoom
            const y = displayY / zoom
            console.log(
              `Click coordinates for page ${index} (canvas):\n  Display: ${displayX.toFixed(1)}, ${displayY.toFixed(1)} (size: ${rect.width.toFixed(1)}x${rect.height.toFixed(1)})\n  Natural: ${x.toFixed(1)}, ${y.toFixed(1)} (image size: ${page.naturalWidth}x${page.naturalHeight})\n  Zoom: ${(zoom * 100).toFixed(0)}%`
            )
            onclick(event, index, x, y)
          }}
          style="height: {page.height * zoom}px; width: {page.width * zoom}px;"
        >
          <canvas
            bind:this={canvasEls[index]}
            width={page.width * zoom * dpr}
            height={page.height * zoom * dpr}
            style={"width: {page.width * zoom}px; height: {page.height * zoom}px; display: block; margin: 0 auto;"}
          ></canvas>
        </div>
      {/each}
    {:else}
      <p class="text-center">No pages available for preview.</p>
    {/if}
  </div>
</ScrollArea>

<style>
  div {
    height: 94svh;
    width: 100%;
  }
</style>
