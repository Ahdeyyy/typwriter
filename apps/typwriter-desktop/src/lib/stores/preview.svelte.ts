import {
    getZoom,
    jumpFromCursor,
    setZoom,
    syncPreview,
    triggerPreview,
} from '$lib/ipc/commands'; // triggerPreview still used by zoom/refresh paths
import {
    emitEditorCursorPosition,
    onEditorCursorPosition,
    onPreviewCompileState,
    onPreviewPageRemoved,
    onPreviewPageUpdated,
    onPreviewTotalPages,
    type UnlistenFn,
} from '$lib/ipc/events';
import type { CompileReason } from '$lib/types';
import { logError } from '$lib/logger';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { crossWindowState } from '$lib/ipc/cross-window-state.svelte';
import { platform } from './platform.svelte';
import { settings } from './settings.svelte';

const PREVIEW_WINDOW_LABEL = 'preview';

function isPopoutWindow(): boolean {
    if (!platform.isDesktop) return false;
    try {
        return getCurrentWindow().label === PREVIEW_WINDOW_LABEL;
    } catch {
        return false;
    }
}

const CURSOR_DEBOUNCE = 200;

class PreviewStore {
    /** Per-page hex fingerprint (null while a page slot exists but no
     *  render has arrived yet). Rendered PNGs live in the Rust page cache
     *  and are fetched on demand via the `previewimg` URI scheme. */
    pages = $state<(string | null)[]>([]);
    isCompiling = $state(false);
    lastCompileRevision = $state(0);
    lastCompileReason = $state<CompileReason>('explicit');
    poppedOut = $state(false);
    presentationMode = $state(false);

    // Synced across every Tauri window so the popout and main pane stay
    // consistent without each consumer wiring its own listener. See
    // `$lib/ipc/cross-window-state.svelte.ts`.
    private _zoom = crossWindowState<number>('preview:zoom', 2.0);
    private _paginated = crossWindowState<boolean>('preview:paginated', false);
    private _totalPages = crossWindowState<number>('preview:totalPages', 0);
    private _scrollTarget = crossWindowState<{ page: number; x: number; y: number } | null>(
        'preview:scrollTarget',
        null,
    );
    private _visiblePage = crossWindowState<number>('preview:visiblePage', 0);
    get visiblePage(): number { return this._visiblePage.value; }
    set visiblePage(v: number) { this._visiblePage.set(v); }
    get totalPages(): number { return this._totalPages.value; }
    set totalPages(v: number) { this._totalPages.set(v); }
    get zoom(): number { return this._zoom.value; }
    set zoom(v: number) { this._zoom.set(v); }
    get paginated(): boolean { return this._paginated.value; }
    set paginated(v: boolean) { this._paginated.set(v); }
    get scrollTarget(): { page: number; x: number; y: number } | null { return this._scrollTarget.value; }
    set scrollTarget(v: { page: number; x: number; y: number } | null) { this._scrollTarget.set(v); }

    private _unlisteners: UnlistenFn[] = [];
    private _cursorTimer: ReturnType<typeof setTimeout> | null = null;
    private _paginatedBeforePresentation = false;

    async init(): Promise<void> {
        // Only the main window seeds the zoom from settings. The popout is a
        // *mirror* — it should adopt whatever the main window broadcasts via
        // `crossWindowState`, not stamp its own defaultPreviewZoom back onto
        // the shared channel and override what the user just zoomed to.
        if (!isPopoutWindow()) {
            const desiredZoom = settings.defaultPreviewZoom;
            this.zoom = desiredZoom;
            setZoom(desiredZoom).mapErr((err) =>
                logError('preview: applying default zoom failed:', err)
            );
            const zoomResult = await getZoom();
            if (zoomResult.isOk()) {
                this.zoom = zoomResult.value;
            }
        }

        const totalPagesResult = await onPreviewTotalPages(({ count }) => {
            this.totalPages = count;
            while (this.pages.length < count) {
                this.pages.push(null);
            }
            if (this.pages.length > count) {
                this.pages = this.pages.slice(0, count);
            }
        });
        if (totalPagesResult.isOk()) {
            this._unlisteners.push(totalPagesResult.value);
        } else {
            logError('preview: onPreviewTotalPages listener failed:', totalPagesResult.error);
        }

        const updatedResult = await onPreviewPageUpdated(({ index, fingerprint }) => {
            while (this.pages.length <= index) {
                this.pages.push(null);
            }
            this.pages[index] = fingerprint;
        });
        if (updatedResult.isOk()) {
            this._unlisteners.push(updatedResult.value);
        } else {
            logError('preview: onPreviewPageUpdated listener failed:', updatedResult.error);
        }

        const removedResult = await onPreviewPageRemoved(({ index }) => {
            this.pages.splice(index, 1);
            this.totalPages = Math.max(0, this.totalPages - 1);
        });
        if (removedResult.isOk()) {
            this._unlisteners.push(removedResult.value);
        } else {
            logError('preview: onPreviewPageRemoved listener failed:', removedResult.error);
        }

        if (isPopoutWindow()) {
            const cursorResult = await onEditorCursorPosition(({ path, offset }) => {
                this._runCursorJump(path, offset);
            });
            if (cursorResult.isOk()) {
                this._unlisteners.push(cursorResult.value);
            } else {
                logError('preview: onEditorCursorPosition listener failed:', cursorResult.error);
            }
        }

        const compileStateResult = await onPreviewCompileState(({ status, revision, reason }) => {
            this.isCompiling = status === 'started';
            this.lastCompileRevision = revision;
            this.lastCompileReason = reason;
        });
        if (compileStateResult.isOk()) {
            this._unlisteners.push(compileStateResult.value);
        } else {
            logError('preview: onPreviewCompileState listener failed:', compileStateResult.error);
        }

        // Both windows pull current cached state instead of forcing a
        // recompile. Rust's `open_folder` already requests a compile when a
        // main file is detected, and the Save / Watcher / MainFile paths
        // trigger their own compiles. Re-running an explicit compile on every
        // workspace open invalidates the page cache for free — the popout
        // then sees a blank flash and the main window can't behave as a
        // portal-source for an already-rendered document.
        syncPreview().mapErr((err) =>
            logError('preview: initial syncPreview failed:', err)
        );
    }

    destroy(): void {
        for (const unlisten of this._unlisteners) {
            unlisten();
        }
        this._unlisteners = [];
        if (this._cursorTimer !== null) {
            clearTimeout(this._cursorTimer);
            this._cursorTimer = null;
        }
        this.pages = [];
        this.totalPages = 0;
        this.scrollTarget = null;
        this.isCompiling = false;
        this.lastCompileRevision = 0;
        this.lastCompileReason = 'explicit';
        this.presentationMode = false;
    }

    /** Drop cached page state from a previous workspace. Listeners and the
     *  popped-out window state stay intact — only the rendered pages are
     *  flushed so we don't briefly show the wrong document while the new
     *  workspace compiles. */
    clear(): void {
        if (this._cursorTimer !== null) {
            clearTimeout(this._cursorTimer);
            this._cursorTimer = null;
        }
        this.pages = [];
        this.totalPages = 0;
        this.scrollTarget = null;
        this.isCompiling = false;
    }

    async togglePresentationMode(): Promise<void> {
        // Presentation mode toggles native window chrome — desktop only.
        if (!platform.isDesktop) return;
        const win = getCurrentWindow();
        if (this.presentationMode) {
            await win.setDecorations(true);
            await win.unmaximize();
            this.presentationMode = false;
            this.paginated = this._paginatedBeforePresentation;
        } else {
            await win.setDecorations(false);
            await win.maximize();
            this.presentationMode = true;
            this._paginatedBeforePresentation = this.paginated;
            this.paginated = true;
        }
    }

    togglePaginated(): void {
        if (this.presentationMode) return;
        this.paginated = !this.paginated;
    }

    setCursorPosition(path: string, offset: number): void {
        if (this._cursorTimer !== null) {
            clearTimeout(this._cursorTimer);
        }
        this._cursorTimer = setTimeout(() => {
            if (this.poppedOut) {
                emitEditorCursorPosition({ path, offset }).mapErr((err) =>
                    logError('preview: emit editor:cursor-position failed:', err)
                );
                return;
            }
            this._runCursorJump(path, offset);
        }, CURSOR_DEBOUNCE);
    }

    private _runCursorJump(path: string, offset: number): void {
        jumpFromCursor(path, offset)
            .map((position) => {
                if (position) {
                    const { page, x, y } = position;
                    this.scrollTarget = { page, x, y };
                }
            })
            .mapErr((err) => logError('preview: jumpFromCursor failed:', err));
    }

    async zoomIn(): Promise<void> {
        await this._applyZoom(Math.min(8.0, this.zoom + 0.5));
    }

    async zoomOut(): Promise<void> {
        await this._applyZoom(Math.max(0.5, this.zoom - 0.5));
    }

    private async _applyZoom(scale: number): Promise<void> {
        const result = await setZoom(scale);
        if (result.isErr()) {
            logError('preview: setZoom failed:', result.error);
            return;
        }
        this.zoom = scale;
        triggerPreview('zoom').mapErr((err) =>
            logError('preview: triggerPreview after zoom failed:', err)
        );
    }

    async triggerRefresh(): Promise<void> {
        triggerPreview('explicit').mapErr((err) =>
            logError('preview: triggerRefresh failed:', err)
        );
    }
}

export const preview = new PreviewStore();
