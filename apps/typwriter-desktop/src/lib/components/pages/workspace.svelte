<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";

  import AppSidebar from "$lib/components/sidebar/app-sidebar.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { workspace, basename } from "$lib/stores/workspace.svelte";

  let previewVisible = $state(true);

  const workspaceName = $derived(
    workspace.rootPath ? basename(workspace.rootPath) : "Typwriter"
  );
  const openedName = $derived(
    workspace.activeFilePath ? basename(workspace.activeFilePath) : undefined
  );

  onMount(() => { diagnostics.init(); });
  onDestroy(() => { diagnostics.destroy(); });
</script>

<Sidebar.Provider class="has-titlebar h-screen w-screen flex-col overflow-hidden">
  <Titlebar
    variant="workspace"
    title={workspaceName}
    subtitle={openedName}
    bind:previewVisible
    onTogglePreview={() => (previewVisible = !previewVisible)}
  />

  <div class="flex min-h-0 w-full flex-1">
    <AppSidebar />
    <main class="flex h-full min-w-0 flex-1 overflow-hidden">
      <Resizable.PaneGroup direction="horizontal" class="h-full w-full">
        <Resizable.Pane defaultSize={previewVisible ? 60 : 100} minSize={30}>
          <EditorPane />
        </Resizable.Pane>

        {#if previewVisible}
          <Resizable.Handle />

          <Resizable.Pane defaultSize={40} minSize={30} maxSize={60}>
            <div class="h-full border-l border-border bg-background">
              <Preview />
            </div>
          </Resizable.Pane>
        {/if}
      </Resizable.PaneGroup>
    </main>
  </div>
</Sidebar.Provider>
