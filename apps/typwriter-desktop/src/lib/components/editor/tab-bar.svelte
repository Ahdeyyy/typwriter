<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Cancel01Icon } from "@hugeicons/core-free-icons";
  import { editor } from "$lib/stores/editor.svelte";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { TabBarController } from "./tab-bar-controller.svelte";

  const ctrl = new TabBarController();

  $effect(() => {
    ctrl.scrollActiveIntoView();
  });
</script>

<div class="tab-strip">
  <div class="tab-list" bind:this={ctrl.tabListEl}>
    {#each editor.tabs as tab, i (tab.id)}
      {@const isActive = editor.activeTabId === tab.id}
      {@const isDragging = ctrl.dragTabId === tab.id}
      {@const isDropTarget = ctrl.dropTargetId === tab.id}
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
          <button
            {...props}
            {@attach (node) => ctrl.registerTab(tab.id, node as HTMLButtonElement)}
            type="button"
            class="chrome-tab {isActive ? 'active' : ''} {isDragging ? 'dragging' : ''} {isDropTarget && ctrl.dropSide === 'left' ? 'drop-left' : ''} {isDropTarget && ctrl.dropSide === 'right' ? 'drop-right' : ''}"
            draggable="true"
            ondragstart={(e: DragEvent) => ctrl.handleDragStart(e, tab)}
            ondragover={(e: DragEvent) => ctrl.handleDragOver(e, tab)}
            ondragleave={() => ctrl.handleDragLeave(tab)}
            ondrop={(e: DragEvent) => ctrl.handleDrop(e, tab)}
            ondragend={() => ctrl.handleDragEnd()}
            onclick={() => void ctrl.activateTab(tab)}
            onauxclick={(e: MouseEvent) => void ctrl.handleAuxClick(e, tab)}
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
              <HugeiconsIcon icon={Cancel01Icon} class="size-3" />
            </span>

            <!-- Separator between inactive tabs (hidden next to active tab) -->
            {#if i < editor.tabs.length - 1 && !ctrl.isAdjacentToActive(i)}
              <span class="tab-separator"></span>
            {/if}
          </button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{tab.relPath}</Tooltip.Content>
          </Tooltip.Root>
        </ContextMenu.Trigger>

        <ContextMenu.Content>
          <ContextMenu.Item onclick={() => void ctrl.closeTab(tab)}>
            Close
          </ContextMenu.Item>
          <ContextMenu.Item onclick={() => void ctrl.closeOthers(tab)}>
            Close Others
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            disabled={i === 0}
            onclick={() => void ctrl.closeToLeft(tab)}
          >
            Close Tabs to the Left
          </ContextMenu.Item>
          <ContextMenu.Item
            disabled={i === editor.tabs.length - 1}
            onclick={() => void ctrl.closeToRight(tab)}
          >
            Close Tabs to the Right
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    {/each}
  </div>
</div>

<style>
  /* ── Strip ───────────────────────────────────────────────────── */
  .tab-strip {
    display: flex;
    align-items: flex-end;
    height: 38px;
    flex-shrink: 0;
    background-color: var(--muted);
    padding: 0 4px;
    padding-top: 6px;
    position: relative;
  }

  .tab-list {
    display: flex;
    align-items: flex-end;
    min-width: 0;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab-list::-webkit-scrollbar { display: none; }

  /* ── Tab (inactive) ─────────────────────────────────────────── */
  .chrome-tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    min-width: 80px;
    max-width: 220px;
    padding: 0 12px;
    border-radius: 8px 8px 0 0;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    flex-shrink: 1;
    outline: none;
    border: none;
    transition: background-color 0.15s ease, color 0.15s ease;

    /* Inactive: transparent, text only — like real Chrome */
    background-color: transparent;
    color: color-mix(in srgb, var(--foreground) 55%, transparent);
    z-index: 1;
  }

  .chrome-tab:hover {
    background-color: color-mix(in srgb, var(--background) 50%, transparent);
    color: var(--foreground);
    z-index: 5;
  }

  /* ── Active tab ──────────────────────────────────────────────── */
  .chrome-tab.active {
    background-color: var(--background);
    color: var(--foreground);
    height: 32px;
    /* Extend below the strip border to visually merge with content */
    margin-bottom: -1px;
    padding-bottom: 1px;
    z-index: 10;
  }

  /* ── Drag states ─────────────────────────────────────────────── */
  .chrome-tab.dragging {
    opacity: 0.4;
  }
  .chrome-tab.drop-left {
    box-shadow: inset 2px 0 0 0 var(--primary);
  }
  .chrome-tab.drop-right {
    box-shadow: inset -2px 0 0 0 var(--primary);
  }

  /* ── Tab internals ───────────────────────────────────────────── */
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
    background-color: var(--primary);
  }

  .close-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.1s ease, background-color 0.1s ease;
  }

  .chrome-tab:hover .close-btn,
  .chrome-tab.active .close-btn {
    opacity: 0.6;
  }

  .close-btn:hover {
    opacity: 1 !important;
    background-color: color-mix(in srgb, var(--foreground) 15%, transparent);
  }

  /* ── Separator ───────────────────────────────────────────────── */
  .tab-separator {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 1px;
    height: 14px;
    background-color: var(--border);
    pointer-events: none;
  }
</style>
