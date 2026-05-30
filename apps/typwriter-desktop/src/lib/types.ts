// ─── Workspace ────────────────────────────────────────────────────────────────

export interface FileTreeEntry {
    name: string;
    path: string;
    is_dir: boolean;
    children: FileTreeEntry[];
}

export interface RecentWorkspaceEntry {
    path: string;
    name: string;
    /** Base64-encoded PNG thumbnail, if available. */
    thumbnail: string | null;
}

// ─── Editor / IDE ─────────────────────────────────────────────────────────────

export interface CompletionItem {
    kind: string;
    label: string;
    apply: string | null;
    detail: string | null;
}

export interface CompletionsResponse {
    /** Character offset at which the completion list should replace text. */
    from: number;
    completions: CompletionItem[];
}

/** Internally-tagged union (discriminant: `type`). */
export type TooltipResponse =
    | { type: 'text'; value: string }
    | { type: 'code'; text: string };

/** Internally-tagged union (discriminant: `type`). */
export type JumpResponse =
    | { type: 'file'; path: string; start_byte: number; end_byte: number }
    | { type: 'url'; url: string }
    | { type: 'position'; page: number; x: number; y: number };

/** Internally-tagged union (discriminant: `type`). */
export type FileContentResponse =
    | { type: 'text'; content: string }
    | { type: 'image'; path: string; mime: string }
    | { type: 'unsupported' };

// ─── Click / Jump ─────────────────────────────────────────────────────────────

export interface PreviewPositionResponse {
    /** 0-based page index. */
    page: number;
    /** Horizontal offset in typst points from the left edge of the page. */
    x: number;
    /** Vertical offset in typst points from the top edge of the page. */
    y: number;
}

export type CompileReason =
    | 'typing'
    | 'save'
    | 'watcher'
    | 'explicit'
    | 'main_file'
    | 'zoom';

// ─── Export configs ───────────────────────────────────────────────────────────

export interface PdfExportConfig {
    path: string;
    title?: string | null;
    author?: string | null;
    /** PDF standard: "1.4", "1.7", "2.0", "a-2b", etc. Omit for default (1.7). */
    pdf_standard?: string | null;
    /** Stamp the current local date as the PDF creation timestamp. */
    include_date?: boolean | null;
}

export interface PngExportConfig {
    dir: string;
    /** Pixels per point. 1.0 → 72 dpi, 2.0 → 144 dpi (retina). */
    scale?: number | null;
    prefix?: string | null;
    /** Page range string like "1-3, 5, 7-9". Omit for all pages. */
    page_range?: string | null;
}

export interface SvgExportConfig {
    dir: string;
    prefix?: string | null;
    /** Page range string like "1-3, 5, 7-9". Omit for all pages. */
    page_range?: string | null;
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export interface DiagnosticRange {
    start_line: number;
    start_col: number;
    end_line: number;
    end_col: number;
}

export interface SerializedDiagnostic {
    /** `"error"` or `"warning"` */
    severity: string;
    message: string;
    hints: string[];
    /** Workspace-relative path, if the span resolves to a local file. */
    file_path: string | null;
    range: DiagnosticRange | null;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface DiagnosticsPayload {
    errors: SerializedDiagnostic[];
    warnings: SerializedDiagnostic[];
}

export interface TotalPagesPayload {
    count: number;
}

export interface PageUpdatedPayload {
    index: number;
    /** Hex-encoded page fingerprint. Use `buildPreviewUrl` to turn this into
     *  the `previewimg://` URL that the webview fetches the PNG from. */
    fingerprint: string;
}

export interface PageRemovedPayload {
    index: number;
}

export interface CompileStatePayload {
    status: 'started' | 'idle';
    revision: number;
    reason: CompileReason;
}

export interface WorkspaceFilesChangedPayload {
    paths: string[];
}

// ─── Versioning / Restore points ──────────────────────────────────────────────

export type CommitTrigger =
    | 'initial'
    | 'manual'
    | 'save'
    | 'compile'
    | 'pre_restore';

export interface RestorePoint {
    /** Full 64-char sha-256 hex snapshot id. */
    id: string;
    parent_id: string | null;
    message: string;
    trigger: CommitTrigger;
    timestamp_seconds: number;
    /** Workspace-relative, forward-slash paths whose tree entry differs from
     *  the parent's. For the initial commit, every file is listed. */
    changed_files: string[];
}

export type FileDiffStatus = 'added' | 'removed' | 'modified';

export interface FileDiff {
    /** Workspace-relative, forward-slash path. */
    path: string;
    status: FileDiffStatus;
    /** `true` when either side is non-UTF-8 or above the size cap. */
    binary: boolean;
    before: string | null;
    after: string | null;
    before_bytes: number;
    after_bytes: number;
}

export interface WorkspaceDiff {
    files: FileDiff[];
}
