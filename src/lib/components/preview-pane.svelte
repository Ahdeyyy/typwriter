<!-- This contains the preview -->
<script lang="ts">
  import Preview from "./preview.svelte"
  import { PressedKeys } from "runed"
  import { appContext } from "@/app-context.svelte"
  import { app } from "@tauri-apps/api"

  const keys = new PressedKeys()
  keys.onKeys(["Control", "k"], () => {
    appContext.isPreviewOpen = !appContext.isPreviewOpen
  })

  let preview_images = $state([] as HTMLImageElement[])

  $effect(() => {
    if (
      appContext.workspace &&
      appContext.workspace.document &&
      appContext.workspace.document.renderedContent &&
      appContext.workspace.document.content
    ) {
      preview_images = appContext.workspace.document.renderedContent.map(
        (page, _) => {
          let img = new Image()
          img.src = `data:image/png;base64,${page.image}`
          img.width = page.width
          img.height = page.height
          return img
        }
      ) as HTMLImageElement[]
    }
  })
</script>

<div class="px-4">
  <Preview
    pages={appContext.workspace?.renderedContent || []}
    onclick={async (event, index, x, y) => {
      if (!appContext.workspace) {
        console.error("No workspace is open")
        return
      }
      if (!appContext.workspace.document) {
        console.error("No document is open")
        return
      }
      await appContext.workspace.document.previewPageClick(x, y, index)
    }}
  />
</div>
