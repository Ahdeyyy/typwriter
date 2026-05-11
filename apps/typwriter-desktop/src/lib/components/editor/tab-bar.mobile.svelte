<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Cancel01Icon } from "@hugeicons/core-free-icons";
  import { editor } from "$lib/stores/editor.svelte";
  import { TabBarController } from "./tab-bar-controller.svelte";

  const ctrl = new TabBarController();

  $effect(() => {
    ctrl.scrollActiveIntoView();
  });
</script>

<div class="mobile-tab-strip">
  <div class="mobile-tab-list" bind:this={ctrl.tabListEl}>
    {#each editor.tabs as tab (tab.id)}
      {@const isActive = editor.activeTabId === tab.id}
      <button
        {@attach (node) => ctrl.registerTab(tab.id, node as HTMLButtonElement)}
        type="button"
        class="mobile-tab {isActive ? 'active' : ''}"
        onclick={() => void ctrl.activateTab(tab)}
        aria-pressed={isActive}
      >
        {#if tab.hasUnsavedChanges}
          <span class="unsaved-dot"></span>
        {/if}

        <span class="tab-name">{ctrl.tabDisplayNames.get(tab.id) ?? tab.name}</span>

        <span
          role="button"
          tabindex="-1"
          class="close-btn"
          onclick={(e) => void ctrl.closeTab(tab, e)}
          onkeydown={(e) => { if (e.key === 'Enter') void ctrl.closeTab(tab, e); }}
          aria-label="Close {tab.name}"
        >
          <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .mobile-tab-strip {
    display: flex;
    align-items: center;
    width: 100%;
    height: 44px;
    flex-shrink: 0;
    background-color: var(--background);
    border-top: 1px solid var(--border);
    padding: 6px 8px;
  }

  .mobile-tab-list {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .mobile-tab-list::-webkit-scrollbar { display: none; }

  .mobile-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    max-width: 180px;
    padding: 0 10px;
    border-radius: 9999px;
    font-size: 13px;
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
    outline: none;
    border: 1px solid var(--border);
    background-color: var(--muted);
    color: color-mix(in srgb, var(--foreground) 75%, transparent);
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .mobile-tab.active {
    background-color: var(--primary);
    color: var(--primary-foreground);
    border-color: var(--primary);
  }

  .tab-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unsaved-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: currentColor;
  }

  .close-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    opacity: 0.7;
  }

  .close-btn:active {
    background-color: color-mix(in srgb, currentColor 20%, transparent);
    opacity: 1;
  }
</style>
