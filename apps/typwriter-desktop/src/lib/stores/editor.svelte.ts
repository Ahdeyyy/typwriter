import { ResultAsync } from 'neverthrow';
import { updateFileContent, saveFile, readFile, discardShadow, triggerPreview } from '$lib/ipc/commands';
import { workspace, normalize, basename } from './workspace.svelte';

// ─── File type detection ───────────────────────────────────────────────────────

const TEXT_EXTS = new Set([
    '.typ', '.txt', '.md', '.markdown', '.json', '.toml',
    '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts',
    '.xml', '.csv', '.ini', '.env', '.sh', '.rs', '.bib',
]);

const IMAGE_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif', '.tiff',
]);

export type ViewMode = 'text' | 'image' | 'unsupported';

function extOf(path: string): string {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

export interface TabInfo {
    /** Unique tab ID — equals relPath so each file is open at most once. */
    id: string;
    relPath: string;
    absPath: string;
    name: string;
    viewMode: ViewMode;
    isEditable: boolean;
    content: string;
    imageSrc: string | null;
    hasUnsavedChanges: boolean;
    isLoading: boolean;
}

// ─── Store ────────────────────────────────────────────────────────────────────

const SHADOW_DELAY = 0;  // ms — fast shadow write for live preview
const DISK_SAVE_DELAY = 750;  // ms — auto-save to disk after last edit

class EditorStore {
    tabs = $state<TabInfo[]>([]);
    activeTabId = $state<string | null>(null);

    activeTab = $derived(
        this.activeTabId !== null
            ? (this.tabs.find(t => t.id === this.activeTabId) ?? null)
            : null
    );

    /** Set by the preview component after a jump-from-click to move the CM cursor. */
    cursorJumpRequest = $state<{ tabId: string; offset: number } | null>(null);

    requestCursorJump(tabId: string, offset: number): void {
        this.cursorJumpRequest = { tabId, offset };
    }

    // ── Per-tab debounce timers (plain Map, no rune needed)
    private _shadowTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private _autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // ─── Open file ────────────────────────────────────────────────────────────

    openFile(relPath: string): ResultAsync<void, string> {
        const id = normalize(relPath);

        // If tab is already open, just activate it.
        const existing = this.tabs.find(t => t.id === id);
        if (existing) {
            this.activeTabId = id;
            return ResultAsync.fromSafePromise(Promise.resolve());
        }

        const absPath = workspace.toAbs(id);
        const ext = extOf(id);
        const viewMode: ViewMode = IMAGE_EXTS.has(ext)
            ? 'image'
            : TEXT_EXTS.has(ext)
                ? 'text'
                : 'unsupported';

        const tab: TabInfo = {
            id,
            relPath: id,
            absPath,
            name: basename(id),
            viewMode,
            isEditable: viewMode === 'text',
            content: '',
            imageSrc: null,
            hasUnsavedChanges: false,
            isLoading: viewMode !== 'unsupported',
        };

        this.tabs.push(tab);
        this.activeTabId = id;

        if (viewMode === 'unsupported') {
            return ResultAsync.fromSafePromise(Promise.resolve());
        }

        return this._loadTabContent(id, absPath, viewMode);
    }

    // ─── Internal: load content ───────────────────────────────────────────────
    // IMPORTANT: we accept tabId + raw values rather than the local `tab` object
    // because `this.tabs.push(tab)` causes Svelte 5 to wrap the element in a
    // reactive proxy. The original `tab` variable still points to the *raw*
    // (unproxied) object, so mutations on it are invisible to Svelte. We must
    // look up the element through `this.tabs.find(...)` inside the async
    // callback to get the reactive proxy and trigger UI updates.

    private _loadTabContent(tabId: string, absPath: string, viewMode: ViewMode): ResultAsync<void, string> {
        return ResultAsync.fromPromise(
            readFile(absPath).then(r => {
                // Re-acquire the reactive proxy from the live array.
                const liveTab = this.tabs.find(t => t.id === tabId);
                if (!liveTab) return; // tab was closed before loading finished

                if (r.isErr()) throw new Error(r.error);

                if (viewMode === 'image') {
                    if (r.value.type !== 'image') throw new Error(`Expected image, got ${r.value.type}`);
                    liveTab.imageSrc = `data:${r.value.mime};base64,${r.value.base64}`;
                    liveTab.content = '';
                } else {
                    if (r.value.type !== 'text') throw new Error(`Expected text, got ${r.value.type}`);
                    liveTab.content = r.value.content;
                }

                liveTab.isLoading = false;
            }),
            (e) => String(e)
        );
    }

    // ─── Close tab ────────────────────────────────────────────────────────────

    closeTab(id: string): void {
        const idx = this.tabs.findIndex(t => t.id === id);
        if (idx === -1) return;

        const tab = this.tabs[idx];

        // Clear pending timers.
        this._clearTimers(id);
        // Discard the in-memory shadow on the backend (fire-and-forget).
        if (tab.viewMode === 'text') {
            discardShadow(tab.absPath).mapErr(err =>
                console.error('discardShadow error on close:', err)
            );
        }

        this.tabs.splice(idx, 1);

        // Pick a new active tab if we closed the active one.
        if (this.activeTabId === id) {
            if (this.tabs.length === 0) {
                this.activeTabId = null;
            } else {
                const newIdx = Math.min(idx, this.tabs.length - 1);
                this.activeTabId = this.tabs[newIdx].id;
            }
        }
    }

    closeOtherTabs(keepId: string): void {
        const toClose = this.tabs.filter(t => t.id !== keepId).map(t => t.id);
        for (const id of toClose) this.closeTab(id);
    }

    // ─── Content changes (called from workspace.svelte's CM update listener) ──

    handleTabContentChange(tabId: string, content: string): void {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab || !tab.isEditable) return;

        tab.content = content;
        tab.hasUnsavedChanges = true;

        // Shadow write (fast — keeps live preview in sync).
        clearTimeout(this._shadowTimers.get(tab.id));
        this._shadowTimers.set(tab.id, setTimeout(() => {
            updateFileContent(tab.absPath, tab.content)
                .andThen(() => triggerPreview())
                .mapErr(err => console.error('shadow write/preview error:', err));
        }, SHADOW_DELAY));

        // Auto-save to disk.
        clearTimeout(this._autoSaveTimers.get(tab.id));
        this._autoSaveTimers.set(tab.id, setTimeout(() => {
            saveFile(tab.absPath, tab.content)
                .map(() => { tab.hasUnsavedChanges = false; })
                .mapErr(err => console.error('auto-save error:', err));
        }, DISK_SAVE_DELAY));
    }

    // ─── Manual save (Ctrl+S) ─────────────────────────────────────────────────

    saveTabById(tabId: string): ResultAsync<void, string> {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab || !tab.isEditable) return ResultAsync.fromSafePromise(Promise.resolve());

        // Cancel pending timers — we're saving right now.
        this._clearTimers(tab.id);

        // Flush the shadow write immediately too.
        updateFileContent(tab.absPath, tab.content)
            .mapErr(err => console.error('shadow write error on save:', err));

        return saveFile(tab.absPath, tab.content).map(() => {
            tab.hasUnsavedChanges = false;
        });
    }

    saveCurrentFile(): ResultAsync<void, string> {
        const tab = this.activeTab;
        if (!tab) return ResultAsync.fromSafePromise(Promise.resolve());
        return this.saveTabById(tab.id);
    }

    // ─── Tab path update (called after rename) ────────────────────────────────

    updateTabPath(oldId: string, newRelPath: string): void {
        const tab = this.tabs.find(t => t.id === oldId);
        if (!tab) return;

        const newId = normalize(newRelPath);

        // Move timers to new key.
        const shadow = this._shadowTimers.get(oldId);
        if (shadow !== undefined) { this._shadowTimers.delete(oldId); this._shadowTimers.set(newId, shadow); }
        const autoSave = this._autoSaveTimers.get(oldId);
        if (autoSave !== undefined) { this._autoSaveTimers.delete(oldId); this._autoSaveTimers.set(newId, autoSave); }

        tab.id = newId;
        tab.relPath = newId;
        tab.absPath = workspace.toAbs(newId);
        tab.name = basename(newId);

        if (this.activeTabId === oldId) {
            this.activeTabId = newId;
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private _clearTimers(id: string): void {
        const s = this._shadowTimers.get(id);
        if (s !== undefined) { clearTimeout(s); this._shadowTimers.delete(id); }
        const a = this._autoSaveTimers.get(id);
        if (a !== undefined) { clearTimeout(a); this._autoSaveTimers.delete(id); }
    }

    // ─── Legacy compatibility getters ────────────────────────────────────────
    // Kept so any code that still reads `editor.filePath` etc. continues to work.

    get filePath(): string | null { return this.activeTab?.absPath ?? null; }
    get viewMode(): ViewMode { return this.activeTab?.viewMode ?? 'text'; }
    get isEditable(): boolean { return this.activeTab?.isEditable ?? false; }
    get isLoading(): boolean { return this.activeTab?.isLoading ?? false; }
    get hasUnsavedChanges(): boolean { return this.activeTab?.hasUnsavedChanges ?? false; }
    get imageSrc(): string | null { return this.activeTab?.imageSrc ?? null; }
    get fileContent(): string { return this.activeTab?.content ?? ''; }
}

export const editor = new EditorStore();
