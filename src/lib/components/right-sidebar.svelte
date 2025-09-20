<!-- This contains the preview -->
<script lang="ts">
  import { invoke } from "@tauri-apps/api/core"
  import Preview from "./preview.svelte"
  import { Skeleton } from "$lib/components/ui/skeleton/index.js"
  import { slide } from "svelte/transition"
  import { expoInOut } from "svelte/easing"
  import { PressedKeys } from "runed"
  import { onMount, onDestroy } from "svelte"
  import { listen, type UnlistenFn } from "@tauri-apps/api/event"
  import type { RenderResponse } from "@/types"
  import { app } from "@/states.svelte"

  let { open = $bindable(false) }: { open?: boolean } = $props()

  function pxToPt(pixels: number): number {
    const DPI_ASSUMPTION = 96 // Standard DPI for CSS pixels
    const devicePixelRatio = window.devicePixelRatio || 1

    // Calculate physical pixels
    const physicalPixels = pixels * devicePixelRatio

    // Convert physical pixels to points
    const points = (physicalPixels / DPI_ASSUMPTION) * 72
    return points
  }

  const keys = new PressedKeys()
  keys.onKeys(["Control", "k"], () => {
    open = !open
  })

  let preview_images = $state<HTMLImageElement[]>([])
  let str = $state("")

  let lastVersion = 0

  type RenderedPagesEvent = RenderResponse[]

  let unlisten: UnlistenFn | undefined = undefined

  onDestroy(() => {
    if (unlisten) {
      unlisten()
    }
  })

  onMount(async () => {
    unlisten = await listen<RenderedPagesEvent>("rendered-pages", (event) => {
      let imgs: HTMLImageElement[] = []
      for (const page of event.payload) {
        const img = new Image()
        img.src = `data:image/png;base64,${page.image}`
        img.width = page.width
        img.height = page.height
        imgs.push(img)
      }
      preview_images = imgs
    })
  })
</script>

<!-- Animate when the sidebar opens -->
{#if open}
  <div>
    <Preview
      pages={preview_images || []}
      onclick={async (event, index, x, y) => {
        try {
          let result = await invoke("page_click", {
            page_number: index,
            x: x,
            y: y,
            source_text: app.text,
          })
          console.log("Result from page_click:", result)
          app.moveEditorCursor(result as number)
        } catch (error) {
          console.error("Error invoking page_click:", error)
        }
      }}
    />
  </div>
{/if}
