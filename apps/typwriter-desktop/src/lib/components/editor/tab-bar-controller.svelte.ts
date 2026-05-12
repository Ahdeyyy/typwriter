import { editor, type TabInfo } from "$lib/stores/editor.svelte";
import { workspace } from "$lib/stores/workspace.svelte";
import { logError } from "$lib/logger";

export class TabBarController {
  // Drag-drop state (desktop only)
  dragTabId = $state<string | null>(null);
  dropTargetId = $state<string | null>(null);
  dropSide = $state<"left" | "right" | null>(null);

  // Refs for scroll-into-view (used by both desktop and mobile)
  tabListEl = $state<HTMLElement | null>(null);
  tabRefs = new Map<string, HTMLElement>();

  // Computed labels — disambiguates duplicate filenames by prefixing parent folder
  tabDisplayNames = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const t of editor.tabs) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
    return new Map(
      editor.tabs.map((t) => {
        if ((counts.get(t.name) ?? 0) > 1) {
          const parts = t.relPath.split("/");
          const label = parts.length > 1 ? `${parts[parts.length - 2]}/${t.name}` : t.name;
          return [t.id, label] as [string, string];
        }
        return [t.id, t.name] as [string, string];
      })
    );
  });

  registerTab(id: string, node: HTMLElement) {
    this.tabRefs.set(id, node);
    return () => this.tabRefs.delete(id);
  }

  scrollActiveIntoView() {
    const id = editor.activeTabId;
    if (!id || !this.tabListEl) return;
    const el = this.tabRefs.get(id);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  async activateTab(tab: TabInfo) {
    try {
      await editor.activateTab(tab.id);
      workspace.activeFilePath = tab.relPath;
    } catch (err) {
      logError("activateTab failed:", err);
    }
  }

  async closeTab(tab: TabInfo, e?: Event) {
    e?.stopPropagation();
    try {
      const closed = await editor.closeTab(tab.id);
      if (!closed) return;
      workspace.activeFilePath = editor.activeTab?.relPath ?? null;
    } catch (err) {
      logError("closeTab failed:", err);
    }
  }

  async handleAuxClick(e: MouseEvent, tab: TabInfo) {
    if (e.button !== 1) return;
    e.preventDefault();
    await this.closeTab(tab);
  }

  async closeOthers(tab: TabInfo) {
    try {
      await editor.closeOtherTabs(tab.id);
      workspace.activeFilePath = editor.activeTab?.relPath ?? null;
    } catch (err) {
      logError("closeOtherTabs failed:", err);
    }
  }

  async closeToLeft(tab: TabInfo) {
    try {
      await editor.closeTabsToLeft(tab.id);
      workspace.activeFilePath = editor.activeTab?.relPath ?? null;
    } catch (err) {
      logError("closeTabsToLeft failed:", err);
    }
  }

  async closeToRight(tab: TabInfo) {
    try {
      await editor.closeTabsToRight(tab.id);
      workspace.activeFilePath = editor.activeTab?.relPath ?? null;
    } catch (err) {
      logError("closeTabsToRight failed:", err);
    }
  }

  isAdjacentToActive(index: number): boolean {
    const activeIdx = editor.tabs.findIndex((t) => t.id === editor.activeTabId);
    return index === activeIdx || index === activeIdx - 1 || index === activeIdx + 1;
  }

  // ── Drag and drop (desktop) ─────────────────────────────────────
  handleDragStart(e: DragEvent, tab: TabInfo) {
    this.dragTabId = tab.id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.id);
    }
  }

  handleDragOver(e: DragEvent, tab: TabInfo) {
    if (!this.dragTabId || this.dragTabId === tab.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.dropTargetId = tab.id;
    this.dropSide = e.clientX < rect.left + rect.width / 2 ? "left" : "right";
  }

  handleDragLeave(tab: TabInfo) {
    if (this.dropTargetId === tab.id) {
      this.dropTargetId = null;
      this.dropSide = null;
    }
  }

  handleDrop(e: DragEvent, tab: TabInfo) {
    e.preventDefault();
    if (!this.dragTabId || this.dragTabId === tab.id) return;
    const fromIdx = editor.tabs.findIndex((t) => t.id === this.dragTabId);
    const toIdx = editor.tabs.findIndex((t) => t.id === tab.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = editor.tabs.splice(fromIdx, 1);
    let insertIdx = editor.tabs.findIndex((t) => t.id === tab.id);
    if (this.dropSide === "right") insertIdx += 1;
    editor.tabs.splice(insertIdx, 0, moved);
    this.resetDrag();
    workspace.schedulePersistTabs();
  }

  handleDragEnd() {
    this.resetDrag();
  }

  private resetDrag() {
    this.dragTabId = null;
    this.dropTargetId = null;
    this.dropSide = null;
  }
}
