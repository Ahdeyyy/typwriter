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
    GrammarConfig,
    WorkspaceFilesChangedPayload,
    PageDiffPayload,
    PageDiffStartedPayload,
    PageDiffErrorPayload
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

// ─── Cross-window grammar sync ───────────────────────────────────────────────
//
// The grammar configuration is owned by the Rust engine, but every window keeps
// its own GrammarStore mirror of it — and the Grammar settings pane lives in a
// window of its own. Without a replay, turning the checker off in Settings
// leaves the editor underlining against a config the user has already changed,
// and a word added from the editor's quick fix never shows up in the Settings
// list. The payload is the config the emitter just persisted; receivers apply
// it locally and never re-emit, so there's no ping-pong.

export function onGrammarConfigChanged(handler: (config: GrammarConfig) => void) {
    return ResultAsync.fromPromise(
        listen<GrammarConfig>('grammar:config-changed', (event) => handler(event.payload)),
        toErrString
    );
}

export function emitGrammarConfigChanged(config: GrammarConfig) {
    return ResultAsync.fromPromise(emit('grammar:config-changed', config), toErrString);
}

// ─── Cross-window snippet sync ───────────────────────────────────────────────
//
// Snippets are authored in the settings window but consumed by the completion
// list in the main one, and each window keeps its own SnippetStore. Neither
// scope reaches the other window on its own: the app-wide set lives in the
// settings store, and the project file sits in `.typwriter/`, which the
// workspace watcher deliberately ignores. Without a replay, a snippet you just
// saved would not exist in the editor until the next restart.
//
// The payload names the scope that changed so a receiver only re-reads that
// one. Receivers reload and never re-emit, so there is no ping-pong.

export type SnippetScopeChanged = 'app' | 'project';

export function onSnippetsChanged(handler: (scope: SnippetScopeChanged) => void) {
    return ResultAsync.fromPromise(
        listen<SnippetScopeChanged>('snippets:changed', (event) => handler(event.payload)),
        toErrString
    );
}

export function emitSnippetsChanged(scope: SnippetScopeChanged) {
    return ResultAsync.fromPromise(emit('snippets:changed', scope), toErrString);
}

// ─── Cross-window light/dark mode sync ───────────────────────────────────────
//
// The mode lives in mode-watcher's own per-window state, so a change made from
// Settings › Appearance has to be replayed into the other windows. Listeners
// apply the mode locally and never re-emit, so there's no ping-pong.

export type ModePreference = 'light' | 'dark' | 'system';

export function onAppModeChanged(handler: (mode: ModePreference) => void) {
    return ResultAsync.fromPromise(
        listen<ModePreference>('app:mode-changed', (event) => handler(event.payload)),
        toErrString
    );
}

export function emitAppModeChanged(mode: ModePreference) {
    return ResultAsync.fromPromise(emit('app:mode-changed', mode), toErrString);
}

// ─── Settings window → main window: show the onboarding tutorial ─────────────
//
// The tutorial is a page in the *main* window, so the Settings window can only
// ask for it. Delegated the same way as `vcs:restore-file-request`.

export function onShowTutorialRequest(handler: () => void) {
    return ResultAsync.fromPromise(
        listen<void>('app:show-tutorial', () => handler()),
        toErrString
    );
}

export function emitShowTutorialRequest() {
    return ResultAsync.fromPromise(emit('app:show-tutorial', undefined), toErrString);
}

// ─── Presentation mode ───────────────────────────────────────────────────────
// Presentation runs in the preview popout, but the button that drives it also
// lives in the main window's preview pane. When the popout is already open the
// main window can't hand the intent over through `?present=1` — it asks
// instead. A *toggle* request, so the same button can also end a presentation
// the main window can't see the keyboard for. Only the popout listens.

export function onPresentationToggleRequest(handler: () => void) {
    return ResultAsync.fromPromise(
        listen<void>('preview:present-toggle', () => handler()),
        toErrString
    );
}

export function emitPresentationToggleRequest() {
    return ResultAsync.fromPromise(emit('preview:present-toggle', undefined), toErrString);
}

// ─── Cross-window vcs diff window sync ───────────────────────────────────────

export interface VcsDiffSelectionPayload {
    primaryId: string | null;
    secondaryId: string | null;
    /** Which tab to show. Absent on payloads from older callers — the window
     *  keeps whatever tab it is on in that case. */
    view?: 'files' | 'pages';
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

// ─── Page-level diff (backend worker → whichever window asked) ────────────────
//
// Emitted by the page-diff worker rather than returned from the command,
// because computing one means compiling a historical version of the document.
// Every payload carries the `request_id` the command handed back, so a window
// that has since retargeted can drop results it no longer wants.

export function onVcsPageDiffStarted(handler: (payload: PageDiffStartedPayload) => void) {
    return ResultAsync.fromPromise(
        listen<PageDiffStartedPayload>('vcs:page-diff-started', (event) =>
            handler(event.payload)
        ),
        toErrString
    );
}

export function onVcsPageDiff(handler: (payload: PageDiffPayload) => void) {
    return ResultAsync.fromPromise(
        listen<PageDiffPayload>('vcs:page-diff', (event) => handler(event.payload)),
        toErrString
    );
}

export function onVcsPageDiffError(handler: (payload: PageDiffErrorPayload) => void) {
    return ResultAsync.fromPromise(
        listen<PageDiffErrorPayload>('vcs:page-diff-error', (event) => handler(event.payload)),
        toErrString
    );
}
