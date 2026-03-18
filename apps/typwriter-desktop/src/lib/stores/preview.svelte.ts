import {
    getZoom,
    jumpFromCursor,
    setZoom,
    triggerPreview,
} from '$lib/ipc/commands';
import {
    onPreviewCompileState,
    onPreviewPageRemoved,
    onPreviewPageUpdated,
    onPreviewTotalPages,
    type UnlistenFn,
} from '$lib/ipc/events';
import type { CompileReason } from '$lib/types';
import { logError } from '$lib/logger';

const CURSOR_DEBOUNCE = 200;

class PreviewStore {
    pages = $state<(string | null)[]>([]);
    totalPages = $state<number>(0);
    zoom = $state<number>(2.0);
    scrollTarget = $state<number | null>(null);
    isCompiling = $state(false);
    lastCompileRevision = $state(0);
    lastCompileReason = $state<CompileReason>('explicit');

    private _unlisteners: UnlistenFn[] = [];
    private _cursorTimer: ReturnType<typeof setTimeout> | null = null;

    async init(): Promise<void> {
        const zoomResult = await getZoom();
        if (zoomResult.isOk()) {
            this.zoom = zoomResult.value;
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

        const updatedResult = await onPreviewPageUpdated(({ index, data }) => {
            while (this.pages.length <= index) {
                this.pages.push(null);
            }
            this.pages[index] = data;
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

        triggerPreview('explicit').mapErr((err) =>
            logError('preview: initial triggerPreview failed:', err)
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
    }

    setCursorPosition(path: string, offset: number): void {
        if (this._cursorTimer !== null) {
            clearTimeout(this._cursorTimer);
        }
        this._cursorTimer = setTimeout(() => {
            jumpFromCursor(path, offset)
                .map((positions) => {
                    if (positions.length > 0) {
                        this.scrollTarget = positions[0].page;
                    }
                })
                .mapErr((err) => logError('preview: jumpFromCursor failed:', err));
        }, CURSOR_DEBOUNCE);
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
