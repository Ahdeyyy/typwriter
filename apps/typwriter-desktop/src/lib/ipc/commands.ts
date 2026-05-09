import { invoke } from '@tauri-apps/api/core';
import { ResultAsync } from 'neverthrow';

import type {
    FileTreeEntry,
    RecentWorkspaceEntry,
    FileContentResponse,
    CompletionsResponse,
    TooltipResponse,
    JumpResponse,
    PreviewPositionResponse,
    CompileReason,
    PdfExportConfig,
    PngExportConfig,
    SvgExportConfig
} from '$lib/types';

const toErrString = (e: unknown): string => String(e);

// ─── Workspace ────────────────────────────────────────────────────────────────

export function openFolder(path: string) {
    return ResultAsync.fromPromise(invoke<string | null>('open_folder', { path }), toErrString);
}

export function createWorkspace(parentPath: string, name: string) {
    return ResultAsync.fromPromise(invoke<string>('create_workspace', { parentPath, name }), toErrString);
}

export function setMainFile(path: string) {
    return ResultAsync.fromPromise(invoke<void>('set_main_file', { path }), toErrString);
}

export function getFileTree() {
    return ResultAsync.fromPromise(invoke<FileTreeEntry[]>('get_file_tree'), toErrString);
}

export function createFile(path: string) {
    return ResultAsync.fromPromise(invoke<void>('create_file', { path }), toErrString);
}

export function createFolder(path: string) {
    return ResultAsync.fromPromise(invoke<void>('create_folder', { path }), toErrString);
}

export function deleteFile(path: string) {
    return ResultAsync.fromPromise(invoke<void>('delete_file', { path }), toErrString);
}

export function deleteFolder(path: string) {
    return ResultAsync.fromPromise(invoke<void>('delete_folder', { path }), toErrString);
}

export function renameFile(src: string, dst: string) {
    return ResultAsync.fromPromise(invoke<void>('rename_file', { src, dst }), toErrString);
}

export function moveFile(src: string, dst: string) {
    return ResultAsync.fromPromise(invoke<void>('move_file', { src, dst }), toErrString);
}

export function moveFolder(src: string, dst: string) {
    return ResultAsync.fromPromise(invoke<void>('move_folder', { src, dst }), toErrString);
}

export function importFiles(sources: string[], destDir: string) {
    return ResultAsync.fromPromise(invoke<void>('import_files', { sources, destDir }), toErrString);
}

export function getRecentWorkspaces() {
    return ResultAsync.fromPromise(
        invoke<RecentWorkspaceEntry[]>('get_recent_workspaces'),
        toErrString
    );
}

export function removeRecentWorkspace(path: string) {
    return ResultAsync.fromPromise(invoke<void>('remove_recent_workspace', { path }), toErrString);
}

export function clearRecentWorkspaces() {
    return ResultAsync.fromPromise(invoke<void>('clear_recent_workspaces'), toErrString);
}

export function saveWorkspaceTabs(tabs: string[], activeTabId: string | null) {
    return ResultAsync.fromPromise(
        invoke<void>('save_workspace_tabs', { tabs, activeTabId }),
        toErrString
    );
}

export function getWorkspaceTabs(root: string) {
    return ResultAsync.fromPromise(
        invoke<[string[], string | null] | null>('get_workspace_tabs', { root }),
        toErrString
    );
}

export function getLogFilePath() {
    return ResultAsync.fromPromise(invoke<string>('get_log_file_path'), toErrString);
}

// ─── Editor ───────────────────────────────────────────────────────────────────

export function readFile(path: string) {
    return ResultAsync.fromPromise(invoke<FileContentResponse>('read_file', { path }), toErrString);
}

export function updateFileContent(path: string, content: string) {
    return ResultAsync.fromPromise(
        invoke<void>('update_file_content', { path, content }),
        toErrString
    );
}

export function saveFile(path: string, content: string) {
    return ResultAsync.fromPromise(invoke<void>('save_file', { path, content }), toErrString);
}

export function discardShadow(path: string) {
    return ResultAsync.fromPromise(invoke<void>('discard_shadow', { path }), toErrString);
}

export function getCompletions(path: string, cursor: number, explicit: boolean) {
    return ResultAsync.fromPromise(
        invoke<CompletionsResponse>('get_completions', { path, cursor, explicit }),
        toErrString
    );
}

export function getTooltip(path: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<TooltipResponse | null>('get_tooltip', { path, cursor }),
        toErrString
    );
}

export function getDefinitions(path: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<JumpResponse | null>('get_definitions', { path, cursor }),
        toErrString
    );
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export function triggerPreview(reason?: CompileReason) {
    return ResultAsync.fromPromise(invoke<void>('trigger_preview', { reason }), toErrString);
}

export function syncPreview() {
    return ResultAsync.fromPromise(invoke<void>('sync_preview'), toErrString);
}

export function setZoom(scale: number) {
    return ResultAsync.fromPromise(invoke<void>('set_zoom', { scale }), toErrString);
}

export function getZoom() {
    return ResultAsync.fromPromise(invoke<number>('get_zoom'), toErrString);
}

export function setVisiblePage(page: number) {
    invoke<void>('set_visible_page', { page }).catch(() => {});
}

// ─── Click / Jump ─────────────────────────────────────────────────────────────

export function jumpFromClick(page: number, x: number, y: number) {
    return ResultAsync.fromPromise(
        invoke<JumpResponse | null>('jump_from_click', { page, x, y }),
        toErrString
    );
}

export function jumpFromCursor(path: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<PreviewPositionResponse | null>('jump_from_cursor', { path, cursor }),
        toErrString
    );
}

// ─── Format ───────────────────────────────────────────────────────────────────

export interface FormatWorkspaceReport {
    total: number;
    formatted: number;
    unchanged: number;
    failed: string[];
}

export function formatTypstSource(source: string) {
    return ResultAsync.fromPromise(
        invoke<string>('format_typst_source', { source }),
        toErrString
    );
}

export interface FormatWithCursorResponse {
    formatted: string;
    /** UTF-16 code-unit offset, matching JavaScript string indexing. */
    cursor: number;
}

/** Cursor-maintenance strategy. Each value maps to an independent Rust
 * implementation in `commands/format.rs`; none of them falls back to another.
 *
 * - `'virtual'`     — splice a unique block-comment marker at the cursor,
 *                     format, locate the marker. Most accurate when typstyle
 *                     preserves the marker; clamps to the original byte
 *                     offset if the marker is lost.
 * - `'laszlo'`      — count non-whitespace chars before the cursor, then
 *                     place the cursor after the Nth non-ws char in the
 *                     formatted output. Robust against whitespace-only
 *                     edits (typstyle's main behaviour).
 * - `'lineColumn'`  — preserve (line, column-bytes) and clamp to the new
 *                     line's length. Cheap; loses the cursor on reflows. */
export type CursorMaintenanceStrategy = 'virtual' | 'laszlo' | 'lineColumn';

const CURSOR_STRATEGY_COMMAND: Record<CursorMaintenanceStrategy, string> = {
    virtual: 'format_typst_cursor_virtual',
    laszlo: 'format_typst_cursor_laszlo',
    lineColumn: 'format_typst_cursor_line_column',
};

export interface VirtualDebugResponse {
    /** Formatted text with the tw_cursor marker still embedded — inspect
     *  this to see where typstyle placed the cursor anchor after reformatting. */
    formatted_with_marker: string;
    /** Formatted text with the marker stripped (same result as the regular virtual command). */
    formatted: string;
    /** New cursor offset (UTF-16 units). */
    cursor: number;
    /** The exact marker string that was spliced in. */
    marker: string;
    /** true if the marker survived formatting exactly once; false means it was lost or duplicated. */
    marker_found: boolean;
}

/** Debug variant of the virtual strategy: returns the formatted text WITH the
 *  cursor marker still embedded so you can see exactly where it landed. */
export function formatTypstCursorVirtualDebug(source: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<VirtualDebugResponse>('format_typst_cursor_virtual_debug', { source, cursor }),
        toErrString
    );
}

/** Format a Typst source string while tracking the cursor through the rewrite.
 * `cursor` is a UTF-16 code-unit offset (CodeMirror's units). All cursor
 * maintenance happens in Rust on UTF-8 byte offsets; only the IPC boundary
 * speaks UTF-16. */
export function formatTypstSourceWithCursor(
    source: string,
    cursor: number,
    strategy: CursorMaintenanceStrategy = 'laszlo',
) {
    return ResultAsync.fromPromise(
        invoke<FormatWithCursorResponse>(CURSOR_STRATEGY_COMMAND[strategy], { source, cursor }),
        toErrString
    );
}

export function formatTypstFile(path: string) {
    return ResultAsync.fromPromise(invoke<string>('format_typst_file', { path }), toErrString);
}

export function formatWorkspaceTypFiles() {
    return ResultAsync.fromPromise(
        invoke<FormatWorkspaceReport>('format_workspace_typ_files'),
        toErrString
    );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportPdf(config: PdfExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_pdf', { config }), toErrString);
}

export function exportPng(config: PngExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_png', { config }), toErrString);
}

export function exportSvg(config: SvgExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_svg', { config }), toErrString);
}

// ─── App init ─────────────────────────────────────────────────────────────────

export function isFontsLoaded() {
    return ResultAsync.fromPromise(invoke<boolean>('is_fonts_loaded'), toErrString);
}
