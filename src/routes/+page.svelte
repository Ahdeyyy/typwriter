<script lang="ts">
  import { writeTextFile } from "@tauri-apps/plugin-fs"
  import { invoke } from "@tauri-apps/api/core"
  import { EditorView, ViewUpdate } from "@codemirror/view"
  import { useDebounce } from "runed"
  import { onMount } from "svelte"
  import { app } from "@/states.svelte"
  import RightSidebar from "@/components/right-sidebar.svelte"
  import { Button } from "@/components/ui/button"
  import type { LayoutData } from "./$types"
  import Diagnostics from "@/components/diagnostics.svelte"
  import { compile, saveTextToFile } from "@/utils"
  import Editor from "@/components/editor.svelte"

  let { data }: { data: LayoutData } = $props()
</script>

<main class="container p-2 max-h-screen">
  <div
    class={["gap-2", "relative ", app.isPreviewPaneOpen && "grid grid-cols-2"]}
  >
    <Editor />
    <RightSidebar bind:open={app.isPreviewPaneOpen} />
  </div>
</main>
