import { emit, listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import { ResultAsync } from 'neverthrow';

export interface EditorCursorPositionPayload {
    path: string;
    offset: number;
    /** Whether this cursor move should draw the preview highlight — true for a
     *  pure caret move (click / arrow key), false when it coalesced with a
     *  keystroke that also changed the document. */
    showHighlight: boolean;
}

export interface PreviewSourceJumpPayload {
    path: string;
    offset: number;
}

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

// ─── App init events ──────────────────────────────────────────────────────────

export function onAppFontsLoaded(handler: () => void) {
    return ResultAsync.fromPromise(
        listen<void>('app:fonts-loaded', () => handler()),
        toErrString
    );
}

// ─── Cross-window preview <-> editor sync ────────────────────────────────────

export function onEditorCursorPosition(handler: (payload: EditorCursorPositionPayload) => void) {
    return ResultAsync.fromPromise(
        listen<EditorCursorPositionPayload>('editor:cursor-position', (event) => handler(event.payload)),
        toErrString
    );
}

export function emitEditorCursorPosition(payload: EditorCursorPositionPayload) {
    return ResultAsync.fromPromise(emit('editor:cursor-position', payload), toErrString);
}

export function onPreviewSourceJump(handler: (payload: PreviewSourceJumpPayload) => void) {
    return ResultAsync.fromPromise(
        listen<PreviewSourceJumpPayload>('preview:source-jump', (event) => handler(event.payload)),
        toErrString
    );
}

export function emitPreviewSourceJump(payload: PreviewSourceJumpPayload) {
    return ResultAsync.fromPromise(emit('preview:source-jump', payload), toErrString);
}

// ─── Cross-window settings sync ──────────────────────────────────────────────
//
// The settings page lives in its own webview window; every window keeps a
// separate SettingsStore instance, so a change made in one must be replayed
// into the others. The payload is the full persisted settings object — the
// receiver applies it without re-persisting (the emitter already did).

export function onSettingsChanged<T>(handler: (payload: T) => void) {
    return ResultAsync.fromPromise(
        listen<T>('settings:changed', (event) => handler(event.payload)),
        toErrString
    );
}

export function emitSettingsChanged<T>(payload: T) {
    return ResultAsync.fromPromise(emit('settings:changed', payload), toErrString);
}

// ─── Cross-window vcs diff window sync ───────────────────────────────────────

export interface VcsDiffSelectionPayload {
    primaryId: string | null;
    secondaryId: string | null;
}

/** Main window → diff window: retarget an already-open diff window. */
export function onVcsDiffSelection(handler: (payload: VcsDiffSelectionPayload) => void) {
    return ResultAsync.fromPromise(
        listen<VcsDiffSelectionPayload>('vcs:diff-selection', (event) => handler(event.payload)),
        toErrString
    );
}

export function emitVcsDiffSelection(payload: VcsDiffSelectionPayload) {
    return ResultAsync.fromPromise(emit('vcs:diff-selection', payload), toErrString);
}

export interface VcsRestoreFileRequestPayload {
    pointId: string;
    path: string;
}

export interface VcsRestoreFileResultPayload {
    path: string;
    /** `null` on success, error message on failure. */
    error: string | null;
}

/** Diff window → main window: restore a single file. Delegated because the
 *  editor tabs that must be flushed before — and reloaded after — the restore
 *  live in the main window's stores. */
export function onVcsRestoreFileRequest(handler: (payload: VcsRestoreFileRequestPayload) => void) {
    return ResultAsync.fromPromise(
        listen<VcsRestoreFileRequestPayload>('vcs:restore-file-request', (event) =>
            handler(event.payload)
        ),
        toErrString
    );
}

export function emitVcsRestoreFileRequest(payload: VcsRestoreFileRequestPayload) {
    return ResultAsync.fromPromise(emit('vcs:restore-file-request', payload), toErrString);
}

/** Main window → diff window: outcome of a delegated file restore. */
export function onVcsRestoreFileResult(handler: (payload: VcsRestoreFileResultPayload) => void) {
    return ResultAsync.fromPromise(
        listen<VcsRestoreFileResultPayload>('vcs:restore-file-result', (event) =>
            handler(event.payload)
        ),
        toErrString
    );
}

export function emitVcsRestoreFileResult(payload: VcsRestoreFileResultPayload) {
    return ResultAsync.fromPromise(emit('vcs:restore-file-result', payload), toErrString);
}
