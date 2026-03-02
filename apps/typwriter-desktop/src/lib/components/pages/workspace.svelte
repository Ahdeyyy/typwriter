<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { PanelLeft } from "@lucide/svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";

  import FileTree from "$lib/components/sidebar/filetree.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";

  let leftPaneRef = $state<any>(null);
  let sidebarOpen = $state(true);

  onMount(() => { diagnostics.init(); });
  onDestroy(() => { diagnostics.destroy(); });

  function toggleSidebar() {
    sidebarOpen ? leftPaneRef?.collapse() : leftPaneRef?.expand();
  }
</script>

<div class="relative flex h-screen w-screen overflow-hidden">
  {#if !sidebarOpen}
    <button
      class="absolute top-1 left-2 z-50 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      onclick={toggleSidebar}
      title="Show file explorer"
    >
      <PanelLeft class="size-4" />
    </button>
  {/if}

  <Resizable.PaneGroup direction="horizontal" class="h-full w-full">
    <Resizable.Pane
      bind:this={leftPaneRef}
      collapsible
      collapsedSize={0}
      defaultSize={20}
      minSize={12}
      maxSize={40}
      onCollapse={() => (sidebarOpen = false)}
      onExpand={() => (sidebarOpen = true)}
    >
      <div class="h-full overflow-hidden">
        <FileTree ontoggle={toggleSidebar} />
      </div>
    </Resizable.Pane>

    <Resizable.Handle />

    <Resizable.Pane defaultSize={53} minSize={25}>
      <EditorPane sidebarCollapsed={!sidebarOpen} />
    </Resizable.Pane>

    <Resizable.Handle />

    <Resizable.Pane defaultSize={27} minSize={15} maxSize={50}>
      <div class="h-full border-l border-border bg-background">
        <Preview />
      </div>
    </Resizable.Pane>
  </Resizable.PaneGroup>
</div>
