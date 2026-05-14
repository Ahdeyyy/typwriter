// commands/editor.rs
//
// Tauri commands for the editor pane:
//   - update_file_content  (shadow write → disk flush)
//   - get_completions      (typst-ide autocomplete)
//   - get_tooltip          (typst-ide tooltip)
//   - get_definitions      (typst-ide go-to-definition)

use std::{path::Path, sync::Arc, time::Instant};

use base64::Engine;
use ecow::EcoString;
use log::{debug, error, info, warn};
use serde::Serialize;
use tauri::State;
use typst::{
    foundations::Bytes,
    layout::PagedDocument,
    syntax::{package::PackageSpec, FileId, Side, Source},
    text::{Font, FontBook},
    utils::LazyHash,
    Library, World,
};
use typst_ide::IdeWorld;

use crate::{
    compiler::{CompileReason, PreviewPipeline},
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

    fn today(&self, offset: Option<i64>) -> Option<typst::foundations::Datetime> {
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
    Text { content: String },
    Image { base64: String, mime: String },
    Unsupported,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Read a file from disk and return its content.
/// Text files are returned as UTF-8 strings; image files are base64-encoded.
#[tauri::command]
pub fn read_file(path: String) -> Result<FileContentResponse, String> {
    let t = Instant::now();
    info!("read_file: path={path:?}");

    let abs = Path::new(&path);
    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

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
        // Image / binary → base64
        let bytes = std::fs::read(abs).map_err(|e| {
            error!(
                "read_file: io error reading image path={path:?} err=\"{e}\" ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            e.to_string()
        })?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        info!(
            "read_file: ok image mime={mime} bytes={} ({:.1}ms)",
            bytes.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Ok(FileContentResponse::Image {
            base64: b64,
            mime: mime.to_string(),
        });
    }

    // Check if it's a known text extension
    let is_text = matches!(
        ext.as_str(),
        "typ"
            | "txt"
            | "md"
            | "markdown"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "html"
            | "htm"
            | "css"
            | "js"
            | "ts"
            | "xml"
            | "csv"
            | "ini"
            | "env"
            | "sh"
            | "rs"
            | "log"
            | "cfg"
            | "bib"
    );

    if is_text {
        let content = std::fs::read_to_string(abs).map_err(|e| {
            error!(
                "read_file: io error reading text path={path:?} err=\"{e}\" ({:.1}ms)",
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

    std::fs::write(abs, content.as_bytes()).map_err(|e| {
        error!(
            "save_file: io error path={path:?} err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    // Remove the shadow since disk now matches the editor content.
    world.shadow_remove(id);

    if workspace.should_generate_thumbnail_for(abs) {
        workspace.generate_thumbnail();
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

    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

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

    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

    // Try against the latest compiled document first, then document-agnostic.
    let mut tooltip = typst_ide::tooltip(&**world, doc_ref, &source, byte_cursor, Side::Before)
        .or_else(|| typst_ide::tooltip(&**world, None, &source, byte_cursor, Side::Before))
        .or_else(|| typst_ide::tooltip(&**world, doc_ref, &source, byte_cursor, Side::After))
        .or_else(|| typst_ide::tooltip(&**world, None, &source, byte_cursor, Side::After));

    // If still unresolved and this is not the configured main file, retry with
    // an override world where `main()` points to the queried file.
    if tooltip.is_none() && id != world.main() {
        let local_world = MainOverrideWorld::new(&world, id);
        tooltip = typst_ide::tooltip(&local_world, None, &source, byte_cursor, Side::Before)
            .or_else(|| typst_ide::tooltip(&local_world, None, &source, byte_cursor, Side::After));
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

    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

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
            let range = source.range(*span)?;
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
        typst_ide::Definition::Std(_) => None,
    }
}
