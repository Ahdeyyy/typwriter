import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import { ResultAsync } from 'neverthrow';

import type {
    DiagnosticsPayload,
    TotalPagesPayload,
    PageUpdatedPayload,
    PageRemovedPayload,
    CompileStatePayload,
    WorkspaceFilesChangedPayload
} from '$lib/types';

export type { UnlistenFn };

const toErrString = (e: unknown): string => String(e);

// ─── Compile events ───────────────────────────────────────────────────────────

export function onCompileDiagnostics(handler: (payload: DiagnosticsPayload) => void) {
    return ResultAsync.fromPromise(
        listen<DiagnosticsPayload>('compile:diagnostics', (event: Event<DiagnosticsPayload>) =>
            handler(event.payload)
        ),
        toErrString
    );
}

// ─── Preview events ───────────────────────────────────────────────────────────

export function onPreviewTotalPages(handler: (payload: TotalPagesPayload) => void) {
    return ResultAsync.fromPromise(
        listen<TotalPagesPayload>('preview:total-pages', (event: Event<TotalPagesPayload>) =>
            handler(event.payload)
        ),
        toErrString
    );
}

export function onPreviewPageUpdated(handler: (payload: PageUpdatedPayload) => void) {
    return ResultAsync.fromPromise(
        listen<PageUpdatedPayload>('preview:page-updated', (event: Event<PageUpdatedPayload>) =>
            handler(event.payload)
        ),
        toErrString
    );
}

export function onPreviewPageRemoved(handler: (payload: PageRemovedPayload) => void) {
    return ResultAsync.fromPromise(
        listen<PageRemovedPayload>('preview:page-removed', (event: Event<PageRemovedPayload>) =>
            handler(event.payload)
        ),
        toErrString
    );
}

export function onPreviewCompileState(handler: (payload: CompileStatePayload) => void) {
    return ResultAsync.fromPromise(
        listen<CompileStatePayload>('preview:compile-state', (event: Event<CompileStatePayload>) =>
            handler(event.payload)
        ),
        toErrString
    );
}

// ─── Workspace events ─────────────────────────────────────────────────────────

export function onWorkspaceFilesChanged(handler: (payload: WorkspaceFilesChangedPayload) => void) {
    return ResultAsync.fromPromise(
        listen<WorkspaceFilesChangedPayload>(
            'workspace:files-changed',
            (event: Event<WorkspaceFilesChangedPayload>) => handler(event.payload)
        ),
        toErrString
    );
}
