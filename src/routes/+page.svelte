<script lang="ts">
  import { appState } from "@/states.svelte"
  import PreviewPane from "@/components/preview-pane.svelte"

  import type { LayoutData } from "./$types"

  import Editor from "@/components/editor.svelte"
  import NoSelectedFile from "@/components/no-selected-file.svelte"
  import * as Resizable from "$lib/components/ui/resizable/index.js"
  import Filetree from "@/components/filetree.svelte"
  import Diagnostics from "@/components/diagnostics.svelte"

  let { data }: { data: LayoutData } = $props()
</script>

<main class="flex-1 w-screen">
  <Resizable.PaneGroup class="border h-full w-full" direction="horizontal">
    {#if appState.isFileTreeOpen}
      <Resizable.Pane defaultSize={15}>
        <Filetree />
      </Resizable.Pane>
      <Resizable.Handle withHandle />
    {/if}

    <Resizable.Pane>
      <Resizable.PaneGroup direction="horizontal">
        <Resizable.Pane class="flex-1 min-h-md">
          {@render EditorAndDiagnosticGroup()}
        </Resizable.Pane>
        {#if appState.isPreviewPaneOpen}
          <Resizable.Handle withHandle />
          <Resizable.Pane defaultSize={45}>
            <PreviewPane />
          </Resizable.Pane>
        {/if}
      </Resizable.PaneGroup>
    </Resizable.Pane>
  </Resizable.PaneGroup>
</main>

{#snippet EditorAndDiagnosticGroup()}
  <Resizable.PaneGroup direction="vertical">
    <Resizable.Pane>
      <div class="h-full">
        {#if appState.currentFilePath !== ""}
          <Editor />
        {:else}
          <NoSelectedFile />
        {/if}
      </div>
    </Resizable.Pane>
    {#if appState.isDiagnosticsOpen}
      <Resizable.Handle withHandle />
      <Resizable.Pane defaultSize={30}>
        <Diagnostics />
      </Resizable.Pane>
    {/if}
  </Resizable.PaneGroup>
{/snippet}
