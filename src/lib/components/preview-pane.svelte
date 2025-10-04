<!-- This contains the preview -->
<script lang="ts">
  import { invoke } from "@tauri-apps/api/core"
  import Preview from "./preview.svelte"
  import { PressedKeys } from "runed"
  import { onMount, onDestroy } from "svelte"
  import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event"
  import type { RenderResponse } from "@/types"
  import { appState } from "@/states.svelte"
  import { page_click } from "@/ipc"
  import { openUrl } from "@tauri-apps/plugin-opener"

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
    appState.isPreviewPaneOpen = !appState.isPreviewPaneOpen
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

<div class="px-4">
  <Preview
    pages={preview_images || []}
    onclick={async (event, index, x, y) => {
      let result = await page_click(index, appState.text, x, y)

      if (result.isErr()) {
        console.error(result.error)
        return
      }

      switch (result.value.type) {
        case "FileJump":
          appState.moveEditorCursor(result.value.position)
          console.log(result.value)
          break
        case "PositionJump":
          emit("preview-position", {
            page: result.value.page,
            x: result.value.x,
            y: result.value.y,
          })
          console.log(result.value)
          break
        case "UrlJump":
          openUrl(result.value.url)
          break
        case "NoJump":
          console.log("no jump")
          break
      }

      console.log("Result from page_click:", result)
    }}
  />
</div>
