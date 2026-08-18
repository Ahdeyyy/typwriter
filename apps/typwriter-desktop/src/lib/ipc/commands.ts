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
    HtmlExportConfig,
    PdfExportConfig,
    PngExportConfig,
    SvgExportConfig,
    RestorePoint,
    WorkspaceDiff,
    GrammarConfig,
    GrammarReport,
    GrammarRuleInfo,
    DisplayInfo,
    PackageEntry
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

/** Import an external drag-and-drop batch. `body` is the framed payload built
 *  by `$lib/services/drop-import` and is passed as the *raw* IPC body — an
 *  object argument would JSON-encode the file bytes as a number array.
 *  Resolves to the workspace-relative paths that were written. */
export function importDropped(body: Uint8Array) {
    return ResultAsync.fromPromise(invoke<string[]>('import_dropped', body), toErrString);
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

/** `cursor` is the active tab's caret offset in UTF-16 code units (CodeMirror's
 *  coordinate space), or null when the active tab has no caret. */
export function saveWorkspaceTabs(
    tabs: string[],
    activeTabId: string | null,
    unsaved: Record<string, string> = {},
    cursor: number | null = null
) {
    return ResultAsync.fromPromise(
        invoke<void>('save_workspace_tabs', { tabs, activeTabId, unsaved, cursor }),
        toErrString
    );
}

export function getWorkspaceTabs(root: string) {
    return ResultAsync.fromPromise(
        invoke<[string[], string | null, Record<string, string>, number | null] | null>(
            'get_workspace_tabs',
            { root }
        ),
        toErrString
    );
}

export function getLogFilePath() {
    return ResultAsync.fromPromise(invoke<string>('get_log_file_path'), toErrString);
}

// ─── Editor ───────────────────────────────────────────────────────────────────

/** Named export configurations. Opaque JSON on the Rust side — the shape lives
 *  in `$lib/export-presets.ts`, which validates whatever comes back. */
export function getExportPresets() {
    return ResultAsync.fromPromise(invoke<unknown>('get_export_presets'), toErrString);
}

export function setExportPresets(presets: unknown) {
    return ResultAsync.fromPromise(
        invoke<void>('set_export_presets', { presets }),
        toErrString
    );
}

/** Packages in the Typst Universe index, one entry per package with its
 *  versions folded together. Empty when the index could not be fetched —
 *  offline is an empty list, not an error. */
export function listPackages() {
    return ResultAsync.fromPromise(invoke<PackageEntry[]>('list_packages'), toErrString);
}

/** App-wide snippets. Opaque JSON on the Rust side — the shape and its
 *  validation live in `$lib/snippets.ts`. */
export function getUserSnippets() {
    return ResultAsync.fromPromise(invoke<unknown>('get_user_snippets'), toErrString);
}

export function setUserSnippets(snippets: unknown) {
    return ResultAsync.fromPromise(
        invoke<void>('set_user_snippets', { snippets }),
        toErrString
    );
}

export function readFile(path: string) {
    return ResultAsync.fromPromise(invoke<FileContentResponse>('read_file', { path }), toErrString);
}

/** Select the file in the OS file manager. Rust rejects paths outside the
 *  open workspace. */
export function revealFileInManager(path: string) {
    return ResultAsync.fromPromise(invoke<void>('reveal_file_in_manager', { path }), toErrString);
}

/** Hand the file to whichever app the OS associates with it. */
export function openFileExternally(path: string) {
    return ResultAsync.fromPromise(invoke<void>('open_file_externally', { path }), toErrString);
}

/** Monotonic ordering token for shadow writes.
 *
 *  `update_file_content` runs off the main thread on the Rust side, so writes
 *  no longer complete in the order they were sent. Every call carries the next
 *  value of this counter and the backend drops anything older than what it has
 *  already applied. It must never reset for the lifetime of the window — a
 *  per-file counter that restarts (as the editor store's scheduling versions
 *  do) would make the backend reject legitimate writes. */
let shadowWriteSeq = 0;

export function updateFileContent(path: string, content: string) {
    return ResultAsync.fromPromise(
        invoke<void>('update_file_content', { path, content, version: ++shadowWriteSeq }),
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

// ─── Presentation mode ────────────────────────────────────────────────────────

/** Every connected display, annotated so the picker can mark the projector
 *  (`isMainWindow === false`) and the primary screen. */
export function listDisplays() {
    return ResultAsync.fromPromise(invoke<DisplayInfo[]>('list_displays'), toErrString);
}

/** Put the preview popout borderless-fullscreen and always-on-top on `display`
 *  (auto-picks the display the editor isn't on when omitted). Resolves with the
 *  display it landed on, whose pixel width sets the slide render scale. */
export function enterPresentation(display: string | null) {
    return ResultAsync.fromPromise(
        invoke<DisplayInfo>('enter_presentation', { display }),
        toErrString
    );
}

export function exitPresentation() {
    return ResultAsync.fromPromise(invoke<void>('exit_presentation'), toErrString);
}

// ─── Language server (tinymist) bridge ───

/** Spawn (or reuse) the tinymist child process. Resolves `false` when tinymist
 *  isn't installed / fails to start — the caller then stays on the built-in
 *  typst-ide path. */
export function lspStart() {
    return ResultAsync.fromPromise(invoke<boolean>('lsp_start'), toErrString);
}

/** Forward one raw JSON-RPC message to the server's stdin. */
export function lspSend(message: string) {
    return ResultAsync.fromPromise(invoke<void>('lsp_send', { message }), toErrString);
}

/** Kill the tinymist child (if any). */
export function lspStop() {
    return ResultAsync.fromPromise(invoke<void>('lsp_stop'), toErrString);
}

/** Whether the `tinymist` CLI is installed, plus the Typst version it embeds
 *  next to the one this app compiles with. */
export interface LspAvailability {
    available: boolean;
    /** tinymist's own release version (e.g. `0.15.2`). */
    version: string | null;
    /** The Typst version tinymist was built against (e.g. `0.15.0`). */
    typstVersion: string | null;
    /** The Typst version this app compiles with. */
    bundledTypstVersion: string;
    /** `false` when the two Typst versions differ enough to change results;
     *  `null` when tinymist didn't report one. */
    typstCompatible: boolean | null;
}

/** Probe `PATH` for the tinymist CLI (runs `tinymist --version`). */
export function lspProbe() {
    return ResultAsync.fromPromise(invoke<LspAvailability>('lsp_probe'), toErrString);
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
 * The returned text is always byte-identical to a plain format of the source.
 * The cursor is located with the virtual-marker strategy — a unique block
 * comment spliced at the cursor's word-run start in a second, throwaway
 * format pass — and degrades to a common-prefix/suffix mapping when the
 * marker can't be used (never failing the format itself).
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

export function exportPng(config: PngExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_png', { config }), toErrString);
}

export function exportSvg(config: SvgExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_svg', { config }), toErrString);
}

export function exportHtml(config: HtmlExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_html', { config }), toErrString);
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

/** Version of the Typst compiler this build links against (e.g. `"0.15.1"`). */
export function getTypstVersion() {
    return ResultAsync.fromPromise(invoke<string>('get_typst_version'), toErrString);
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
    presentation_display: string | null;
    show_line_numbers: boolean;
    show_indentation_markers: boolean;
    spellcheck: boolean;
    tab_width: number;
    word_wrap: boolean;
    focus_mode: boolean;
    typewriter_scrolling: boolean;
    auto_save_enabled: boolean;
    auto_save_delay_ms: number;
    format_before_save: boolean;
    format_tab_spaces: number;
    format_max_width: number;
    format_blank_lines_upper_bound: number;
    format_collapse_markup_spaces: boolean;
    format_reorder_import_items: boolean;
    format_wrap_text: boolean;
    auto_snapshot_on_save: boolean;
    auto_snapshot_on_compile: boolean;
    auto_snapshot_min_interval_seconds: number;
    snapshot_retention_max_count: number;
    snapshot_retention_max_days: number;
    /** Shortcut overrides, keyed by command id. Rust only stores these — the
     *  frontend owns what they mean (see `$lib/keybindings/registry`). */
    keybindings: Record<string, string[]>;
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

/** A font family installed on the device, as reported by the OS font scan. */
export interface SystemFontFamily {
    name: string;
    monospace: boolean;
}

/** Font families installed on this device, for the UI / editor font pickers.
 *  The first call runs an OS font scan (cached in Rust afterwards), so it can
 *  take a moment. */
export function listSystemFontFamilies() {
    return ResultAsync.fromPromise(
        invoke<SystemFontFamily[]>('list_system_font_families'),
        toErrString
    );
}

// ─── Grammar checking ─────────────────────────────────────────────────────────

/** Check one file. `path` is workspace-relative; it picks the reader and
 *  decides whether the file has been opted out. The first call builds Harper's
 *  dictionary and lint set, so it is noticeably slower than the rest. */
export function checkGrammar(path: string, text: string) {
    return ResultAsync.fromPromise(
        invoke<GrammarReport>('check_grammar', { path, text }),
        toErrString
    );
}

export function getGrammarConfig() {
    return ResultAsync.fromPromise(invoke<GrammarConfig>('get_grammar_config'), toErrString);
}

export function setGrammarConfig(config: GrammarConfig) {
    return ResultAsync.fromPromise(invoke<void>('set_grammar_config', { config }), toErrString);
}

/** The full rule catalog for the settings pane. Forces Harper's lint set to be
 *  built if it hasn't been already. */
export function getGrammarRules() {
    return ResultAsync.fromPromise(invoke<GrammarRuleInfo[]>('get_grammar_rules'), toErrString);
}

/** Add a word to the user dictionary. Returns the updated config. */
export function addGrammarDictionaryWord(word: string) {
    return ResultAsync.fromPromise(
        invoke<GrammarConfig>('add_grammar_dictionary_word', { word }),
        toErrString
    );
}

/** Turn checking on or off for a single file. Returns the updated config. */
export function setGrammarFileEnabled(path: string, enabled: boolean) {
    return ResultAsync.fromPromise(
        invoke<GrammarConfig>('set_grammar_file_enabled', { path, enabled }),
        toErrString
    );
}
