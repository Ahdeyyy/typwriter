<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { House, PanelLeft } from "@lucide/svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";

  import FileTree from "$lib/components/sidebar/filetree.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { page } from "$lib/stores/page.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import { logError } from "$lib/logger";

  let leftPaneRef = $state<any>(null);
  let sidebarOpen = $state(true);
  let returningHome = $state(false);

  onMount(() => { diagnostics.init(); });
  onDestroy(() => { diagnostics.destroy(); });

  function toggleSidebar() {
    sidebarOpen ? leftPaneRef?.collapse() : leftPaneRef?.expand();
  }

  async function handleReturnHome() {
    if (returningHome) return;
    returningHome = true;

    const result = await workspace.leave();
    result.match(
      () => {
        page.navigate("home");
      },
      (err) => {
        logError("Failed to return home:", err);
        toast.error(`Failed to return home: ${err}`);
      },
    );

    returningHome = false;
  }
</script>

<div class="relative flex h-screen w-screen overflow-hidden">
  {#if !sidebarOpen}
    <div class="absolute top-1 left-2 z-50 flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-accent-foreground"
        onclick={handleReturnHome}
        title="Back to home"
        aria-label="Back to home"
        disabled={returningHome}
      >
        <House class="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-accent-foreground"
        onclick={toggleSidebar}
        title="Show file explorer"
        aria-label="Show file explorer"
      >
        <PanelLeft class="size-4" />
      </Button>
    </div>
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
        <FileTree
          ontoggle={toggleSidebar}
          onhome={handleReturnHome}
          homeDisabled={returningHome}
        />
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
