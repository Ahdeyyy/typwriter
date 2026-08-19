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

/** Filesystem metadata for a file the editor can't render. Every field is
 *  optional — a stat can fail, and not every filesystem records a birth time.
 *  Timestamps are milliseconds since the Unix epoch. */
/** A project-wide search hit. Offsets and columns are UTF-16 code units,
 *  CodeMirror's coordinate space. */
export interface SearchHit {
    path: string;
    /** 1-based. */
    line: number;
    /** The whole line, for display. */
    preview: string;
    matchStart: number;
    matchEnd: number;
    /** Absolute offset in the file, for jumping. */
    offset: number;
}

export interface SearchResults {
    hits: SearchHit[];
    filesSearched: number;
    /** True when the hit cap cut the list short. */
    truncated: boolean;
}

export interface SearchQuery {
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    regex: boolean;
    /** Empty means every text file. */
    extensions: string[];
}

export interface ReplaceOutcome {
    filesChanged: number;
    replacements: number;
    /** Restore point taken before writing. */
    restorePoint: string | null;
}

/** One package from the Typst Universe index, versions folded together. */
export interface PackageEntry {
    namespace: string;
    name: string;
    /** Newest version. */
    version: string;
    /** Every listed version, newest first. */
    versions: string[];
    description: string | null;
}

export interface FileMeta {
    size: number | null;
    modified: number | null;
    created: number | null;
    readonly: boolean | null;
}

/** Internally-tagged union (discriminant: `type`). */
export type FileContentResponse =
    | { type: 'text'; content: string }
    | { type: 'image'; path: string; mime: string }
    | { type: 'unsupported'; meta: FileMeta };

// ─── Click / Jump ─────────────────────────────────────────────────────────────

/** A rectangle on a preview page, in typst points with the origin at the page's
 *  top-left corner. */
export interface PreviewHighlightRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PreviewPositionResponse {
    /** 0-based page index. */
    page: number;
    /** Horizontal offset in typst points from the left edge of the page. */
    x: number;
    /** Vertical offset in typst points from the top edge of the page. */
    y: number;
    /** Width of the resolved page in typst points (for placing highlights as a
     *  fraction of the displayed image). */
    page_width: number;
    /** Height of the resolved page in typst points. */
    page_height: number;
    /** Rectangles covering the text run the caret maps to on the resolved page —
     *  one per rendered line. Empty when there's nothing to highlight. */
    highlights: PreviewHighlightRect[];
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
    /**
     * PDF standard(s): "1.4", "1.7", "2.0", "a-2b", "ua-1", etc. Multiple
     * compatible standards can be combined with "+" (e.g. "a-2b+ua-1"). Omit
     * for default (1.7).
     */
    pdf_standard?: string | null;
    /** Stamp the current local date as the PDF creation timestamp. */
    include_date?: boolean | null;
    /** Human-readable (uncompressed) PDF. Omit/false for a smaller file. */
    pretty?: boolean | null;
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

export interface HtmlExportConfig {
    path: string;
    /** Human-readable (indented) HTML. Omit/false for minified output. */
    pretty?: boolean | null;
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
    /** The pages on screen are from an older compile: the most recent one
     *  failed to produce a document. The backend keeps the last good render
     *  rather than blanking the pane, so this is how the UI knows to say so. */
    stale: boolean;
}

/** What happened to a path on disk between two quiet moments — mirrors
 *  `ChangeKind` in src-tauri/src/workspace/watcher.rs. */
export type WorkspaceChangeKind = 'created' | 'modified' | 'removed' | 'renamed';

export interface WorkspaceFileChange {
    /** Absolute path. For a rename this is where the entry *was*. */
    path: string;
    kind: WorkspaceChangeKind;
    /** Where a renamed entry landed. Absent for every other kind. */
    to?: string;
    /** Whether the entry is a directory. Always false for `removed`, where
     *  there is nothing left to ask — a removed path is treated as covering
     *  everything beneath it either way. */
    isDir: boolean;
}

export interface WorkspaceFilesChangedPayload {
    changes: WorkspaceFileChange[];
}

// ─── Versioning / Restore points ──────────────────────────────────────────────

export type CommitTrigger =
    | 'initial'
    | 'manual'
    | 'save'
    | 'compile'
    | 'pre_restore'
    | 'file_op';

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

// ─── Page-level diff ──────────────────────────────────────────────────────────
//
// "Which pages changed since this restore point." Computed by compiling the
// snapshot and aligning its page fingerprints against the current document's,
// so it arrives asynchronously over `vcs:page-diff` rather than as a command
// return value — see `vcsPageDiffRequest`.

export type PageChangeKind = 'unchanged' | 'changed' | 'added' | 'removed';

/** Which of the two compared documents a full-size page render comes from. */
export type PageDiffSide = 'before' | 'after';

export interface PageDiffEntry {
    kind: PageChangeKind;
    /** 0-based page index in the older document; `null` for added pages. */
    before_index: number | null;
    /** 0-based page index in the newer document; `null` for removed pages. */
    after_index: number | null;
    /** `previewimg://` path component for the thumbnail, or `null` when the
     *  page doesn't exist on that side or fell outside the render budget. */
    before_key: string | null;
    after_key: string | null;
}

export interface PageDiffPayload {
    request_id: number;
    from_id: string;
    /** `null` when the comparison target is the current working document. */
    to_id: string | null;
    before_pages: number;
    after_pages: number;
    changed: number;
    added: number;
    removed: number;
    unchanged: number;
    entries: PageDiffEntry[];
    /** Some entries carry no thumbnails: the render budget ran out. */
    truncated: boolean;
    elapsed_ms: number;
}

export interface PageDiffStartedPayload {
    request_id: number;
}

export interface PageDiffErrorPayload {
    request_id: number;
    message: string;
}

// ─── Grammar checking ─────────────────────────────────────────────────────────

export type GrammarDialect =
    | 'american'
    | 'british'
    | 'canadian'
    | 'australian'
    | 'indian';

/** Which reader a file gets. `data` formats are masked down to the prose-bearing
 *  parts before checking; unlisted file types aren't checked at all. */
export type CheckedFormat =
    | 'typst'
    | 'markdown'
    | 'plain-text'
    | { data: 'json' | 'yaml' | 'toml' | 'csv' | 'xml' | 'bib-tex' };

/** Why a report came back empty. */
export type GrammarSkipReason = 'disabled' | 'file-disabled' | 'unsupported-format';

/** A suggested edit. Offsets come from the owning lint. */
export type GrammarSuggestion =
    | { type: 'replace'; text: string }
    | { type: 'insert-after'; text: string }
    | { type: 'remove' };

export interface GrammarLint {
    /** Start offset in UTF-16 code units — directly usable as a CodeMirror position. */
    start: number;
    end: number;
    /** The text the lint covers. */
    text: string;
    message: string;
    /** Harper's category: `spelling`, `grammar`, `style`, … */
    kind: string;
    /** The rule that fired, so the UI can offer to disable it. */
    rule: string;
    /** Lower is more important. */
    priority: number;
    suggestions: GrammarSuggestion[];
}

export interface GrammarReport {
    filePath: string;
    /** `null` when the file's type has no reader. */
    format: CheckedFormat | null;
    /** Display name of `format` ("Typst", "BibTeX", …). */
    formatLabel: string | null;
    skipped: GrammarSkipReason | null;
    lints: GrammarLint[];
}

export interface GrammarConfig {
    enabled: boolean;
    dialect: GrammarDialect;
    /** Per-rule overrides keyed by Harper's rule name; absent = curated default. */
    rules: Record<string, boolean>;
    userDictionary: string[];
    /** Workspace-relative paths the user has opted out. */
    disabledFiles: string[];
}

export interface GrammarRuleInfo {
    name: string;
    description: string;
    enabled: boolean;
}

// ─── Presentation mode ────────────────────────────────────────────────────────

/** One connected display, as reported by the `list_displays` command. */
export interface DisplayInfo {
    /** Stable-ish OS identifier (`\.\DISPLAY2` on Windows) — what gets
     *  persisted when the user pins a display for presenting. */
    id: string;
    /** Raw monitor name, when the OS supplies one. */
    name: string | null;
    /** Origin in the virtual desktop, physical pixels. */
    x: number;
    y: number;
    /** Resolution in physical pixels. */
    width: number;
    height: number;
    scaleFactor: number;
    isPrimary: boolean;
    /** The display the main editor window is currently on. */
    isMainWindow: boolean;
}
