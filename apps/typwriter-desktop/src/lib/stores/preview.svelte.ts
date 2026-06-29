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
import type { CompileReason, PreviewHighlightRect } from '$lib/types';
import { logError, logPreview } from '$lib/logger';
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
// How long the cursor-sync highlight stays on screen before fading out. Must
// match the `cursor-sync-fade` CSS animation in the preview components.
const HIGHLIGHT_DURATION = 1600;

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

    /** Transient highlight drawn over the preview after a cursor-sync jump so the
     *  user can see which rendered text the caret maps to. Cleared automatically
     *  after `HIGHLIGHT_DURATION`. `nonce` changes on every set so the component
     *  can restart its fade animation even when the same page is highlighted
     *  twice in a row. Rects/dimensions are in typst points. */
    highlight = $state<{
        page: number;
        rects: PreviewHighlightRect[];
        pageWidth: number;
        pageHeight: number;
        nonce: number;
    } | null>(null);

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
    private _highlightTimer: ReturnType<typeof setTimeout> | null = null;
    private _highlightNonce = 0;
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
            // Stage 3a: the total page count changed. Growing/shrinking `pages`
            // resizes the scroll container — a prime cause of the scroll
            // position jumping mid-edit (added skeletons push content down,
            // removed pages pull it up).
            logPreview('event:total-pages', {
                count,
                prevCount: this.totalPages,
                prevPagesLen: this.pages.length,
            });
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
            // Stage 3b: one page slot got a new fingerprint (new render). A
            // changed fingerprint for an *existing* slot swaps the image in
            // place (no reflow); a brand-new index extends the buffer.
            const prev = this.pages[index] ?? null;
            logPreview('event:page-updated', {
                index,
                changed: prev !== fingerprint,
                isNewSlot: index >= this.pages.length,
                fingerprint: fingerprint.slice(0, 12),
            });
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
            // Stage 3c: a trailing page was dropped. Removing a slot shrinks the
            // scroll container; if the user was scrolled below it, the viewport
            // jumps upward.
            logPreview('event:page-removed', {
                index,
                prevPagesLen: this.pages.length,
                prevTotal: this.totalPages,
            });
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
            // Stage 3d: compile lifecycle marker. Brackets the page events above
            // so you can attribute a burst of total-pages/page-updated/-removed
            // churn to a specific compile (and its `reason`: typing vs save vs …).
            logPreview('event:compile-state', { status, revision, reason });
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
        this._clearHighlight();
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
        this._clearHighlight();
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
        // Stage 2a: a cursor move arrived. Note whether it coalesced with a
        // still-pending debounce timer — rapid typing keeps resetting this, so
        // only the final keystroke in a burst actually runs the jump.
        const coalesced = this._cursorTimer !== null;
        logPreview('cursor:debounce-scheduled', {
            path,
            offset,
            coalesced,
            debounceMs: CURSOR_DEBOUNCE,
        });
        if (this._cursorTimer !== null) {
            clearTimeout(this._cursorTimer);
        }
        this._cursorTimer = setTimeout(() => {
            this._cursorTimer = null;
            if (this.poppedOut) {
                logPreview('cursor:forward-to-popout', { path, offset });
                emitEditorCursorPosition({ path, offset }).mapErr((err) =>
                    logError('preview: emit editor:cursor-position failed:', err)
                );
                return;
            }
            this._runCursorJump(path, offset);
        }, CURSOR_DEBOUNCE);
    }

    private _runCursorJump(path: string, offset: number): void {
        logPreview('cursor:jump-from-cursor:start', { path, offset });
        jumpFromCursor(path, offset)
            .map((position) => {
                if (position) {
                    const { page, x, y } = position;
                    // Stage 2b: the backend mapped this source offset to a
                    // page+coordinate. Setting `scrollTarget` is what triggers
                    // the preview to auto-scroll (Stage 5). A `null` position
                    // means no mapping — the preview stays put, which is why it
                    // "doesn't jump sometimes".
                    logPreview('cursor:scroll-target-set', { page, x, y });
                    this.scrollTarget = { page, x, y };
                    if (position.highlights.length > 0) {
                        this._setHighlight(
                            page,
                            position.highlights,
                            position.page_width,
                            position.page_height,
                        );
                    }
                } else {
                    logPreview('cursor:no-position', { path, offset });
                }
            })
            .mapErr((err) => logError('preview: jumpFromCursor failed:', err));
    }

    /** Show the cursor-sync highlight on `page`, then auto-clear it. */
    private _setHighlight(
        page: number,
        rects: PreviewHighlightRect[],
        pageWidth: number,
        pageHeight: number,
    ): void {
        if (this._highlightTimer !== null) {
            clearTimeout(this._highlightTimer);
        }
        this._highlightNonce += 1;
        this.highlight = { page, rects, pageWidth, pageHeight, nonce: this._highlightNonce };
        this._highlightTimer = setTimeout(() => {
            this._highlightTimer = null;
            this.highlight = null;
        }, HIGHLIGHT_DURATION);
    }

    /** Clear any active highlight and its pending auto-clear timer. */
    private _clearHighlight(): void {
        if (this._highlightTimer !== null) {
            clearTimeout(this._highlightTimer);
            this._highlightTimer = null;
        }
        this.highlight = null;
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
