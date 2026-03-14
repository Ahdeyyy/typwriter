<script lang="ts">
  import { X } from "phosphor-svelte";
  import ActiveFileProblems from "$lib/components/editor/active-file-problems.svelte";
  import { editor, type TabInfo } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";

  async function activateTab(tab: TabInfo) {
    try {
      await editor.activateTab(tab.id);
      workspace.activeFilePath = tab.relPath;
    } catch {
      // flushTab already surfaced the error to the user
    }
  }

  async function closeTab(e: MouseEvent, tab: TabInfo) {
    e.stopPropagation();
    try {
      const closed = await editor.closeTab(tab.id);
      if (!closed) return;
      workspace.activeFilePath = editor.activeTab?.relPath ?? null;
    } catch {
      // closeTab returns false on flush failure, but keep this guard for safety
    }
  }

  async function handleAuxClick(e: MouseEvent, tab: TabInfo) {
    // Middle-click closes the tab.
    if (e.button === 1) {
      e.preventDefault();
      try {
        const closed = await editor.closeTab(tab.id);
        if (!closed) return;
        workspace.activeFilePath = editor.activeTab?.relPath ?? null;
      } catch {
        // closeTab returns false on flush failure, but keep this guard for safety
      }
    }
  }
</script>

<div class="flex h-9 shrink-0 items-stretch border-b border-border bg-muted/20">
  <div class="tab-bar flex min-w-0 flex-1 items-stretch overflow-x-auto">
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
            onclick={() => void activateTab(tab)}
            onauxclick={(e) => void handleAuxClick(e, tab)}
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
              onclick={(e) => void closeTab(e, tab)}
              onkeydown={(e) => { if (e.key === 'Enter') void closeTab(e as unknown as MouseEvent, tab); }}
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
          <ContextMenu.Item onclick={() => void editor.closeTab(tab.id).then(() => {
            workspace.activeFilePath = editor.activeTab?.relPath ?? null;
          })}>
            Close
          </ContextMenu.Item>
          <ContextMenu.Item onclick={() => void editor.closeOtherTabs(tab.id).then(() => {
            workspace.activeFilePath = editor.activeTab?.relPath ?? null;
          })}>
            Close Others
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    {/each}
  </div>

  <div class="flex shrink-0 items-center gap-1 border-l border-border px-2">
    <ActiveFileProblems />
  </div>
</div>

<style>
  .tab-bar {
    scrollbar-width: none;
  }
  .tab-bar::-webkit-scrollbar {
    display: none;
  }
</style>
