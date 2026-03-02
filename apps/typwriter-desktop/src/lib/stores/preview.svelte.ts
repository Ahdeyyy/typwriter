import {
    triggerPreview,
    setZoom,
    getZoom,
    jumpFromCursor,
} from '$lib/ipc/commands';
import {
    onPreviewTotalPages,
    onPreviewPageUpdated,
    onPreviewPageRemoved,
    type UnlistenFn,
} from '$lib/ipc/events';

const CURSOR_DEBOUNCE = 200; // ms

class PreviewStore {
    pages        = $state<(string | null)[]>([]);
    totalPages   = $state<number>(0);
    zoom         = $state<number>(2.0);
    /** Set to a page index to trigger a scroll; consumed (reset to null) by the preview component. */
    scrollTarget = $state<number | null>(null);

    private _unlisteners: UnlistenFn[] = [];
    private _cursorTimer: ReturnType<typeof setTimeout> | null = null;

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async init(): Promise<void> {
        // Load current zoom from backend
        const zoomResult = await getZoom();
        if (zoomResult.isOk()) this.zoom = zoomResult.value;

        // Subscribe to page events
        const r1 = await onPreviewTotalPages(({ count }) => {
            this.totalPages = count;
            while (this.pages.length < count) this.pages.push(null);
            if (this.pages.length > count) this.pages = this.pages.slice(0, count);
        });
        if (r1.isOk()) this._unlisteners.push(r1.value);
        else console.error('preview: onPreviewTotalPages listener failed:', r1.error);

        const r2 = await onPreviewPageUpdated(({ index, data }) => {
            while (this.pages.length <= index) this.pages.push(null);
            this.pages[index] = data;
        });
        if (r2.isOk()) this._unlisteners.push(r2.value);
        else console.error('preview: onPreviewPageUpdated listener failed:', r2.error);

        const r3 = await onPreviewPageRemoved(({ index }) => {
            this.pages.splice(index, 1);
            this.totalPages = Math.max(0, this.totalPages - 1);
        });
        if (r3.isOk()) this._unlisteners.push(r3.value);
        else console.error('preview: onPreviewPageRemoved listener failed:', r3.error);

        // Initial compile
        triggerPreview().mapErr(err => console.error('preview: initial triggerPreview failed:', err));
    }

    destroy(): void {
        for (const ul of this._unlisteners) ul();
        this._unlisteners = [];
        if (this._cursorTimer !== null) {
            clearTimeout(this._cursorTimer);
            this._cursorTimer = null;
        }
    }

    // ─── Cursor → Preview sync ────────────────────────────────────────────────

    setCursorPosition(path: string, offset: number): void {
        if (this._cursorTimer !== null) clearTimeout(this._cursorTimer);
        this._cursorTimer = setTimeout(() => {
            jumpFromCursor(path, offset)
                .map(positions => {
                    if (positions.length > 0) this.scrollTarget = positions[0].page;
                })
                .mapErr(err => console.error('preview: jumpFromCursor failed:', err));
        }, CURSOR_DEBOUNCE);
    }

    // ─── Zoom ─────────────────────────────────────────────────────────────────

    async zoomIn(): Promise<void> {
        await this._applyZoom(Math.min(8.0, this.zoom + 0.5));
    }

    async zoomOut(): Promise<void> {
        await this._applyZoom(Math.max(0.5, this.zoom - 0.5));
    }

    private async _applyZoom(scale: number): Promise<void> {
        const result = await setZoom(scale);
        if (result.isErr()) {
            console.error('preview: setZoom failed:', result.error);
            return;
        }
        this.zoom = scale;
        triggerPreview().mapErr(err => console.error('preview: triggerPreview after zoom failed:', err));
    }

    // ─── Manual refresh ───────────────────────────────────────────────────────

    async triggerRefresh(): Promise<void> {
        triggerPreview().mapErr(err => console.error('preview: triggerRefresh failed:', err));
    }
}

export const preview = new PreviewStore();
