// The ONLY place `invoke` is called. Every command is a typed wrapper that
// returns a neverthrow ResultAsync, so store methods can chain with .andThen()
// and surface errors with .mapErr() + a toast.

import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type {
  AppSettings,
  CompileResult,
  CompletionsResponse,
  EntryChange,
  FileContent,
  FileNode,
  FontsStatus,
  MovedWorkspace,
  PreviewJump,
  SyncStatus,
  WorkspaceInfo,
  WorkspaceMeta,
  PdfExportConfig,
  PngExportConfig,
  SvgExportConfig,
  HtmlExportConfig,
  ExportShareConfig,
  ExportShareResult,
  UpdateInfo,
  SystemInsets,
} from "./types";

const call = <T>(cmd: string, args?: Record<string, unknown>): ResultAsync<T, string> =>
  ResultAsync.fromPromise(invoke<T>(cmd, args), (e) => String(e));

// ─── App ─────────────────────────────────────────────────────────────────────

/** Version of the Typst compiler this build links against (`sys.version`). */
export const getTypstVersion = () => call<string>("get_typst_version");
/** A newer build on this app's track (stable or nightly), or null. */
export const checkForUpdate = () => call<UpdateInfo | null>("check_for_update");

// ─── Workspace ───────────────────────────────────────────────────────────────

export const listWorkspaces = () => call<WorkspaceMeta[]>("list_workspaces");
/** Create a workspace: in app storage, or with `inFolder` as a new folder
 *  inside the chosen location (see `pickWorkspaceLocation`). */
export const createWorkspace = (name: string, inFolder: boolean) =>
  call<WorkspaceMeta>("create_workspace", { name, inFolder });
/** Pick an existing folder and list it as a workspace; null if cancelled. */
export const addFolderWorkspace = () => call<WorkspaceMeta | null>("add_folder_workspace");
/** Where new workspaces are created, as a readable label, or null before the
 *  user has chosen. */
export const getWorkspaceLocation = () => call<string | null>("get_workspace_location");
/** Choose where new workspaces are created; the new label, or null if cancelled. */
export const pickWorkspaceLocation = () => call<string | null>("pick_workspace_location");
/** Move one app-storage workspace into a folder the user picks, so it syncs
 *  with it from now on; null if the picker was cancelled. */
export const moveWorkspaceToFolder = (id: string) =>
  call<MovedWorkspace | null>("move_workspace_to_folder", { id });
/** Stop syncing a folder workspace: bring it into app storage (the folder's
 *  files stay where they are). */
export const moveWorkspaceToApp = (id: string) => call<MovedWorkspace>("move_workspace_to_app", { id });
/** Delete an app-storage workspace, or take a folder workspace off the list
 *  (its files stay where they are). */
export const deleteWorkspace = (id: string) => call<null>("delete_workspace", { id });
export const openWorkspace = (id: string) => call<WorkspaceInfo>("open_workspace", { id });
/** The open folder workspace's sync state, or null when none is open. */
export const getSyncStatus = () => call<SyncStatus | null>("get_sync_status");
/** Pause folder polling while the app is hidden; resuming catches up at once. */
export const setSyncPaused = (paused: boolean) => call<null>("set_sync_paused", { paused });
/** Stop syncing the open folder workspace (emits `stopped`). */
export const stopFolderSync = () => call<null>("stop_folder_sync");
export const pickDocument = () => call<WorkspaceInfo | null>("pick_document");
export const openDocument = (uri: string) => call<WorkspaceInfo>("open_document", { uri });
/** Drain the native queue, including requests delivered before the UI loaded. */
export const takeOpenFiles = () => call<string[]>("take_open_files");
export const getFileTree = () => call<FileNode>("get_file_tree");
/** Re-read the workspace from disk, dropping every cached file slot, and
 *  return the fresh tree. Used when the app returns to the foreground, where
 *  the poll watcher may have been frozen by the OS. */
export const rescanWorkspace = () => call<FileNode>("rescan_workspace");
export const setMainFile = (relPath: string) => call<null>("set_main_file", { relPath });
export const setLastFile = (relPath: string | null) => call<null>("set_last_file", { relPath });
export const setOpenTabs = (
  openTabs: string[],
  activeTab: string | null,
  cursor: number | null = null,
) => call<null>("set_open_tabs", { openTabs, activeTab, cursor });
/** Open the native folder picker and persist it as the app-wide fonts source.
 *  Resolves to the folder's display name, or `null` if the user cancelled. */
export const pickFontsDir = () => call<string | null>("pick_fonts_dir");
export const clearFontsDir = () => call<null>("clear_fonts_dir");
/** The persisted fonts folder (backend truth) and the font families the
 *  compiler currently has loaded. */
export const getFontsStatus = () => call<FontsStatus>("get_fonts_status");

// ─── File operations ──────────────────────────────────────────────────────────

export const createFile = (relPath: string) => call<FileNode>("create_file", { relPath });
export const createFolder = (relPath: string) => call<FileNode>("create_folder", { relPath });
export const renameEntry = (relPath: string, newName: string) =>
  call<EntryChange>("rename_entry", { relPath, newName });
export const moveEntry = (relPath: string, newParentRel: string) =>
  call<EntryChange>("move_entry", { relPath, newParentRel });
export const deleteEntry = (relPath: string) => call<EntryChange>("delete_entry", { relPath });

// ─── Editor ────────────────────────────────────────────────────────────────────

export const readFile = (relPath: string) => call<FileContent>("read_file", { relPath });
export const saveFile = (relPath: string, content: string, overwrite = false) =>
  call<null>("save_file", { relPath, content, overwrite });
export const getCompletions = (
  relPath: string,
  text: string,
  cursor: number,
  explicit: boolean,
) => call<CompletionsResponse>("get_completions", { relPath, text, cursor, explicit });

// ─── Compile + preview ──────────────────────────────────────────────────────────

export const compile = () => call<CompileResult>("compile");

/** 0-based preview page the caret renders on, or `null` when it can't be placed
 *  (no compiled document, or the caret isn't on rendered content). `cursor` is a
 *  UTF-16 offset, like every offset crossing this boundary. */
export const pageForCursor = (relPath: string, cursor: number) =>
  call<number | null>("page_for_cursor", { relPath, cursor });

/** Resolve a tap at `x`/`y` **typst points** on the 0-based preview `page` to a
 *  jump target — a link's destination, or the source span that rendered it.
 *  `null` when nothing was hit (or the hit lives in a package file). */
export const jumpFromClick = (page: number, x: number, y: number) =>
  call<PreviewJump | null>("jump_from_click", { page, x, y });

// ─── Format ──────────────────────────────────────────────────────────────────

export interface FormatWithCursorResponse {
  formatted: string;
  /** Cursor's new offset in UTF-16 code units (matches JS string indexing). */
  cursor: number;
}

export const formatTypstSource = (source: string) =>
  call<string>("format_typst_source", { source });
/** Format Typst source while tracking the cursor through the rewrite. */
export const formatTypstSourceWithCursor = (source: string, cursor: number) =>
  call<FormatWithCursorResponse>("format_typst_cursor_virtual", { source, cursor });

// ─── Export ───────────────────────────────────────────────────────────────────

export const exportPdf = (config: PdfExportConfig) =>
  call<string>("export_pdf", { config });
export const exportPng = (config: PngExportConfig) =>
  call<string>("export_png", { config });
export const exportSvg = (config: SvgExportConfig) =>
  call<string>("export_svg", { config });
export const exportHtml = (config: HtmlExportConfig) =>
  call<string>("export_html", { config });
export const exportForShare = (config: ExportShareConfig) =>
  call<ExportShareResult>("export_for_share", { config });

export const exportPdfToUri = () => call<string>("export_pdf_to_uri");
export const exportPdfToCacheFile = () => call<string>("export_pdf_to_cache_file");
/** Copy a workspace into a user-chosen folder; resolves to the number of files
 *  copied. */
export const exportWorkspace = (id: string) => call<number>("export_workspace", { id });

// AppSettings is re-exported for store typing convenience.
export type { AppSettings };

// ─── System bars (local `system-bars` plugin; no-ops off Android) ────────────

/** Hide or show the Android status bar (immersive editor / preview). */
export const setStatusBarHidden = (hidden: boolean) =>
  call<void>("plugin:system-bars|set_status_bar_hidden", { hidden });
/** Light or dark status/navigation-bar icons, following the app's theme. */
export const setSystemBarStyle = (dark: boolean) =>
  call<void>("plugin:system-bars|set_style", { dark });
/** System-bar + cutout insets in CSS px, measured ignoring bar visibility. */
export const getSystemInsets = () => call<SystemInsets>("plugin:system-bars|get_insets");
