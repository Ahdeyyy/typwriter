// The ONLY place `invoke` is called. Every command is a typed wrapper that
// returns a neverthrow ResultAsync, so store methods can chain with .andThen()
// and surface errors with .mapErr() + a toast.

import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type {
  AppSettings,
  CompileResult,
  CompletionsResponse,
  FileContent,
  FileNode,
  WorkspaceInfo,
  WorkspaceMeta,
} from "./types";

const call = <T>(cmd: string, args?: Record<string, unknown>): ResultAsync<T, string> =>
  ResultAsync.fromPromise(invoke<T>(cmd, args), (e) => String(e));

// ─── Workspace ───────────────────────────────────────────────────────────────

export const listWorkspaces = () => call<WorkspaceMeta[]>("list_workspaces");
export const createWorkspace = (name: string) =>
  call<WorkspaceMeta>("create_workspace", { name });
export const deleteWorkspace = (name: string) => call<null>("delete_workspace", { name });
export const openWorkspace = (name: string) => call<WorkspaceInfo>("open_workspace", { name });
export const getFileTree = () => call<FileNode>("get_file_tree");
export const setMainFile = (relPath: string) => call<null>("set_main_file", { relPath });
export const setLastFile = (relPath: string | null) => call<null>("set_last_file", { relPath });
export const setOpenTabs = (openTabs: string[], activeTab: string | null) =>
  call<null>("set_open_tabs", { openTabs, activeTab });
/** Open the native folder picker and persist it as the app-wide fonts source.
 *  Resolves to the folder's display name, or `null` if the user cancelled. */
export const pickFontsDir = () => call<string | null>("pick_fonts_dir");
export const clearFontsDir = () => call<null>("clear_fonts_dir");

// ─── File operations ──────────────────────────────────────────────────────────

export const createFile = (relPath: string) => call<FileNode>("create_file", { relPath });
export const createFolder = (relPath: string) => call<FileNode>("create_folder", { relPath });
export const renameEntry = (relPath: string, newName: string) =>
  call<FileNode>("rename_entry", { relPath, newName });
export const moveEntry = (relPath: string, newParentRel: string) =>
  call<FileNode>("move_entry", { relPath, newParentRel });
export const deleteEntry = (relPath: string) => call<FileNode>("delete_entry", { relPath });

// ─── Editor ────────────────────────────────────────────────────────────────────

export const readFile = (relPath: string) => call<FileContent>("read_file", { relPath });
export const saveFile = (relPath: string, content: string) =>
  call<null>("save_file", { relPath, content });
export const getCompletions = (
  relPath: string,
  text: string,
  cursor: number,
  explicit: boolean,
) => call<CompletionsResponse>("get_completions", { relPath, text, cursor, explicit });

// ─── Compile + preview ──────────────────────────────────────────────────────────

export const compile = () => call<CompileResult>("compile");

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

// ─── PDF export (phase 7) ─────────────────────────────────────────────────────

export const exportPdfToUri = () => call<string>("export_pdf_to_uri");
export const exportPdfToCacheFile = () => call<string>("export_pdf_to_cache_file");

// AppSettings is re-exported for store typing convenience.
export type { AppSettings };
