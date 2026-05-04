<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Cancel01Icon } from "@hugeicons/core-free-icons";
  import { editor, type TabInfo } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";

  let dragTabId = $state<string | null>(null);
  let dropTargetId = $state<string | null>(null);
  let dropSide = $state<"left" | "right" | null>(null);

  async function activateTab(tab: TabInfo) {
    try {
      await editor.activateTab(tab.id);
      workspace.activeFilePath = tab.relPath;
    } catch {}
  }

  async function closeTab(e: MouseEvent, tab: TabInfo) {
    e.stopPropagation();
    try {
      const closed = await editor.closeTab(tab.id);
      if (!closed) return;
      workspace.activeFilePath = editor.activeTab?.relPath ?? null;
    } catch {}
  }

  async function handleAuxClick(e: MouseEvent, tab: TabInfo) {
    if (e.button === 1) {
      e.preventDefault();
      try {
        const closed = await editor.closeTab(tab.id);
        if (!closed) return;
        workspace.activeFilePath = editor.activeTab?.relPath ?? null;
      } catch {}
    }
  }

  function handleDragStart(e: DragEvent, tab: TabInfo) {
    dragTabId = tab.id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.id);
    }
  }

  function handleDragOver(e: DragEvent, tab: TabInfo) {
    if (!dragTabId || dragTabId === tab.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropTargetId = tab.id;
    dropSide = e.clientX < rect.left + rect.width / 2 ? "left" : "right";
  }

  function handleDragLeave(_e: DragEvent, tab: TabInfo) {
    if (dropTargetId === tab.id) {
      dropTargetId = null;
      dropSide = null;
    }
  }

  function handleDrop(e: DragEvent, tab: TabInfo) {
    e.preventDefault();
    if (!dragTabId || dragTabId === tab.id) return;
    const fromIdx = editor.tabs.findIndex((t) => t.id === dragTabId);
    const toIdx = editor.tabs.findIndex((t) => t.id === tab.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = editor.tabs.splice(fromIdx, 1);
    let insertIdx = editor.tabs.findIndex((t) => t.id === tab.id);
    if (dropSide === "right") insertIdx += 1;
    editor.tabs.splice(insertIdx, 0, moved);
    dragTabId = null;
    dropTargetId = null;
    dropSide = null;
    workspace.schedulePersistTabs();
  }

  function handleDragEnd() {
    dragTabId = null;
    dropTargetId = null;
    dropSide = null;
  }

  function isAdjacentToActive(index: number): boolean {
    const activeIdx = editor.tabs.findIndex((t) => t.id === editor.activeTabId);
    return index === activeIdx || index === activeIdx - 1 || index === activeIdx + 1;
  }
</script>

<div class="tab-strip">
  <div class="tab-list">
    {#each editor.tabs as tab, i (tab.id)}
      {@const isActive = editor.activeTabId === tab.id}
      {@const isDragging = dragTabId === tab.id}
      {@const isDropTarget = dropTargetId === tab.id}
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <button
            class="chrome-tab"
            class:active={isActive}
            class:dragging={isDragging}
            class:drop-left={isDropTarget && dropSide === "left"}
            class:drop-right={isDropTarget && dropSide === "right"}
            draggable="true"
            ondragstart={(e) => handleDragStart(e, tab)}
            ondragover={(e) => handleDragOver(e, tab)}
            ondragleave={(e) => handleDragLeave(e, tab)}
            ondrop={(e) => handleDrop(e, tab)}
            ondragend={handleDragEnd}
            onclick={() => void activateTab(tab)}
            onauxclick={(e) => void handleAuxClick(e, tab)}
            title={tab.relPath}
          >
            {#if tab.hasUnsavedChanges}
              <span class="unsaved-dot"></span>
            {/if}

            <span class="tab-name">{tab.name}</span>

            <span
              role="button"
              tabindex="-1"
              class="close-btn"
              onclick={(e) => void closeTab(e, tab)}
              onkeydown={(e) => { if (e.key === 'Enter') void closeTab(e as unknown as MouseEvent, tab); }}
              aria-label="Close {tab.name}"
            >
              <HugeiconsIcon icon={Cancel01Icon} class="size-3" />
            </span>

            <!-- Separator between inactive tabs (hidden next to active tab) -->
            {#if i < editor.tabs.length - 1 && !isAdjacentToActive(i)}
              <span class="tab-separator"></span>
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
