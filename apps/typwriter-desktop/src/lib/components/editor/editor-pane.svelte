<script lang="ts">
  import { FileCode, Prohibit } from "phosphor-svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import TabBar from "$lib/components/editor/tab-bar.svelte";
  import TextEditorTab from "$lib/components/editor/text-editor-tab.svelte";
  import DiagnosticsPane from "$lib/components/editor/diagnostics-pane.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";

  interface Props {
    sidebarCollapsed?: boolean;
  }

  let { sidebarCollapsed = false }: Props = $props();

  let bottomPaneRef = $state<any>(null);

  $effect(() => {
    if (diagnostics.paneOpen) bottomPaneRef?.expand();
    else bottomPaneRef?.collapse();
  });
</script>

<div class="flex h-svh flex-col bg-background">
  {#if editor.tabs.length > 0}
    <div class={sidebarCollapsed ? "pl-[64px]" : ""}>
      <TabBar />
    </div>
  {/if}

  <Resizable.PaneGroup direction="vertical" class="flex-1 min-h-0">
    <Resizable.Pane defaultSize={75} minSize={40} class="relative overflow-hidden">
      {#if !editor.activeTab}
        <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
          <FileCode class="size-10 opacity-30" />
          <span class="text-sm">Select a file to open</span>
        </div>

      {:else if editor.activeTab.isLoading}
        <div class="flex h-full items-center justify-center text-muted-foreground text-sm select-none">
          Loading…
        </div>

      {:else if editor.activeTab.viewMode === "image"}
        <div class="flex h-full items-center justify-center overflow-auto p-4 bg-muted/30">
          <img
            src={editor.activeTab.imageSrc ?? ""}
            alt={editor.activeTab.name}
            class="max-w-full max-h-full object-contain rounded shadow-md"
          />
        </div>

      {:else if editor.activeTab.viewMode === "unsupported"}
        <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
          <Prohibit class="size-10 opacity-30" />
          <span class="text-sm">Binary format — preview not available</span>
          <span class="text-xs opacity-50 max-w-xs truncate">{editor.activeTab.relPath}</span>
        </div>

      {:else}
        <div class="relative h-full w-full overflow-hidden">
          <TextEditorTab />
        </div>
      {/if}
    </Resizable.Pane>

    <Resizable.Handle />

    <Resizable.Pane
      bind:this={bottomPaneRef}
      collapsible
      collapsedSize={0}
      defaultSize={25}
      minSize={10}
      maxSize={50}
      onCollapse={() => (diagnostics.paneOpen = false)}
      onExpand={() => (diagnostics.paneOpen = true)}
    >
      <DiagnosticsPane />
    </Resizable.Pane>
  </Resizable.PaneGroup>
</div>
