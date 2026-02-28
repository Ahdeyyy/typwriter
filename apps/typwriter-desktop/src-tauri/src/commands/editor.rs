// commands/editor.rs
//
// Tauri commands for the editor pane:
//   - update_file_content  (shadow write → disk flush)
//   - get_completions      (typst-ide autocomplete)
//   - get_tooltip          (typst-ide tooltip)
//   - get_definitions      (typst-ide go-to-definition)

use std::{path::Path, sync::Arc, time::Instant};

use base64::Engine;
use log::{debug, error, info};
use serde::Serialize;
use tauri::State;
use typst::{layout::PagedDocument, syntax::Side, World};

use crate::{compiler::PreviewPipeline, workspace::WorkspaceState, world::EditorWorld};

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
            error!("read_file: io error reading image path={path:?} err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            e.to_string()
        })?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        info!("read_file: ok image mime={mime} bytes={} ({:.1}ms)", bytes.len(), t.elapsed().as_secs_f64() * 1000.0);
        return Ok(FileContentResponse::Image {
            base64: b64,
            mime: mime.to_string(),
        });
    }

    // Check if it's a known text extension
    let is_text = matches!(
        ext.as_str(),
        "typ" | "txt" | "md" | "markdown" | "json" | "toml"
            | "yaml" | "yml" | "html" | "htm" | "css"
            | "js" | "ts" | "xml" | "csv" | "ini"
            | "env" | "sh" | "rs" | "log" | "cfg" | "bib"
    );

    if is_text {
        let content = std::fs::read_to_string(abs).map_err(|e| {
            error!("read_file: io error reading text path={path:?} err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            e.to_string()
        })?;
        info!("read_file: ok text bytes={} ({:.1}ms)", content.len(), t.elapsed().as_secs_f64() * 1000.0);
        return Ok(FileContentResponse::Text { content });
    }

    info!("read_file: ok unsupported ext ext={ext:?} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
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
    debug!("update_file_content: path={path:?} content_bytes={}", content.len());

    let abs = Path::new(&path);
    let id = world
        .path_to_id(abs)
        .ok_or_else(|| {
            let e = "Could not resolve file path to a FileId";
            error!("update_file_content: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
            e.to_string()
        })?;
    world.shadow_write(id, content);
    debug!("update_file_content: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
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
) -> Result<(), String> {
    let t = Instant::now();
    info!("save_file: path={path:?} content_bytes={}", content.len());

    let abs = Path::new(&path);
    let id = world
        .path_to_id(abs)
        .ok_or_else(|| {
            let e = "Could not resolve file path to a FileId";
            error!("save_file: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
            e.to_string()
        })?;

    std::fs::write(abs, content.as_bytes()).map_err(|e| {
        error!("save_file: io error path={path:?} err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;

    // Remove the shadow since disk now matches the editor content.
    world.shadow_remove(id);

    // Best-effort: update the workspace thumbnail on save.
    workspace.generate_thumbnail();

    info!("save_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
    Ok(())
}

/// Remove the shadow override for a file (e.g. after discarding unsaved edits).
#[tauri::command]
pub fn discard_shadow(path: String, world: State<'_, Arc<EditorWorld>>) -> Result<(), String> {
    let t = Instant::now();
    info!("discard_shadow: path={path:?}");

    let abs = Path::new(&path);
    let id = world
        .path_to_id(abs)
        .ok_or_else(|| {
            let e = "Could not resolve file path to a FileId";
            error!("discard_shadow: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
            e.to_string()
        })?;
    world.shadow_remove(id);
    info!("discard_shadow: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
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
        error!("get_completions: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!("get_completions: source error path={path:?} err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;
    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

    let result = typst_ide::autocomplete(&**world, doc_ref, &source, cursor, explicit);

    match result {
        Some((from, items)) => {
            let count = items.len();
            let response = CompletionsResponse {
                from,
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
            debug!("get_completions: ok — {count} items from={from} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            Ok(response)
        }
        None => {
            debug!("get_completions: ok — no completions ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            Ok(CompletionsResponse {
                from: cursor,
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
        error!("get_tooltip: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!("get_tooltip: source error path={path:?} err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;
    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

    let tooltip = typst_ide::tooltip(&**world, doc_ref, &source, cursor, Side::Before);
    let found = tooltip.is_some();
    debug!("get_tooltip: ok found={found} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);

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
        error!("get_definitions: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!("get_definitions: source error path={path:?} err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;
    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

    let def = typst_ide::definition(&**world, doc_ref, &source, cursor, Side::Before);
    let result = def.and_then(|d| serialize_definition(&d, &**world));
    let found = result.is_some();
    debug!("get_definitions: ok found={found} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
    Ok(result)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Serialise a `typst_ide::Jump` to our IPC-safe `JumpResponse` type.
pub(crate) fn serialize_jump(jump: &typst_ide::Jump, _world: &dyn typst::World) -> JumpResponse {
    match jump {
        typst_ide::Jump::File(id, offset) => {
            let path = id
                .vpath()
                .as_rootless_path()
                .to_str()
                .map(String::from)
                .unwrap_or_default();
            JumpResponse::File {
                path,
                start_byte: *offset,
                end_byte: *offset,
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
    world: &dyn typst::World,
) -> Option<JumpResponse> {
    match def {
        typst_ide::Definition::Span(span) => {
            let id = span.id()?;
            let source = world.source(id).ok()?;
            let range = source.range(*span)?;
            let path = id
                .vpath()
                .as_rootless_path()
                .to_str()
                .map(String::from)
                .unwrap_or_default();
            Some(JumpResponse::File {
                path,
                start_byte: range.start,
                end_byte: range.end,
            })
        }
        typst_ide::Definition::Std(_) => None,
    }
}
