// IPC payload types — mirror the Rust serde types in src-tauri/src. All paths
// are workspace-relative with `/` separators, except workspace `path`/`root`
// which are absolute. The single source of truth is
// plans/typwriter-mobile/02-rust-core.md.

export interface WorkspaceMeta {
  name: string;
  path: string;
  lastOpenedMs: number | null;
}

export interface FileNode {
  name: string;
  relPath: string;
  isDir: boolean;
  children: FileNode[];
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  tree: FileNode;
  mainFile: string | null;
  lastFile: string | null;
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
}
