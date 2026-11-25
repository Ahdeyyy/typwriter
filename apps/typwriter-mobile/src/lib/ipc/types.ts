// IPC payload types — mirror the Rust serde types in src-tauri/src. All paths
// are workspace-relative with `/` separators, except workspace `path`/`root`
// which are absolute. The single source of truth is
// plans/typwriter-mobile/02-rust-core.md.

export interface WorkspaceMeta {
  /** What `openWorkspace` takes: `app:<name>` or `folder:<hex>`. */
  id: string;
  name: string;
  /** Where it lives: an absolute path, or a readable label such as
   *  `Sync/Thesis` for a folder picked through Android's folder picker.
   *  Display only. */
  path: string;
  /** `app`: in the app's own storage (how workspaces were kept before they
   *  could live anywhere). `folder`: a folder the user picked. */
  kind: "app" | "folder";
  lastOpenedMs: number | null;
  /** App-managed entry (the Typst package store), not a user workspace. */
  system: boolean;
}

/** A workspace moved between app storage and a folder: its id before and
 *  after (the name can change when it comes back into the app). */
export interface MovedWorkspace {
  name: string;
  from: string;
  to: string;
}

/** Where the open folder workspace's sync stands — mirrors `SyncState` in
 *  src-tauri/src/folders/sync.rs. */
export type SyncState = "syncing" | "synced" | "paused" | "offline" | "stopped";

/** `workspace:sync-status` / `get_sync_status`. Emitted on every state change,
 *  plus throttled progress while files are being copied in. */
export interface SyncStatus {
  workspaceId: string;
  name: string;
  /** Readable folder location, e.g. `Sync/Thesis`. */
  location: string;
  state: SyncState;
  message: string | null;
  /** Files copied so far / to copy, while syncing a batch. */
  done: number | null;
  total: number | null;
  lastSyncedMs: number | null;
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

/** What happened to a path on disk between two polls — mirrors `ChangeKind`
 *  in src-tauri/src/watcher.rs. There is no `renamed`: a poll cannot pair the
 *  two halves of a move, so an external rename arrives as a removal plus a
 *  creation. */
export type WorkspaceChangeKind = "created" | "modified" | "removed";

export interface WorkspaceFileChange {
  relPath: string;
  kind: WorkspaceChangeKind;
  /** Always false for `removed`; a removed path is treated as covering
   *  everything beneath it either way. */
  isDir: boolean;
}

export interface WorkspaceFilesChangedPayload {
  changes: WorkspaceFileChange[];
}

export interface WorkspaceInfo {
  /** Standalone file with a private compilation mirror and original URI. */
  document?: boolean;
  /** The id it was opened with; empty for a standalone document. */
  id: string;
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
  /** File name as a heading above the first line (Obsidian's inline title). */
  showInlineTitle?: boolean;
  /** Scrolling hides the floating header, dock and status bar (phones). */
  hideChromeOnScroll?: boolean;
  autosaveMs: number;
  previewScaleBucket: 1 | 2 | 3 | 4;
  /** Id of the most recently opened workspace, re-opened on launch (a bare
   *  name from older builds still resolves to its app-storage workspace). */
  lastWorkspace: string | null;
  /** App-wide fonts source folder (path or SAF URI) loaded into the compiler. */
  fontsDir: string | null;
  lastExportFormat?: ExportFormat;
  lastPdfStandard?: string;
  lastPngScale?: number;
  lastPackageMode?: "zip" | "folder";
  /** When the launch-time update check last reached the server (epoch ms). */
  lastUpdateCheck?: number;
}

/** A newer build on this app's release track (`check_for_update`). */
export interface UpdateInfo {
  version: string;
  /** The APK download, opened in the browser to install over this app. */
  url: string;
  notes: string;
}

// ─── Export configuration ──────────────────────────────────────────────────

export type ExportFormat = "pdf" | "png" | "svg" | "html";

export interface PdfExportConfig {
  pageRange?: string | null;
  standard?: string | null;
  title?: string | null;
  author?: string | null;
  includeDate?: boolean;
}

export interface PngExportConfig {
  pageRange?: string | null;
  scale?: number;
  packageMode?: "zip" | "folder";
}

export interface SvgExportConfig {
  pageRange?: string | null;
  packageMode?: "zip" | "folder";
}

export interface HtmlExportConfig {
  pretty?: boolean;
}

export interface ExportShareConfig {
  format: ExportFormat;
  pageRange?: string | null;
  scale?: number;
  standard?: string | null;
  title?: string | null;
  author?: string | null;
  pretty?: boolean;
  packageMode?: "zip" | "folder";
}

export interface ExportShareResult {
  filePath: string;
  fileName: string;
  mimeType: string;
}


/** `tauri-plugin-system-bars::Insets` — system-bar and display-cutout insets,
 *  in CSS px. All zero off Android. */
export interface SystemInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
