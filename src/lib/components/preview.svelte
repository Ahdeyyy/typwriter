<script lang="ts">
  import { ScrollArea } from "$lib/components/ui/scroll-area"
  import { appState } from "@/states.svelte"
  import { listen } from "@tauri-apps/api/event"
  import { onMount } from "svelte"
  type Props = {
    pages: HTMLImageElement[]
    onclick: (event: MouseEvent, page: number, x: number, y: number) => void
  }

  let { onclick, pages }: Props = $props()

  // Hold references to per-page canvas elements
  let canvasEls: HTMLCanvasElement[] = []
  // Hold references to per-page wrapper divs (for scroll calculations)
  let pageWrappers: HTMLDivElement[] = []
  // Reference to scroll area root element (bits-ui root). We'll query its viewport child.
  let scrollAreaRef: HTMLElement | null = $state<HTMLElement | null>(null)
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

  type PreviewPositionEventPayload = {
    page: number
    x: number
    y: number
  }
  onMount(() => {
    let unlisten = listen<PreviewPositionEventPayload>(
      "preview-position",
      (event) => {
        const { page, x, y } = event.payload
        // Convert 1-based page to 0-based index
        const pageIndex = page - 1

        if (
          !scrollAreaRef ||
          !pageWrappers[pageIndex] ||
          pageIndex < 0 ||
          pageIndex >= pageWrappers.length
        )
          return

        const viewport = scrollAreaRef.querySelector(
          "[data-slot=scroll-area-viewport]"
        ) as HTMLElement
        if (!viewport) return

        const wrapper = pageWrappers[pageIndex]

        // Get the container that holds all pages (the flex column)
        const container = wrapper.parentElement
        if (!container) return

        // Calculate position relative to the container's top-left
        const containerRect = container.getBoundingClientRect()
        const wrapperRect = wrapper.getBoundingClientRect()

        // Position within the page (scaled coordinates)
        const scaledX = x * zoom
        const scaledY = y * zoom

        // Absolute position within the container
        const absoluteX = wrapperRect.left - containerRect.left + scaledX
        const absoluteY = wrapperRect.top - containerRect.top + scaledY

        // Center the target position in the viewport
        const targetScrollLeft = absoluteX - viewport.clientWidth / 2
        const targetScrollTop = absoluteY - viewport.clientHeight / 2

        viewport.scrollTo({
          left: Math.max(0, targetScrollLeft),
          top: Math.max(0, targetScrollTop),
          behavior: "smooth",
        })

        console.log(
          `Scrolling to page ${page} at (${x.toFixed(1)}, ${y.toFixed(1)}) => scroll to (${targetScrollLeft.toFixed(1)}, ${targetScrollTop.toFixed(1)})`
        )
      }
    )

    // Clean up the event listener when component is destroyed
    return () => {
      unlisten.then((fn) => fn())
    }
  })

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

<ScrollArea orientation="both" class="w-full h-svh" bind:ref={scrollAreaRef}>
  {#if appState.canCompileFile}
    <div class="flex flex-col gap-6">
      {#each pages as page, index}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={pageWrappers[index]}
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
      {:else}
        <div class="flex h-full w-full items-center justify-center">
          <p class="text-center text-muted-foreground">No preview available.</p>
        </div>
      {/each}
    </div>
  {:else}
    <div class="flex h-full w-full items-center justify-center">
      <p class="text-center text-muted-foreground">
        Preview is available only for .typ files.
      </p>
    </div>
  {/if}
</ScrollArea>

<style>
  div {
    height: 94svh;
    width: 100%;
  }
</style>
