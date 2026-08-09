// IPC payload types — mirror the Rust serde types in src-tauri/src. All paths
// are workspace-relative with `/` separators, except workspace `path`/`root`
// which are absolute. The single source of truth is
// plans/typwriter-mobile/02-rust-core.md.

export interface WorkspaceMeta {
  name: string;
  path: string;
  lastOpenedMs: number | null;
  /** App-managed entry (the Typst package store), not a user workspace. */
  system: boolean;
}

export interface FileNode {
  name: string;
  relPath: string;
  isDir: boolean;
  children: FileNode[];
}

/** The app-wide fonts folder and what the compiler actually loaded from it. */
export interface FontsStatus {
  /** Display name of the chosen folder, or null when none is set. */
  folder: string | null;
  /** Font families available to the compiler: embedded plus the folder's. */
  familyCount: number;
  /** Whether a background load is still running. `familyCount` only means
   *  "that's all there was" once this is false. */
  loading: boolean;
}

/** Result of renaming, moving, or deleting an entry: the refreshed tree plus
 *  the path change, so open tabs can be carried across it. */
export interface EntryChange {
  tree: FileNode;
  /** The entry's path before the operation. */
  from: string;
  /** Its path afterwards, or null when it was deleted. */
  to: string | null;
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  tree: FileNode;
  mainFile: string | null;
  lastFile: string | null;
  /** Persisted open editor tabs (workspace-relative paths), restored on open. */
  openTabs: string[];
  /** Persisted active tab relPath, or null for an empty "new tab". */
  activeTab: string | null;
  /** Caret offset (UTF-16 code units) inside `activeTab`, or null. Already
   *  cleared by the backend when `activeTab` didn't survive the reopen. */
  cursor: number | null;
}

export type FileContent =
  | { type: "text"; content: string }
  | { type: "image"; mime: string; data: string }
  | { type: "unsupported" };

export interface IpcCompletion {
  kind: string;
  label: string;
  apply: string | null;
  detail: string | null;
}

export interface CompletionsResponse {
  /** UTF-16 offset where the completion replaces text. */
  from: number;
  completions: IpcCompletion[];
}

export interface DiagnosticRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  hints: string[];
  filePath: string | null;
  range: DiagnosticRange | null;
}

export interface PageMeta {
  /** 128-bit page-frame hash, hex. Form a URL with a scale bucket. */
  fingerprint: string;
  widthPt: number;
  heightPt: number;
}

/** Where a tap on a rendered preview page leads (mirrors `JumpTarget` in
 *  src-tauri/src/commands/click.rs). */
export type PreviewJump =
  /** Into the source: open `relPath` with the caret at `offset` (UTF-16). */
  | { type: "file"; relPath: string; offset: number }
  /** Out of the app: an external link. */
  | { type: "url"; url: string }
  /** Elsewhere in the preview: 0-based page plus a point on it, in typst points
   *  from the page's top-left. */
  | { type: "position"; page: number; x: number; y: number };

export interface CompileResult {
  generation: number;
  /** Present (possibly empty) on success; null when no document was produced. */
  pages: PageMeta[] | null;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  compileMs: number;
}

/** Persisted app settings (frontend-owned via tauri-plugin-store). */
export interface AppSettings {
  editorFontSize: number;
  showLineNumbers: boolean;
  autosaveMs: number;
  previewScaleBucket: 1 | 2 | 3 | 4;
  /** Name of the most recently opened workspace, re-opened on launch. */
  lastWorkspace: string | null;
  /** App-wide fonts source folder (path or SAF URI) loaded into the compiler. */
  fontsDir: string | null;
}
