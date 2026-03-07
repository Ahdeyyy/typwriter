import { ResultAsync } from 'neverthrow';
import {
    discardShadow,
    readFile,
    saveFile,
    triggerPreview,
    updateFileContent,
} from '$lib/ipc/commands';
import type { CompileReason } from '$lib/types';
import { workspace, normalize, basename } from './workspace.svelte';
import { toast } from 'svelte-sonner';

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

export interface TabInfo {
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

const TYPING_PREVIEW_INTERVAL = 75;
const IDLE_SAVE_DELAY = 1500;

class EditorStore {
    tabs = $state<TabInfo[]>([]);
    activeTabId = $state<string | null>(null);

    activeTab = $derived(
        this.activeTabId !== null
            ? (this.tabs.find((t) => t.id === this.activeTabId) ?? null)
            : null
    );

    cursorJumpRequest = $state<{ tabId: string; offset: number } | null>(null);

    private _typingPreviewTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private _typingPreviewLastRun = new Map<string, number>();
    private _idleSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    requestCursorJump(tabId: string, offset: number): void {
        this.cursorJumpRequest = { tabId, offset };
    }

    openFile(relPath: string): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._openFile(relPath), (err) => String(err));
    }

    private async _openFile(relPath: string): Promise<void> {
        const id = normalize(relPath);
        if (this.activeTabId && this.activeTabId !== id) {
            await this.flushActiveTab();
        }

        const existing = this.tabs.find((t) => t.id === id);
        if (existing) {
            this.activeTabId = id;
            return;
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
            return;
        }

        await this._loadTabContent(id, absPath, viewMode);
    }

    async activateTab(tabId: string): Promise<void> {
        if (this.activeTabId === tabId) {
            return;
        }
        await this.flushActiveTab();
        this.activeTabId = tabId;
    }

    private async _loadTabContent(tabId: string, absPath: string, viewMode: ViewMode): Promise<void> {
        const response = await readFile(absPath);
        const liveTab = this.tabs.find((t) => t.id === tabId);
        if (!liveTab) {
            return;
        }
        if (response.isErr()) {
            liveTab.isLoading = false;
            throw new Error(response.error);
        }

        if (viewMode === 'image') {
            if (response.value.type !== 'image') {
                throw new Error(`Expected image, got ${response.value.type}`);
            }
            liveTab.imageSrc = `data:${response.value.mime};base64,${response.value.base64}`;
            liveTab.content = '';
        } else {
            if (response.value.type !== 'text') {
                throw new Error(`Expected text, got ${response.value.type}`);
            }
            liveTab.content = response.value.content;
        }

        liveTab.isLoading = false;
    }

    async closeTab(id: string, options: { flush?: boolean } = {}): Promise<boolean> {
        const { flush = true } = options;
        const idx = this.tabs.findIndex((t) => t.id === id);
        if (idx === -1) {
            return true;
        }

        const tab = this.tabs[idx];
        if (flush && tab.isEditable && tab.hasUnsavedChanges) {
            try {
                await this.flushTab(id);
            } catch {
                return false;
            }
        }

        this._clearTimers(id);
        if (tab.viewMode === 'text') {
            discardShadow(tab.absPath).mapErr((err) =>
                console.error('discardShadow error on close:', err)
            );
        }

        this.tabs.splice(idx, 1);

        if (this.activeTabId === id) {
            if (this.tabs.length === 0) {
                this.activeTabId = null;
            } else {
                const newIdx = Math.min(idx, this.tabs.length - 1);
                this.activeTabId = this.tabs[newIdx].id;
            }
        }

        return true;
    }

    async closeOtherTabs(keepId: string): Promise<void> {
        const toClose = this.tabs.filter((t) => t.id !== keepId).map((t) => t.id);
        for (const id of toClose) {
            await this.closeTab(id);
        }
    }

    handleTabContentChange(tabId: string, content: string): void {
        const tab = this.tabs.find((t) => t.id === tabId);
        if (!tab || !tab.isEditable) {
            return;
        }

        tab.content = content;
        tab.hasUnsavedChanges = true;

        updateFileContent(tab.absPath, tab.content).mapErr((err) => {
            console.error('shadow write error:', err);
            toast.error(`Shadow update failed for ${tab.name}: ${err}`);
        });

        this._scheduleTypingPreview(tab.id);
        this._scheduleIdleSave(tab.id);
    }

    saveTabById(tabId: string): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this.flushTab(tabId), (err) => String(err));
    }

    saveCurrentFile(): ResultAsync<void, string> {
        const tab = this.activeTab;
        if (!tab) {
            return ResultAsync.fromSafePromise(Promise.resolve());
        }
        return this.saveTabById(tab.id);
    }

    async flushTab(tabId: string): Promise<void> {
        const tab = this.tabs.find((t) => t.id === tabId);
        if (!tab || !tab.isEditable || !tab.hasUnsavedChanges) {
            return;
        }

        this._clearIdleSave(tab.id);

        const shadowResult = await updateFileContent(tab.absPath, tab.content);
        if (shadowResult.isErr()) {
            const message = `Failed to stage ${tab.name}: ${shadowResult.error}`;
            toast.error(message);
            throw new Error(message);
        }

        const saveResult = await saveFile(tab.absPath, tab.content);
        if (saveResult.isErr()) {
            const message = `Failed to save ${tab.name}: ${saveResult.error}`;
            toast.error(message);
            throw new Error(message);
        }

        tab.hasUnsavedChanges = false;
    }

    async flushActiveTab(): Promise<void> {
        if (!this.activeTabId) {
            return;
        }
        await this.flushTab(this.activeTabId);
    }

    async flushAllTabs(): Promise<void> {
        for (const tab of [...this.tabs]) {
            await this.flushTab(tab.id);
        }
    }

    updateTabPath(oldId: string, newRelPath: string): void {
        const tab = this.tabs.find((t) => t.id === oldId);
        if (!tab) {
            return;
        }

        const newId = normalize(newRelPath);
        this._moveTimerKey(this._typingPreviewTimers, oldId, newId);
        this._moveTimerKey(this._idleSaveTimers, oldId, newId);

        const lastRun = this._typingPreviewLastRun.get(oldId);
        if (lastRun !== undefined) {
            this._typingPreviewLastRun.delete(oldId);
            this._typingPreviewLastRun.set(newId, lastRun);
        }

        tab.id = newId;
        tab.relPath = newId;
        tab.absPath = workspace.toAbs(newId);
        tab.name = basename(newId);

        if (this.activeTabId === oldId) {
            this.activeTabId = newId;
        }
    }

    updateTabsUnderPath(oldPrefix: string, newPrefix: string): void {
        const normalizedOld = normalize(oldPrefix).replace(/\/$/, '');
        const normalizedNew = normalize(newPrefix).replace(/\/$/, '');
        const prefix = `${normalizedOld}/`;

        for (const tab of [...this.tabs]) {
            if (tab.relPath === normalizedOld) {
                this.updateTabPath(tab.id, normalizedNew);
            } else if (tab.relPath.startsWith(prefix)) {
                const suffix = tab.relPath.slice(prefix.length);
                this.updateTabPath(tab.id, `${normalizedNew}/${suffix}`);
            }
        }
    }

    private _scheduleTypingPreview(tabId: string): void {
        const now = Date.now();
        const lastRun = this._typingPreviewLastRun.get(tabId) ?? 0;
        const existingTimer = this._typingPreviewTimers.get(tabId);
        const remaining = Math.max(0, TYPING_PREVIEW_INTERVAL - (now - lastRun));

        if (remaining === 0 && existingTimer === undefined) {
            this._fireTypingPreview(tabId);
            return;
        }

        if (existingTimer !== undefined) {
            return;
        }

        this._typingPreviewTimers.set(tabId, setTimeout(() => {
            this._typingPreviewTimers.delete(tabId);
            this._fireTypingPreview(tabId);
        }, remaining || TYPING_PREVIEW_INTERVAL));
    }

    private _fireTypingPreview(tabId: string): void {
        const tab = this.tabs.find((t) => t.id === tabId);
        if (!tab || !tab.isEditable || !tab.hasUnsavedChanges) {
            return;
        }
        this._typingPreviewLastRun.set(tabId, Date.now());
        this._requestPreview('typing');
    }

    private _scheduleIdleSave(tabId: string): void {
        this._clearIdleSave(tabId);
        this._idleSaveTimers.set(tabId, setTimeout(() => {
            void this.flushTab(tabId).catch(() => {});
        }, IDLE_SAVE_DELAY));
    }

    private _requestPreview(reason: CompileReason): void {
        triggerPreview(reason).mapErr((err) => {
            console.error('preview trigger error:', err);
        });
    }

    private _clearIdleSave(id: string): void {
        const timer = this._idleSaveTimers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._idleSaveTimers.delete(id);
        }
    }

    private _clearTimers(id: string): void {
        const previewTimer = this._typingPreviewTimers.get(id);
        if (previewTimer !== undefined) {
            clearTimeout(previewTimer);
            this._typingPreviewTimers.delete(id);
        }
        this._typingPreviewLastRun.delete(id);
        this._clearIdleSave(id);
    }

    private _moveTimerKey(
        map: Map<string, ReturnType<typeof setTimeout>>,
        oldId: string,
        newId: string,
    ): void {
        const timer = map.get(oldId);
        if (timer === undefined) {
            return;
        }
        map.delete(oldId);
        map.set(newId, timer);
    }

    get filePath(): string | null { return this.activeTab?.absPath ?? null; }
    get viewMode(): ViewMode { return this.activeTab?.viewMode ?? 'text'; }
    get isEditable(): boolean { return this.activeTab?.isEditable ?? false; }
    get isLoading(): boolean { return this.activeTab?.isLoading ?? false; }
    get hasUnsavedChanges(): boolean { return this.activeTab?.hasUnsavedChanges ?? false; }
    get imageSrc(): string | null { return this.activeTab?.imageSrc ?? null; }
    get fileContent(): string { return this.activeTab?.content ?? ''; }
}

export const editor = new EditorStore();
