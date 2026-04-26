<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";

  import AppSidebar from "$lib/components/sidebar/app-sidebar.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";

  onMount(() => { diagnostics.init(); });
  onDestroy(() => { diagnostics.destroy(); });
</script>

<Sidebar.Provider class="h-screen w-screen overflow-hidden">
  <AppSidebar />
  <main class="flex h-full min-w-0 flex-1 overflow-hidden">
    <Resizable.PaneGroup direction="horizontal" class="h-full w-full">
      <Resizable.Pane defaultSize={60} minSize={30}>
        <EditorPane />
      </Resizable.Pane>

      <Resizable.Handle />

      <Resizable.Pane defaultSize={40} minSize={15} maxSize={60}>
        <div class="h-full border-l border-border bg-background">
          <Preview />
        </div>
      </Resizable.Pane>
    </Resizable.PaneGroup>
  </main>
</Sidebar.Provider>
