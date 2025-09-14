<!-- This contains the preview -->
<script lang="ts">
  import { invoke } from "@tauri-apps/api/core"
  import Preview from "./preview.svelte"
  import { Skeleton } from "$lib/components/ui/skeleton/index.js"
  import { slide } from "svelte/transition"
  import { expoInOut } from "svelte/easing"
  import { PressedKeys } from "runed"
  import { onMount, onDestroy } from "svelte"
  import { listen } from "@tauri-apps/api/event"
  import type { RenderResponse } from "@/types"

  let { open = $bindable(false) }: { open?: boolean } = $props()

  const keys = new PressedKeys()
  keys.onKeys(["Control", "k"], () => {
    open = !open
  })

  let preview_images = $state<HTMLImageElement[]>([])
  let str = $state("")

  let lastVersion = 0

  type RenderedPagesEvent = { version: number; pages: RenderResponse[] }

  onMount(async () => {
    const unlisten = await listen<RenderedPagesEvent>(
      "rendered-pages",
      (event) => {
        const { version, pages } = event.payload
        if (version < lastVersion) return
        lastVersion = version

        let imgs: HTMLImageElement[] = []
        for (const page of pages) {
          const img = new Image()
          img.src = `data:image/png;base64,${page.image}`
          img.width = page.width
          img.height = page.height
          imgs.push(img)
        }
        preview_images = imgs
      }
    )
  })
</script>

<!-- Animate when the sidebar opens -->
{#if open}
  <div>
    <Preview
      pages={preview_images || []}
      onclick={(event, index, x, y) => {}}
    />
  </div>
{/if}
