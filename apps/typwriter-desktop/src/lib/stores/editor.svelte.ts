import { ResultAsync } from 'neverthrow';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
    discardShadow,
    formatTypstSource,
    formatTypstSourceWithCursor,
    readFile,
    saveFile,
    triggerPreview,
    updateFileContent,
} from '$lib/ipc/commands';
import type { CompileReason } from '$lib/types';
import { workspace } from './workspace.svelte';
import { settings } from './settings.svelte';
import { normalize, basename } from '$lib/paths';
import { logError } from '$lib/logger';
import { toast } from 'svelte-sonner';

export type ViewMode = 'text' | 'image' | 'unsupported';

function imageAssetSrc(path: string): string {
    return convertFileSrc(normalize(path));
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

// Small enough to feel instant (~half a frame at 60Hz), large enough to
// swallow same-frame keystroke bursts so we don't fire one IPC per key.
const TYPING_PREVIEW_INTERVAL = 8;

class EditorStore {
    tabs = $state<TabInfo[]>([]);
    activeTabId = $state<string | null>(null);

    activeTab = $derived(
        this.activeTabId !== null
            ? (this.tabs.find((t) => t.id === this.activeTabId) ?? null)
            : null
    );

    cursorJumpRequest = $state<{ tabId: string; offset: number } | null>(null);
    contentSyncRequest = $state<{
        tabId: string;
        content: string;
        version: number;
        cursor?: number;
    } | null>(null);
    private _contentSyncVersion = 0;

    /** Live cursor lookup registered by the editor component (maps a tab id to
     *  the head of its CodeMirror selection, in UTF-16 code units). Lets format
     *  paths that receive no explicit cursor — format-on-save, idle-save,
     *  menu actions — still run cursor maintenance instead of letting the
     *  content sync's coarse fallback yank the caret. Deliberately not
     *  reactive state: it's a callback, not data. */
    cursorProvider: ((tabId: string) => number | undefined) | null = null;

    private _shadowWriteVersions = new Map<string, number>();
    private _idleSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private _typingPreviewTimers = new Map<string, ReturnType<typeof setTimeout>>();

    requestCursorJump(tabId: string, offset: number): void {
        this.cursorJumpRequest = { tabId, offset };
    }

    openFile(relPath: string, unsavedContent?: string): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._openFile(relPath, unsavedContent), (err) => String(err));
    }

    private async _openFile(relPath: string, unsavedContent?: string): Promise<void> {
        const id = normalize(relPath);
        if (this.activeTabId && this.activeTabId !== id) {
            await this.flushActiveTab();
        }

        const existing = this.tabs.find((t) => t.id === id);
        if (existing) {
            this.activeTabId = id;
            workspace.schedulePersistTabs();
            return;
        }

        const tab = this._createLoadingTab(id);
        this.tabs.push(tab);
        this.activeTabId = id;
        workspace.schedulePersistTabs();

        // Hot-exit restore: if durable unsaved content was captured before the
        // app was torn down (e.g. the OS killed the WebView while backgrounded),
        // seed the buffer from it instead of the now-stale disk copy, and mark
        // the tab dirty so it still needs an explicit save. Also re-seed the
        // Rust shadow so the next compile renders the restored buffer. Unsaved
        // buffers are only ever captured for editable text tabs, so it's safe
        // to treat the override as text without consulting the backend.
        if (typeof unsavedContent === 'string') {
            this._seedUnsavedText(tab, unsavedContent);
            return;
        }

        await this._loadTabContent(id);
    }

    async activateTab(tabId: string): Promise<void> {
        if (this.activeTabId === tabId) {
            return;
        }
        await this.flushActiveTab();
        this.activeTabId = tabId;
        workspace.schedulePersistTabs();
    }

    /** Restore a set of tabs at workspace-open time.
     *
     *  Tab descriptors are created synchronously so the tab-bar order matches
     *  the persisted order, then every tab's on-disk content is loaded
     *  *concurrently*. Reading each file is an IPC round-trip; doing them one
     *  after another (the previous per-tab `openFile` loop) made workspace open
     *  scale linearly with tab count — painfully so on mobile where IPC latency
     *  dominates. Unsaved (hot-exit) buffers are seeded without a disk read.
     *
     *  Assumes the editor was just reset (no existing tabs) — the workspace
     *  open path calls `reset()` before this. */
    async restoreTabs(
        tabPaths: string[],
        activeTabId: string | null,
        unsaved: Record<string, string>,
    ): Promise<void> {
        const loads: Promise<void>[] = [];

        for (const relPath of tabPaths) {
            const id = normalize(relPath);
            if (this.tabs.find((t) => t.id === id)) {
                continue;
            }

            const tab = this._createLoadingTab(id);
            this.tabs.push(tab);

            // Hot-exit restore: seed from the durable unsaved buffer instead of
            // the now-stale disk copy, mark the tab dirty, and re-seed the Rust
            // shadow so the next compile renders the restored buffer. Mirrors
            // the unsaved-content branch in `_openFile`.
            const override = unsaved[relPath] ?? unsaved[id];
            if (typeof override === 'string') {
                this._seedUnsavedText(tab, override);
                continue;
            }

            loads.push(
                this._loadTabContent(id).catch((err) =>
                    logError(`restore tab failed for ${relPath}:`, err)
                )
            );
        }

        await Promise.all(loads);

        // Activate the previously-active tab, falling back to the first one.
        this.activeTabId =
            activeTabId && this.tabs.some((t) => t.id === activeTabId)
                ? activeTabId
                : (this.tabs[0]?.id ?? null);
        workspace.schedulePersistTabs();
    }

    /** Build a tab in its provisional loading state. The backend's `read_file`
     *  response is the single authority on `viewMode`/`isEditable` (see
     *  `_loadTabContent`); until it resolves we assume text so the tab bar and
     *  editor pane (which gate on `isLoading`) show a loading skeleton rather
     *  than flashing the wrong viewer. */
    private _createLoadingTab(id: string): TabInfo {
        return {
            id,
            relPath: id,
            absPath: workspace.toAbs(id),
            name: basename(id),
            viewMode: 'text',
            isEditable: false,
            content: '',
            imageSrc: null,
            hasUnsavedChanges: false,
            isLoading: true,
        };
    }

    /** Seed a tab from a durable unsaved (hot-exit) buffer. Such buffers are
     *  only ever captured for editable text tabs, so we render as text without
     *  a backend round-trip and re-seed the Rust shadow so the next compile
     *  sees the restored content. */
    private _seedUnsavedText(tab: TabInfo, content: string): void {
        tab.viewMode = 'text';
        tab.isEditable = true;
        tab.content = content;
        tab.hasUnsavedChanges = true;
        tab.isLoading = false;
        updateFileContent(tab.absPath, content).mapErr((err) =>
            logError('restore unsaved shadow write failed:', err)
        );
    }

    /** Load a tab's content from disk and let the backend response decide how to
     *  render it. `read_file` classifies by extension and returns `unsupported`
     *  without reading bytes for unknown types, so this is the single source of
     *  truth for `viewMode` — the frontend no longer keeps its own allowlist. */
    private async _loadTabContent(tabId: string): Promise<void> {
        const tab = this.tabs.find((t) => t.id === tabId);
        if (!tab) {
            return;
        }
        const response = await readFile(tab.absPath);
        const liveTab = this.tabs.find((t) => t.id === tabId);
        if (!liveTab) {
            return;
        }
        if (response.isErr()) {
            liveTab.isLoading = false;
            throw new Error(response.error);
        }

        const res = response.value;
        switch (res.type) {
            case 'text':
                liveTab.viewMode = 'text';
                liveTab.isEditable = true;
                liveTab.content = res.content;
                liveTab.imageSrc = null;
                break;
            case 'image':
                liveTab.viewMode = 'image';
                liveTab.isEditable = false;
                liveTab.imageSrc = imageAssetSrc(res.path);
                liveTab.content = '';
                break;
            case 'unsupported':
                liveTab.viewMode = 'unsupported';
                liveTab.isEditable = false;
                liveTab.content = '';
                liveTab.imageSrc = null;
                break;
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
                logError('discardShadow error on close:', err)
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

        workspace.schedulePersistTabs();
        return true;
    }

    async closeOtherTabs(keepId: string): Promise<void> {
        const toClose = this.tabs.filter((t) => t.id !== keepId).map((t) => t.id);
        for (const id of toClose) {
            await this.closeTab(id);
        }
    }

    async closeTabsToLeft(pivotId: string): Promise<void> {
        const idx = this.tabs.findIndex((t) => t.id === pivotId);
        if (idx <= 0) return;
        const toClose = this.tabs.slice(0, idx).map((t) => t.id);
        for (const id of toClose) {
            await this.closeTab(id);
        }
    }

    async closeTabsToRight(pivotId: string): Promise<void> {
        const idx = this.tabs.findIndex((t) => t.id === pivotId);
        if (idx === -1 || idx === this.tabs.length - 1) return;
        const toClose = this.tabs.slice(idx + 1).map((t) => t.id);
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

        // Refresh the live preview as the user types.
        this._scheduleTypingPreview(tab);
        this._scheduleIdleSave(tab);
        // Persist the unsaved buffer to durable storage (debounced) so it
        // survives a non-graceful teardown — see getTabState / hot-exit restore.
        workspace.schedulePersistTabs();
    }

    formatActiveFile(): ResultAsync<void, string> {
        const tab = this.activeTab;
        if (!tab) {
            return ResultAsync.fromSafePromise(Promise.resolve());
        }
        return this.formatTabById(tab.id);
    }

    formatTabById(tabId: string, cursor?: number): ResultAsync<void, string> {
        const tab = this.tabs.find((t) => t.id === tabId);
        if (!tab || !tab.isEditable || !tab.relPath.endsWith('.typ')) {
            return ResultAsync.fromSafePromise(Promise.resolve());
        }
        const original = tab.content;
        const applyResult = (formatted: string, newCursor: number | undefined) => {
            // If the user typed while format was running, don't clobber
            // their newer keystrokes with a stale formatted result.
            if (tab.content !== original) return;
            if (formatted === original) return;
            tab.content = formatted;
            tab.hasUnsavedChanges = true;
            this.contentSyncRequest = {
                tabId: tab.id,
                content: formatted,
                version: ++this._contentSyncVersion,
                cursor: newCursor,
            };
            void this._writeShadowNow(tab);
        };

        // Cursor maintenance runs in Rust on UTF-8 bytes; the IPC boundary
        // is the only place we deal in UTF-16. Callers that don't know the
        // cursor (format-on-save, menu actions) fall back to the live view's
        // selection via the registered provider.
        const effectiveCursor =
            typeof cursor === 'number' && cursor >= 0
                ? cursor
                : this.cursorProvider?.(tabId);
        if (typeof effectiveCursor === 'number' && effectiveCursor >= 0) {
            // Clamp against the buffer we're actually sending: a cursor read
            // from a view that is mid-sync could be momentarily out of range,
            // and Rust rejects out-of-range offsets outright.
            const clamped = Math.min(effectiveCursor, original.length);
            return formatTypstSourceWithCursor(original, clamped).map((res) => {
                applyResult(res.formatted, res.cursor);
            });
        }
        return formatTypstSource(original).map((formatted) => {
            applyResult(formatted, undefined);
        });
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

        // Optional format-on-save for .typ files. Errors are logged and
        // swallowed — a failed format must not block the user's save.
        if (settings.formatBeforeSave && tab.relPath.endsWith('.typ')) {
            const result = await this.formatTabById(tab.id);
            if (result.isErr()) {
                logError('format-on-save failed:', result.error);
            }
        }

        await this._flushShadowWrite(tab);

        const contentToSave = tab.content;
        const saveResult = await saveFile(tab.absPath, contentToSave);
        if (saveResult.isErr()) {
            const message = `Failed to save ${tab.name}: ${saveResult.error}`;
            toast.error(message);
            throw new Error(message);
        }

        // Don't clear the dirty flag if the user typed during the save —
        // their newer content still needs to be persisted on the next pass.
        if (tab.content === contentToSave) {
            tab.hasUnsavedChanges = false;
            // The tab is clean now; re-persist so it drops out of the durable
            // unsaved map and a later restore doesn't resurrect stale edits.
            workspace.schedulePersistTabs();
        }
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

    /** Force every open tab to re-read its content from disk and replay that
     *  content into CodeMirror. Used after operations that mutate the working
     *  tree outside the editor — currently the VCS restore path.
     *
     *  Any in-memory unsaved edits are intentionally dropped: the user opted
     *  into a restore. We also discard the shadow buffer per file so the next
     *  compile sees the on-disk content, not stale shadow bytes. Tabs whose
     *  file no longer exists are closed quietly. */
    async reloadAllTabsFromDisk(): Promise<void> {
        for (const tab of [...this.tabs]) {
            this._clearTimers(tab.id);
            // Drop the shadow buffer; disk is now the source of truth.
            if (tab.viewMode === 'text') {
                discardShadow(tab.absPath).mapErr((err) =>
                    logError('reloadAllTabsFromDisk: discardShadow:', err)
                );
            }
            if (tab.viewMode === 'unsupported') {
                continue;
            }

            const response = await readFile(tab.absPath);
            if (response.isErr()) {
                // File is gone (e.g. restore deleted it). Close the tab.
                await this.closeTab(tab.id, { flush: false });
                continue;
            }

            if (tab.viewMode === 'image') {
                if (response.value.type === 'image') {
                    tab.imageSrc = imageAssetSrc(response.value.path);
                }
                tab.hasUnsavedChanges = false;
                continue;
            }

            if (response.value.type !== 'text') {
                continue;
            }
            const content = response.value.content;
            tab.content = content;
            tab.hasUnsavedChanges = false;
            // Push the new content through the regular sync channel so the
            // CodeMirror updateListener doesn't fight us.
            this.contentSyncRequest = {
                tabId: tab.id,
                content,
                version: ++this._contentSyncVersion,
            };
        }
    }

    async reset(): Promise<void> {
        for (const tab of [...this.tabs]) {
            await this.closeTab(tab.id, { flush: false });
        }
        this.activeTabId = null;
        this.cursorJumpRequest = null;
    }

    updateTabPath(oldId: string, newRelPath: string): void {
        const tab = this.tabs.find((t) => t.id === oldId);
        if (!tab) {
            return;
        }

        const newId = normalize(newRelPath);
        if (newId === oldId) {
            return;
        }

        const collidingIdx = this.tabs.findIndex((t) => t.id === newId && t.id !== oldId);
        if (collidingIdx !== -1) {
            const colliding = this.tabs[collidingIdx];
            this._clearTimers(colliding.id);
            if (colliding.viewMode === 'text') {
                discardShadow(colliding.absPath).mapErr((err) =>
                    logError('discardShadow error on collision close:', err)
                );
            }
            this.tabs.splice(collidingIdx, 1);
            if (this.activeTabId === colliding.id) {
                this.activeTabId = oldId;
            }
        }

        this._moveTimerKey(this._idleSaveTimers, oldId, newId);
        this._moveTimerKey(this._typingPreviewTimers, oldId, newId);
        const shadowVersion = this._shadowWriteVersions.get(oldId);
        if (shadowVersion !== undefined) {
            this._shadowWriteVersions.delete(oldId);
            this._shadowWriteVersions.set(newId, shadowVersion);
        }

        tab.id = newId;
        tab.relPath = newId;
        tab.absPath = workspace.toAbs(newId);
        tab.name = basename(newId);

        if (this.activeTabId === oldId) {
            this.activeTabId = newId;
        }

        workspace.schedulePersistTabs();
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

    // Note: closures below read `tab.id` at fire time (not a captured string)
    // so a rename via updateTabPath — which mutates tab.id and re-keys the
    // timer maps — still resolves to the live tab. Capturing tabId as a
    // string would silently break auto-save and typing preview after rename.
    private _scheduleTypingPreview(tab: TabInfo): void {
        // Throttle: if a fire is already scheduled, the latest content will
        // be picked up when it runs — no need to reset the timer (which
        // would push the fire further out and slow the trailing edge).
        if (this._typingPreviewTimers.has(tab.id)) return;
        this._typingPreviewTimers.set(tab.id, setTimeout(() => {
            this._typingPreviewTimers.delete(tab.id);
            this._fireTypingPreview(tab);
        }, TYPING_PREVIEW_INTERVAL));
    }

    private _fireTypingPreview(tab: TabInfo): void {
        if (!this.tabs.includes(tab) || !tab.isEditable || !tab.hasUnsavedChanges) {
            return;
        }
        const version = (this._shadowWriteVersions.get(tab.id) ?? 0) + 1;
        this._shadowWriteVersions.set(tab.id, version);
        void this._writeShadow(tab, version)
            .then(() => this._requestPreview('typing'))
            .catch((err) => logError('shadow write before preview failed:', err));
    }

    private _scheduleIdleSave(tab: TabInfo): void {
        this._clearIdleSave(tab.id);
        if (!settings.autoSaveEnabled) return;
        this._idleSaveTimers.set(tab.id, setTimeout(() => {
            void this.flushTab(tab.id).catch(() => {});
        }, settings.autoSaveDelayMs));
    }

    private _requestPreview(reason: CompileReason): void {
        triggerPreview(reason).mapErr((err) => {
            logError('preview trigger error:', err);
        });
    }

    private async _writeShadowNow(tab: TabInfo): Promise<void> {
        const version = (this._shadowWriteVersions.get(tab.id) ?? 0) + 1;
        this._shadowWriteVersions.set(tab.id, version);
        await this._writeShadow(tab, version);
    }

    private async _flushShadowWrite(tab: TabInfo): Promise<void> {
        const version = this._shadowWriteVersions.get(tab.id);
        if (version === undefined) return;
        await this._writeShadow(tab, version);
    }

    private async _writeShadow(tab: TabInfo, version: number): Promise<void> {
        if (!this.tabs.includes(tab) || !tab.isEditable) return;
        if (this._shadowWriteVersions.get(tab.id) !== version) return;

        const result = await updateFileContent(tab.absPath, tab.content);
        if (result.isErr()) {
            logError('shadow write error:', result.error);
            toast.error(`Shadow update failed for ${tab.name}: ${result.error}`);
            throw new Error(result.error);
        }
        if (this._shadowWriteVersions.get(tab.id) === version) {
            this._shadowWriteVersions.delete(tab.id);
        }
    }

    private _clearIdleSave(id: string): void {
        const timer = this._idleSaveTimers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._idleSaveTimers.delete(id);
        }
    }

    private _clearTimers(id: string): void {
        this._shadowWriteVersions.delete(id);
        const typingTimer = this._typingPreviewTimers.get(id);
        if (typingTimer !== undefined) {
            clearTimeout(typingTimer);
            this._typingPreviewTimers.delete(id);
        }
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

    getTabState(): { tabs: string[]; activeTabId: string | null; unsaved: Record<string, string> } {
        // Capture the live buffer of every dirty, editable text tab so it can be
        // restored verbatim after a teardown (hot exit). Clean tabs are omitted
        // — their content is already on disk.
        const unsaved: Record<string, string> = {};
        for (const t of this.tabs) {
            if (t.isEditable && t.hasUnsavedChanges) {
                unsaved[t.relPath] = t.content;
            }
        }
        return {
            tabs: this.tabs.map((t) => t.relPath),
            activeTabId: this.activeTabId,
            unsaved,
        };
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
