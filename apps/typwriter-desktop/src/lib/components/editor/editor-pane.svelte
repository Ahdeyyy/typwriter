<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { FileCodeIcon, BlockedIcon } from "@hugeicons/core-free-icons";
  import TabBar from "$lib/components/editor/tab-bar.svelte";
  import TextEditorTab from "$lib/components/editor/text-editor-tab.svelte";
  import SearchPanel from "$lib/components/editor/search-panel.svelte";
  import { editor } from "$lib/stores/editor.svelte";
</script>

<div class="flex h-svh flex-col bg-background">
  {#if editor.tabs.length > 0}
    <TabBar />
  {/if}

  <div class="relative flex-1 min-h-0 overflow-hidden">
    {#if !editor.activeTab}
      <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
        <HugeiconsIcon icon={FileCodeIcon} class="size-10 opacity-30" />
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
        <HugeiconsIcon icon={BlockedIcon} class="size-10 opacity-30" />
        <span class="text-sm">Binary format — preview not available</span>
        <span class="text-xs opacity-50 max-w-xs truncate">{editor.activeTab.relPath}</span>
      </div>

    {:else}
      <div class="relative h-full w-full overflow-hidden">
        <TextEditorTab />
        <SearchPanel />
      </div>
    {/if}
  </div>
</div>
