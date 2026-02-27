// commands/editor.rs
//
// Tauri commands for the editor pane:
//   - update_file_content  (shadow write → disk flush)
//   - get_completions      (typst-ide autocomplete)
//   - get_tooltip          (typst-ide tooltip)
//   - get_definitions      (typst-ide go-to-definition)

use std::{path::Path, sync::Arc};

use serde::Serialize;
use tauri::State;
use typst::{
    layout::PagedDocument,
    syntax::Side,
    World,
};

use crate::{compiler::PreviewPipeline, world::EditorWorld};

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

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Called on every keystroke.  Writes to the in-memory shadow buffer so the
/// next compile sees the new content.  Does NOT write to disk — call
/// `save_file` explicitly for that.
#[tauri::command]
pub fn update_file_content(
    path: String,
    content: String,
    world: State<'_, Arc<EditorWorld>>,
) -> Result<(), String> {
    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or("Could not resolve file path to a FileId")?;
    world.shadow_write(id, content);
    Ok(())
}

/// Persist the current editor content to disk.
/// Called explicitly by the frontend (e.g. on Ctrl+S).
#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    world: State<'_, Arc<EditorWorld>>,
) -> Result<(), String> {
    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or("Could not resolve file path to a FileId")?;

    std::fs::write(abs, content.as_bytes()).map_err(|e| e.to_string())?;

    // Remove the shadow since disk now matches the editor content.
    world.shadow_remove(id);
    Ok(())
}

/// Remove the shadow override for a file (e.g. after discarding unsaved edits).
#[tauri::command]
pub fn discard_shadow(
    path: String,
    world: State<'_, Arc<EditorWorld>>,
) -> Result<(), String> {
    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or("Could not resolve file path to a FileId")?;
    world.shadow_remove(id);
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
    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or("Could not resolve file path")?;

    let source = world.source(id).map_err(|e| e.to_string())?;
    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

    let result = typst_ide::autocomplete(&**world, doc_ref, &source, cursor, explicit);

    match result {
        Some((from, items)) => Ok(CompletionsResponse {
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
        }),
        None => Ok(CompletionsResponse {
            from: cursor,
            completions: vec![],
        }),
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
    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or("Could not resolve file path")?;

    let source = world.source(id).map_err(|e| e.to_string())?;
    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

    let tooltip = typst_ide::tooltip(&**world, doc_ref, &source, cursor, Side::Before);

    Ok(tooltip.map(|t| match t {
        typst_ide::Tooltip::Text(s) => TooltipResponse::Text { value: s.to_string() },
        typst_ide::Tooltip::Code(code) => TooltipResponse::Code { text: code.to_string() },
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
    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or("Could not resolve file path")?;

    let source = world.source(id).map_err(|e| e.to_string())?;
    let guard = pipeline.last_document.lock();
    let doc_ref: Option<&PagedDocument> = guard.as_deref();

    let def = typst_ide::definition(&**world, doc_ref, &source, cursor, Side::Before);
    Ok(def.and_then(|d| serialize_definition(&d, &**world)))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Serialise a `typst_ide::Jump` to our IPC-safe `JumpResponse` type.
pub(crate) fn serialize_jump(jump: &typst_ide::Jump, _world: &dyn typst::World) -> JumpResponse {
    match jump {
        typst_ide::Jump::File(id, offset) => {
            let path = id.vpath().as_rootless_path().to_str().map(String::from).unwrap_or_default();
            JumpResponse::File {
                path,
                start_byte: *offset,
                end_byte: *offset,
            }
        }
        typst_ide::Jump::Url(url) => JumpResponse::Url { url: url.to_string() },
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
            let path = id.vpath().as_rootless_path().to_str().map(String::from).unwrap_or_default();
            Some(JumpResponse::File {
                path,
                start_byte: range.start,
                end_byte: range.end,
            })
        }
        typst_ide::Definition::Std(_) => None,
    }
}
