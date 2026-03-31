<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";

  import AppSidebar from "$lib/components/sidebar/app-sidebar.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";

  onMount(() => { diagnostics.init(); });
  onDestroy(() => { diagnostics.destroy(); });
</script>

<Tooltip.Provider delayDuration={0}>
  <div class="flex h-screen w-screen overflow-hidden">
    <AppSidebar />

    <main class="flex-1 h-full overflow-hidden">
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
  </div>
</Tooltip.Provider>
