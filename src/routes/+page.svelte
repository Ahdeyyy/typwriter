<script lang="ts">
  import { writeTextFile } from "@tauri-apps/plugin-fs"
  import { invoke } from "@tauri-apps/api/core"
  import { EditorView, ViewUpdate } from "@codemirror/view"
  import { useDebounce } from "runed"
  import { onMount } from "svelte"
  import { appState } from "@/states.svelte"
  import RightSidebar from "@/components/right-sidebar.svelte"
  import { Button } from "@/components/ui/button"
  import type { LayoutData } from "./$types"
  import Diagnostics from "@/components/diagnostics.svelte"
  import { compile, saveTextToFile } from "@/utils"
  import Editor from "@/components/editor.svelte"
  import NoSelectedFile from "@/components/no-selected-file.svelte"

  let { data }: { data: LayoutData } = $props()
</script>

<main class="container p-2 max-h-screen">
  <div
    class={[
      "gap-2",
      "relative ",
      appState.isPreviewPaneOpen && "grid grid-cols-2",
    ]}
  >
    {#if appState.currentFilePath !== ""}
      <Editor />
    {:else}
      <NoSelectedFile />
    {/if}
    <RightSidebar bind:open={appState.isPreviewPaneOpen} />
  </div>
</main>
