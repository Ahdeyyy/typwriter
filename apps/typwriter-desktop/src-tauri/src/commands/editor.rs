// commands/editor.rs
//
// Tauri commands for the editor pane:
//   - update_file_content  (shadow write → disk flush)
//   - get_completions      (typst-ide autocomplete)
//   - get_tooltip          (typst-ide tooltip)
//   - get_definitions      (typst-ide go-to-definition)

use std::{path::Path, sync::Arc, time::Instant};

use ecow::EcoString;
use log::{debug, error, info, warn};
use parking_lot::RwLock;
use serde::Serialize;
use tauri::State;
use typst::{
    foundations::Bytes,
    syntax::{package::PackageSpec, FileId, Side, Source},
    text::{Font, FontBook},
    utils::LazyHash,
    Library, World, WorldExt,
};
use typst_ide::IdeWorld;
use typst_layout::PagedDocument;

use crate::{
    compiler::{CompileReason, PreviewPipeline},
    vcs::{CommitTrigger, SnapshotPolicy, VcsState},
    workspace::WorkspaceState,
    world::EditorWorld,
};

/// `World` proxy that resolves IDE queries as if `main()` were `query_main`.
/// This avoids mutating the shared global main file while enabling file-agnostic
/// hover behavior for non-main tabs.
struct MainOverrideWorld<'a> {
    inner: &'a EditorWorld,
    query_main: FileId,
}

impl<'a> MainOverrideWorld<'a> {
    fn new(inner: &'a EditorWorld, query_main: FileId) -> Self {
        Self { inner, query_main }
    }
}

impl World for MainOverrideWorld<'_> {
    fn library(&self) -> &LazyHash<Library> {
        self.inner.library()
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.inner.book()
    }

    fn main(&self) -> FileId {
        self.query_main
    }

    fn source(&self, id: FileId) -> typst::diag::FileResult<Source> {
        self.inner.source(id)
    }

    fn file(&self, id: FileId) -> typst::diag::FileResult<Bytes> {
        self.inner.file(id)
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.inner.font(index)
    }

    fn today(
        &self,
        offset: Option<typst::foundations::Duration>,
    ) -> Option<typst::foundations::Datetime> {
        self.inner.today(offset)
    }
}

impl IdeWorld for MainOverrideWorld<'_> {
    fn upcast(&self) -> &dyn World {
        self
    }

    fn packages(&self) -> &[(PackageSpec, Option<EcoString>)] {
        self.inner.packages()
    }

    fn files(&self) -> Vec<FileId> {
        self.inner.files()
    }
}

// ─── Serialisable IDE response types ─────────────────────────────────────────

#[derive(Serialize)]
pub struct CompletionItem {
    pub kind: String,
    pub label: String,
    pub apply: Option<String>,
    pub detail: Option<String>,
}

#[derive(Serialize)]
pub struct CompletionsResponse {
    /// Character offset at which the completion list should replace text.
    pub from: usize,
    pub completions: Vec<CompletionItem>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TooltipResponse {
    Text { value: String },
    Code { text: String },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum JumpResponse {
    /// Jump to a byte offset inside a source file.
    File {
        path: String,
        start_byte: usize,
        end_byte: usize,
    },
    Url {
        url: String,
    },
    Position {
        page: usize,
        x: f64,
        y: f64,
    },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileContentResponse {
    Text {
        content: String,
    },
    Image {
        path: String,
        mime: String,
    },
    Unsupported,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Read a file from disk and return its content.
/// Text files are returned as UTF-8 strings; image files are returned as paths
/// that the frontend can convert into Tauri asset URLs.
///
/// Reads route through the workspace's [`WorkingTreeFs`].
#[tauri::command]
pub fn read_file(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<FileContentResponse, String> {
    let t = Instant::now();
    info!("read_file: path={path:?}");

    let abs = Path::new(&path);
    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // Resolve the working-tree accessor for the current workspace root. An
    // empty root (no workspace open) maps to a plain std::fs accessor, since
    // `abs` is always an absolute path the local filesystem can serve directly.
    let root = workspace.root.read().clone().unwrap_or_default();
    let fs = vcs.working_tree_fs_for(&root);

    // Determine MIME type for image extensions
    let mime = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        "tiff" | "tif" => Some("image/tiff"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    };

    if let Some(mime) = mime {
        // Return a path the frontend turns into an asset URL — cheap, and
        // avoids base64-bloating every image over IPC.
        let metadata = std::fs::metadata(abs).map_err(|e| {
            error!(
                "read_file: io error reading image metadata path={path:?} err=\"{e}\" ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            e.to_string()
        })?;
        info!(
            "read_file: ok image mime={mime} bytes={} ({:.1}ms)",
            metadata.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Ok(FileContentResponse::Image {
            path: abs.to_string_lossy().into_owned(),
            mime: mime.to_string(),
        });
    }

    // Check if it's a known text extension
    let is_text = matches!(
        ext.as_str(),
        // documents / data / config
        "typ" | "txt" | "md" | "markdown" | "rst" | "adoc" | "org" | "bib"
            | "tex" | "sty" | "cls" | "json" | "jsonc" | "json5" | "toml"
            | "yaml" | "yml" | "xml" | "csv" | "tsv" | "ini" | "cfg" | "conf"
            | "env" | "properties" | "log" | "lock" | "diff" | "patch"
            | "gitignore" | "gitattributes" | "editorconfig"
        // web
            | "html" | "htm" | "css" | "scss" | "sass" | "less" | "styl"
            | "js" | "mjs" | "cjs" | "ts" | "mts" | "cts" | "jsx" | "tsx"
            | "vue" | "svelte" | "astro" | "graphql" | "gql"
        // systems / general-purpose
            | "rs" | "c" | "h" | "cpp" | "hpp" | "cc" | "hh" | "cxx" | "hxx"
            | "cs" | "java" | "kt" | "kts" | "go" | "swift" | "m" | "mm"
            | "zig" | "d" | "nim" | "pas" | "asm" | "s"
        // scripting
            | "py" | "pyw" | "rb" | "php" | "pl" | "pm" | "lua" | "sh"
            | "bash" | "zsh" | "fish" | "ps1" | "psm1" | "psd1" | "bat"
            | "cmd" | "r" | "jl" | "tcl" | "groovy" | "gradle"
        // functional
            | "hs" | "ml" | "mli" | "fs" | "fsx" | "fsi" | "clj" | "cljs"
            | "cljc" | "edn" | "elm" | "erl" | "ex" | "exs" | "scala" | "sc"
            | "lisp" | "el" | "scm" | "rkt"
        // query / build / misc
            | "sql" | "proto" | "cmake" | "mk" | "dockerfile" | "nix" | "sol"
            | "vb" | "dart" | "v" | "sv" | "svh" | "vhd" | "vhdl"
    );

    if is_text {
        let bytes = fs.read_file(abs).map_err(|e| {
            error!(
                "read_file: io error reading text path={path:?} err=\"{e}\" ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            e
        })?;
        let content = String::from_utf8(bytes).map_err(|e| {
            error!(
                "read_file: non-utf8 text path={path:?} err=\"{e}\" ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            e.to_string()
        })?;
        info!(
            "read_file: ok text bytes={} ({:.1}ms)",
            content.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Ok(FileContentResponse::Text { content });
    }

    // Known binary formats: don't bother sniffing the bytes.
    let is_binary = matches!(
        ext.as_str(),
        "pdf" | "zip" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "7z" | "rar"
            | "tar" | "exe" | "dll" | "so" | "dylib" | "bin" | "wasm"
            | "class" | "jar" | "o" | "a" | "lib" | "obj" | "pdb" | "pyc"
            | "ttf" | "otf" | "woff" | "woff2" | "eot" | "mp3" | "wav"
            | "flac" | "ogg" | "m4a" | "mp4" | "mkv" | "mov" | "avi"
            | "webm" | "db" | "sqlite" | "sqlite3" | "heic" | "psd"
    );

    // Unknown extension: sniff the bytes. Plenty of text files carry no
    // recognizable extension (Makefile, LICENSE, dotfiles, niche languages) —
    // anything reasonably sized that decodes as UTF-8 without NUL bytes opens
    // as plain text; real binaries fail fast on the NUL check.
    const SNIFF_MAX_BYTES: usize = 8 * 1024 * 1024;
    if !is_binary {
        if let Ok(bytes) = fs.read_file(abs) {
            let has_nul = bytes.iter().take(8192).any(|&b| b == 0);
            if bytes.len() <= SNIFF_MAX_BYTES && !has_nul {
                if let Ok(content) = String::from_utf8(bytes) {
                    info!(
                        "read_file: ok sniffed text ext={ext:?} bytes={} ({:.1}ms)",
                        content.len(),
                        t.elapsed().as_secs_f64() * 1000.0
                    );
                    return Ok(FileContentResponse::Text { content });
                }
            }
        }
    }

    info!(
        "read_file: ok unsupported ext ext={ext:?} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(FileContentResponse::Unsupported)
}

/// Called on every keystroke.  Writes to the in-memory shadow buffer so the
/// next compile sees the new content.  Does NOT write to disk — call
/// `save_file` explicitly for that.
#[tauri::command]
pub fn update_file_content(
    path: String,
    content: String,
    world: State<'_, Arc<EditorWorld>>,
) -> Result<(), String> {
    let t = Instant::now();
    debug!(
        "update_file_content: path={path:?} content_bytes={}",
        content.len()
    );

    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or_else(|| {
        let e = "Could not resolve file path to a FileId";
        error!(
            "update_file_content: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;
    world.shadow_write(id, content);
    debug!(
        "update_file_content: ok ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

/// Persist the current editor content to disk.
/// Called explicitly by the frontend (e.g. on Ctrl+S).
#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    world: State<'_, Arc<EditorWorld>>,
    workspace: State<'_, Arc<WorkspaceState>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
    vcs: State<'_, Arc<VcsState>>,
    snapshot_policy: State<'_, Arc<RwLock<SnapshotPolicy>>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("save_file: path={path:?} content_bytes={}", content.len());

    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or_else(|| {
        let e = "Could not resolve file path to a FileId";
        error!(
            "save_file: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    // Write through the working-tree accessor for the current workspace root.
    let root = workspace.root.read().clone().unwrap_or_default();
    vcs.working_tree_fs_for(&root)
        .write_file(abs, content.as_bytes())
        .map_err(|e| {
            error!(
                "save_file: io error path={path:?} err=\"{e}\" ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            e
        })?;

    // Remove the shadow since disk now matches the editor content.
    world.shadow_remove(id);

    if workspace.should_generate_thumbnail_for(abs) {
        workspace.generate_thumbnail();
    }

    // Auto-commit a restore point. Cheap when no-op: `commit_if_changed`
    // diffs the working tree against HEAD and short-circuits if nothing
    // changed (e.g. user hit save without edits).
    let file_label = abs
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.clone());
    let policy = snapshot_policy.read().clone();
    if let Err(err) =
        vcs.auto_commit_if_changed(CommitTrigger::Save, &format!("Saved {file_label}"), &policy)
    {
        warn!("save_file: vcs commit failed err=\"{err}\"");
    }

    pipeline.request_compile(CompileReason::Save);

    info!(
        "save_file: ok ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

/// Remove the shadow override for a file (e.g. after discarding unsaved edits).
///
/// Treated as best-effort cleanup: if the path can no longer be resolved to a
/// FileId (e.g. because the workspace root has changed under us), we just log
/// and return Ok — the shadow has nothing to do anyway.
#[tauri::command]
pub fn discard_shadow(path: String, world: State<'_, Arc<EditorWorld>>) -> Result<(), String> {
    let t = Instant::now();
    info!("discard_shadow: path={path:?}");

    let abs = Path::new(&path);
    let Some(id) = world.path_to_id(abs) else {
        warn!(
            "discard_shadow: path outside workspace root, skipping ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Ok(());
    };
    world.shadow_remove(id);
    info!(
        "discard_shadow: ok ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

/// Auto-complete at the given byte offset inside a source file.
///
/// `explicit` is `true` when the user explicitly requested completions
/// (Ctrl+Space) and `false` when triggered automatically after typing a
/// character.
#[tauri::command]
pub fn get_completions(
    path: String,
    cursor: usize,
    explicit: bool,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<CompletionsResponse, String> {
    let t = Instant::now();
    debug!("get_completions: path={path:?} cursor={cursor} explicit={explicit}");

    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or_else(|| {
        let e = "Could not resolve file path";
        error!(
            "get_completions: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!(
            "get_completions: source error path={path:?} err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let text = source.text();
    let byte_cursor = utf16_to_byte(text, cursor);

    // Clone the Arc out of the mutex so the lock is released before the
    // (potentially long) IDE traversal — keeps concurrent click/hover
    // handlers from blocking on us.
    let doc = pipeline.last_document.lock().clone();
    let doc_ref: Option<&PagedDocument> = doc.as_deref();

    let result = typst_ide::autocomplete(&**world, doc_ref, &source, byte_cursor, explicit);

    match result {
        Some((from, items)) => {
            let count = items.len();
            let response = CompletionsResponse {
                from: byte_to_utf16(text, from),
                completions: items
                    .into_iter()
                    .map(|c| CompletionItem {
                        kind: format!("{:?}", c.kind),
                        label: c.label.to_string(),
                        apply: c.apply.map(|a| a.to_string()),
                        detail: c.detail.map(|d| d.to_string()),
                    })
                    .collect(),
            };
            debug!(
                "get_completions: ok — {count} items from={from} ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            Ok(response)
        }
        None => {
            debug!(
                "get_completions: ok ��� no completions ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            Ok(CompletionsResponse {
                from: cursor, // already in UTF-16 units (passthrough)
                completions: vec![],
            })
        }
    }
}

/// Return a hover tooltip for the symbol at `cursor` bytes into the source.
#[tauri::command]
pub fn get_tooltip(
    path: String,
    cursor: usize,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<Option<TooltipResponse>, String> {
    let t = Instant::now();
    debug!("get_tooltip: path={path:?} cursor={cursor}");

    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or_else(|| {
        let e = "Could not resolve file path";
        error!(
            "get_tooltip: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!(
            "get_tooltip: source error path={path:?} err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let byte_cursor = utf16_to_byte(source.text(), cursor);

    let doc = pipeline.last_document.lock().clone();
    let doc_ref: Option<&PagedDocument> = doc.as_deref();

    // Try against the latest compiled document first, then document-agnostic.
    // `None` needs an explicit type since the `output` parameter is now generic
    // (`Option<impl AsOutput>`); `&PagedDocument` is the natural choice.
    let mut tooltip = typst_ide::tooltip(&**world, doc_ref, &source, byte_cursor, Side::Before)
        .or_else(|| typst_ide::tooltip(&**world, None::<&PagedDocument>, &source, byte_cursor, Side::Before))
        .or_else(|| typst_ide::tooltip(&**world, doc_ref, &source, byte_cursor, Side::After))
        .or_else(|| typst_ide::tooltip(&**world, None::<&PagedDocument>, &source, byte_cursor, Side::After));

    // If still unresolved and this is not the configured main file, retry with
    // an override world where `main()` points to the queried file.
    if tooltip.is_none() && id != world.main() {
        let local_world = MainOverrideWorld::new(&world, id);
        tooltip = typst_ide::tooltip(&local_world, None::<&PagedDocument>, &source, byte_cursor, Side::Before)
            .or_else(|| typst_ide::tooltip(&local_world, None::<&PagedDocument>, &source, byte_cursor, Side::After));
    }
    let found = tooltip.is_some();
    debug!(
        "get_tooltip: ok found={found} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(tooltip.map(|t| match t {
        typst_ide::Tooltip::Text(s) => TooltipResponse::Text {
            value: s.to_string(),
        },
        typst_ide::Tooltip::Code(code) => TooltipResponse::Code {
            text: code.to_string(),
        },
    }))
}

/// Return the definition location for the symbol at `cursor` bytes into the
/// source.  Returns `null` when the definition is in the standard library or
/// cannot be resolved to a file position.
#[tauri::command]
pub fn get_definitions(
    path: String,
    cursor: usize,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<Option<JumpResponse>, String> {
    let t = Instant::now();
    debug!("get_definitions: path={path:?} cursor={cursor}");

    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or_else(|| {
        let e = "Could not resolve file path";
        error!(
            "get_definitions: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!(
            "get_definitions: source error path={path:?} err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let byte_cursor = utf16_to_byte(source.text(), cursor);

    let doc = pipeline.last_document.lock().clone();
    let doc_ref: Option<&PagedDocument> = doc.as_deref();

    let def = typst_ide::definition(&**world, doc_ref, &source, byte_cursor, Side::Before);
    let result = def.and_then(|d| serialize_definition(&d, &**world));
    let found = result.is_some();
    debug!(
        "get_definitions: ok found={found} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(result)
}

// ─── Offset conversion ───────────────────────────────────────────────────────
//
// The frontend (CodeMirror) counts positions as UTF-16 code units, while
// Typst internally uses UTF-8 byte offsets. These helpers bridge the two at
// the IPC boundary so every offset crossing Tauri is in UTF-16 units.

/// Convert a UTF-8 byte offset to a UTF-16 code unit offset.
pub(crate) fn byte_to_utf16(text: &str, byte_offset: usize) -> usize {
    let clamped = byte_offset.min(text.len());
    text[..clamped].encode_utf16().count()
}

/// Convert a UTF-16 code unit offset to a UTF-8 byte offset.
pub(crate) fn utf16_to_byte(text: &str, utf16_offset: usize) -> usize {
    let mut utf16_count = 0usize;
    for (byte_idx, ch) in text.char_indices() {
        if utf16_count >= utf16_offset {
            return byte_idx;
        }
        utf16_count += ch.len_utf16();
    }
    text.len()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Serialise a `typst_ide::Jump` to our IPC-safe `JumpResponse` type.
/// Byte offsets are converted to UTF-16 code unit offsets for the frontend.
pub(crate) fn serialize_jump(jump: &typst_ide::Jump, world: &EditorWorld) -> JumpResponse {
    match jump {
        typst_ide::Jump::File(id, offset) => {
            let path = world
                .id_to_path(*id)
                .ok()
                .and_then(|p| p.to_str().map(String::from))
                .unwrap_or_default();
            let utf16_offset = world
                .source(*id)
                .map(|src| byte_to_utf16(src.text(), *offset))
                .unwrap_or(*offset);
            JumpResponse::File {
                path,
                start_byte: utf16_offset,
                end_byte: utf16_offset,
            }
        }
        typst_ide::Jump::Url(url) => JumpResponse::Url {
            url: url.to_string(),
        },
        typst_ide::Jump::Position(pos) => JumpResponse::Position {
            page: pos.page.get() - 1, // 1-based → 0-based
            x: pos.point.x.to_pt(),
            y: pos.point.y.to_pt(),
        },
    }
}

/// Serialise a `typst_ide::Definition` to our IPC-safe `JumpResponse` type.
/// Returns `None` for standard-library definitions that have no source file.
pub(crate) fn serialize_definition(
    def: &typst_ide::Definition,
    world: &EditorWorld,
) -> Option<JumpResponse> {
    match def {
        typst_ide::Definition::Span(span) => {
            let id = span.id()?;
            let source = world.source(id).ok()?;
            let range = world.range(*span)?;
            let text = source.text();
            let path = world
                .id_to_path(id)
                .ok()
                .and_then(|p| p.to_str().map(String::from))
                .unwrap_or_default();
            Some(JumpResponse::File {
                path,
                start_byte: byte_to_utf16(text, range.start),
                end_byte: byte_to_utf16(text, range.end),
            })
        }
        // New in 0.15: the definition is an entire included/imported file.
        // Jump to its start.
        typst_ide::Definition::File(id) => {
            let path = world
                .id_to_path(*id)
                .ok()
                .and_then(|p| p.to_str().map(String::from))
                .unwrap_or_default();
            Some(JumpResponse::File {
                path,
                start_byte: 0,
                end_byte: 0,
            })
        }
        typst_ide::Definition::Std(_) => None,
    }
}
