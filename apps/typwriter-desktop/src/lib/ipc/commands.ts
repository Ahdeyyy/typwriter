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
    SvgExportConfig,
    RestorePoint,
    WorkspaceDiff
} from '$lib/types';

const toErrString = (e: unknown): string => String(e);

// ─── Workspace ────────────────────────────────────────────────────────────────

export function openFolder(path: string) {
    return ResultAsync.fromPromise(invoke<string | null>('open_folder', { path }), toErrString);
}

export function createWorkspace(parentPath: string, name: string) {
    return ResultAsync.fromPromise(invoke<string>('create_workspace', { parentPath, name }), toErrString);
}

export interface MobileWorkspaceEntry {
    name: string;
    path: string;
}

export function getMobileWorkspacesDir() {
    return ResultAsync.fromPromise(invoke<string>('get_mobile_workspaces_dir'), toErrString);
}

export function listMobileWorkspaces() {
    return ResultAsync.fromPromise(
        invoke<MobileWorkspaceEntry[]>('list_mobile_workspaces'),
        toErrString
    );
}

/** Android-only: convert a SAF tree URI from `AndroidFs.showOpenDirPicker`
 *  to a filesystem path that the standard workspace commands can use. */
export function safTreeUriToPath(uri: string) {
    return ResultAsync.fromPromise(
        invoke<string>('saf_tree_uri_to_path', { uri }),
        toErrString
    );
}

/** Android-only: register a SAF workspace tree URI so backend VCS operations
 *  can use android-fs instead of direct filesystem access. */
export function registerSafWorkspaceRoot(dirUri: { uri: string; documentTopTreeUri: string | null }) {
    return ResultAsync.fromPromise(
        invoke<string>('register_saf_workspace_root', { dirUri }),
        toErrString
    );
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

/** Android-only: import files via FileUris returned by `AndroidFs.showOpenFilePicker`. */
export function importFilesFromUris(
    sources: { uri: string; documentTopTreeUri: string | null }[],
    destDir: string
) {
    return ResultAsync.fromPromise(
        invoke<void>('import_files_from_uris', { sources, destDir }),
        toErrString
    );
}

/** Android-only: copy the whole workspace into a directory URI obtained from
 *  `AndroidFs.showOpenDirPicker`. Resolves to the number of files copied. */
export function exportWorkspaceToDirUri(
    dirUri: { uri: string; documentTopTreeUri: string | null }
) {
    return ResultAsync.fromPromise(
        invoke<number>('export_workspace_to_dir_uri', { dirUri }),
        toErrString
    );
}

export function getRecentWorkspaces(options: { includeThumbnails?: boolean } = {}) {
    return ResultAsync.fromPromise(
        invoke<RecentWorkspaceEntry[]>('get_recent_workspaces', {
            includeThumbnails: options.includeThumbnails ?? true,
        }),
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

/** Format a Typst source string while tracking the cursor through the rewrite.
 *
 * Uses the virtual-marker strategy: a unique block-comment marker is spliced
 * at the cursor, the marked source is formatted, and the marker's new offset
 * is read back. If the marker is lost or duplicated post-format, the cursor
 * clamps to its original byte offset.
 *
 * `cursor` is a UTF-16 code-unit offset (CodeMirror's units). All cursor
 * maintenance happens in Rust on UTF-8 byte offsets; only the IPC boundary
 * speaks UTF-16. */
export function formatTypstSourceWithCursor(source: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<FormatWithCursorResponse>('format_typst_cursor_virtual', { source, cursor }),
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

/** Android-only: export PDF to a FileUri returned by `AndroidFs.showSaveFilePicker`. */
export function exportPdfToUri(
    fileUri: { uri: string; documentTopTreeUri: string | null },
    config: PdfExportConfig
) {
    return ResultAsync.fromPromise(
        invoke<void>('export_pdf_to_uri', { fileUri, config }),
        toErrString
    );
}

export function exportPng(config: PngExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_png', { config }), toErrString);
}

/** Android-only: export PNG pages into a directory URI obtained from
 *  `AndroidFs.showOpenDirPicker`. */
export function exportPngToDirUri(
    dirUri: { uri: string; documentTopTreeUri: string | null },
    config: PngExportConfig
) {
    return ResultAsync.fromPromise(
        invoke<void>('export_png_to_dir_uri', { dirUri, config }),
        toErrString
    );
}

export function exportSvg(config: SvgExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_svg', { config }), toErrString);
}

/** Android-only: export SVG pages into a directory URI obtained from
 *  `AndroidFs.showOpenDirPicker`. */
export function exportSvgToDirUri(
    dirUri: { uri: string; documentTopTreeUri: string | null },
    config: SvgExportConfig
) {
    return ResultAsync.fromPromise(
        invoke<void>('export_svg_to_dir_uri', { dirUri, config }),
        toErrString
    );
}

// ─── Versioning / Restore points ──────────────────────────────────────────────

/** Create a user-driven restore point. Returns the new commit hex id, or
 *  `null` if the working tree was already identical to HEAD. */
export function vcsCreateRestorePoint(message: string) {
    return ResultAsync.fromPromise(
        invoke<string | null>('vcs_create_restore_point', { message }),
        toErrString
    );
}

/** Return the id of the snapshot the working tree currently matches (HEAD),
 *  or `null` when the workspace has no snapshots yet. After a restore, this
 *  is the restored point; otherwise it's the most recent commit. */
export function vcsCurrentId() {
    return ResultAsync.fromPromise(
        invoke<string | null>('vcs_current_id'),
        toErrString
    );
}

/** Return the restore-point timeline (newest first). `limit` caps the count. */
export function vcsListHistory(limit?: number) {
    return ResultAsync.fromPromise(
        invoke<RestorePoint[]>('vcs_list_history', { limit: limit ?? null }),
        toErrString
    );
}

export function vcsDiffVsCurrent(commitId: string) {
    return ResultAsync.fromPromise(
        invoke<WorkspaceDiff>('vcs_diff_vs_current', { commitId }),
        toErrString
    );
}

export function vcsDiffBetween(fromId: string, toId: string) {
    return ResultAsync.fromPromise(
        invoke<WorkspaceDiff>('vcs_diff_between', { fromId, toId }),
        toErrString
    );
}

/** Hard-reset the working tree to `commitId`. Records a safety commit first. */
export function vcsRestoreWorkspace(commitId: string) {
    return ResultAsync.fromPromise(
        invoke<void>('vcs_restore_workspace', { commitId }),
        toErrString
    );
}

/** Restore a single file from `commitId`. Records a safety commit first. */
export function vcsRestoreFile(commitId: string, path: string) {
    return ResultAsync.fromPromise(
        invoke<void>('vcs_restore_file', { commitId, path }),
        toErrString
    );
}

// ─── App init ─────────────────────────────────────────────────────────────────

export function isFontsLoaded() {
    return ResultAsync.fromPromise(invoke<boolean>('is_fonts_loaded'), toErrString);
}

// ─── Onboarding ─────────────────────────────────────────────────────────────────

/** A single seed file for the onboarding workspace. */
export interface OnboardingFile {
    name: string;
    content: string;
}

/** Create (or re-seed) the disposable onboarding workspace under app-data and
 *  return its absolute path. Each tutorial step is seeded as its own `*.typ`
 *  file before the workspace is opened. */
export function prepareOnboardingWorkspace(files: OnboardingFile[]) {
    return ResultAsync.fromPromise(
        invoke<string>('prepare_onboarding_workspace', { files }),
        toErrString
    );
}

/** Whether onboarding has been shown (completed OR skipped). */
export function getOnboardingCompleted() {
    return ResultAsync.fromPromise(invoke<boolean>('get_onboarding_completed'), toErrString);
}

export function setOnboardingCompleted(completed: boolean) {
    return ResultAsync.fromPromise(
        invoke<void>('set_onboarding_completed', { completed }),
        toErrString
    );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
    font_directories: string[];
    ui_font_family: string;
    editor_font_family: string;
    editor_font_size: number;
    light_theme: string;
    dark_theme: string;
    auto_check_updates: boolean;
    default_preview_zoom: number;
    default_preview_visible: boolean;
    show_line_numbers: boolean;
    show_indentation_markers: boolean;
    spellcheck: boolean;
    tab_width: number;
    word_wrap: boolean;
    auto_save_enabled: boolean;
    auto_save_delay_ms: number;
    format_before_save: boolean;
    auto_snapshot_on_save: boolean;
    auto_snapshot_on_compile: boolean;
    auto_snapshot_min_interval_seconds: number;
    snapshot_retention_max_count: number;
    snapshot_retention_max_days: number;
}

export function getAppSettings() {
    return ResultAsync.fromPromise(invoke<AppSettings>('get_app_settings'), toErrString);
}

export function setAppSettings(settings: AppSettings) {
    return ResultAsync.fromPromise(invoke<void>('set_app_settings', { settings }), toErrString);
}

export function setTypstFontDirectories(dirs: string[]) {
    return ResultAsync.fromPromise(
        invoke<void>('set_typst_font_directories', { dirs }),
        toErrString
    );
}

/** Android-only: copy a user-picked SAF font folder into app-private storage
 *  and return the destination path. The returned path is then handed to
 *  `setTypstFontDirectories` so typst-kit's FontSearcher (which can't see
 *  past SAF) scans a directory `std::fs` can actually read. */
export function importFontDirectoryUri(
    dirUri: { uri: string; documentTopTreeUri: string | null }
) {
    return ResultAsync.fromPromise(
        invoke<string>('import_font_directory_uri', { dirUri }),
        toErrString
    );
}
