<script lang="ts">
  import { X } from "@lucide/svelte";
  import { editor, type TabInfo } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";

  function activateTab(tab: TabInfo) {
    editor.activeTabId = tab.id;
    workspace.activeFilePath = tab.relPath;
  }

  function closeTab(e: MouseEvent, tab: TabInfo) {
    e.stopPropagation();
    editor.closeTab(tab.id);
    // Keep workspace.activeFilePath in sync with the new active tab.
    workspace.activeFilePath = editor.activeTab?.relPath ?? null;
  }

  function handleAuxClick(e: MouseEvent, tab: TabInfo) {
    // Middle-click closes the tab.
    if (e.button === 1) {
      e.preventDefault();
      editor.closeTab(tab.id);
      workspace.activeFilePath = editor.activeTab?.relPath ?? null;
    }
  }
</script>

<div class="tab-bar flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-muted/20">
  {#each editor.tabs as tab (tab.id)}
    <ContextMenu.Root>
      <ContextMenu.Trigger class="flex">
        <!-- Tab button -->
        <button
          class="group relative flex h-full min-w-0 max-w-48 items-center gap-1.5 border-r border-border
                 px-3 text-xs transition-colors
                 {editor.activeTabId === tab.id
                   ? 'bg-background text-foreground'
                   : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
          onclick={() => activateTab(tab)}
          onauxclick={(e) => handleAuxClick(e, tab)}
          title={tab.relPath}
        >
          <!-- Unsaved dot -->
          {#if tab.hasUnsavedChanges}
            <span class="size-1.5 shrink-0 rounded-full bg-foreground/50"></span>
          {/if}

          <!-- File name -->
          <span class="truncate">{tab.name}</span>

          <!-- Close button — always reserve space, only visible on hover -->
          <span
            role="button"
            tabindex="-1"
            class="ml-0.5 shrink-0 rounded p-0.5
                   opacity-0 group-hover:opacity-100
                   hover:bg-accent hover:text-accent-foreground
                   transition-opacity"
            onclick={(e) => closeTab(e, tab)}
            onkeydown={(e) => { if (e.key === 'Enter') closeTab(e as unknown as MouseEvent, tab); }}
            aria-label="Close {tab.name}"
          >
            <X class="size-3" />
          </span>

          <!-- Active underline bar -->
          {#if editor.activeTabId === tab.id}
            <span class="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-sm"></span>
          {/if}
        </button>
      </ContextMenu.Trigger>

      <ContextMenu.Content>
        <ContextMenu.Item onclick={() => editor.closeTab(tab.id)}>
          Close
        </ContextMenu.Item>
        <ContextMenu.Item onclick={() => editor.closeOtherTabs(tab.id)}>
          Close Others
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  {/each}
</div>

<style>
  .tab-bar {
    scrollbar-width: none;
  }
  .tab-bar::-webkit-scrollbar {
    display: none;
  }
</style>
