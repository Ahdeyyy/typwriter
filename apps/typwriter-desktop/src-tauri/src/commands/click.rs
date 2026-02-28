// commands/click.rs
//
// Bidirectional jump commands between the editor and the preview pane.
//
// Preview → Editor:
//   jump_from_click  — convert a pixel click on a preview page to a source
//                      location so the editor can move the cursor there.
//
// Editor → Preview:
//   jump_from_cursor — convert the editor cursor offset to a list of
//                      (page, point) positions in the preview.

use std::{path::Path, sync::Arc, time::Instant};

use log::{debug, error, info};
use tauri::State;
use typst::{
    layout::{Abs, Point},
    World,
};

use crate::{
    commands::editor::{serialize_jump, JumpResponse},
    compiler::PreviewPipeline,
    world::EditorWorld,
};

// ─── Preview → Editor ─────────────────────────────────────────────────────────

/// Convert a pixel click on a specific page of the preview to a source
/// location.
///
/// `page`  — 0-based page index
/// `x`, `y` — pixel coordinates within that page
#[tauri::command]
pub fn jump_from_click(
    page: usize,
    x: f64,
    y: f64,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<Option<JumpResponse>, String> {
    let t = Instant::now();
    debug!("jump_from_click: page={page} x={x:.1} y={y:.1}");

    let zoom = *pipeline.zoom.lock() as f64;
    let point = Point::new(Abs::pt(x / zoom), Abs::pt(y / zoom));

    let guard = pipeline.last_document.lock();
    let doc = guard.as_deref().ok_or_else(|| {
        let e = "No compiled document available";
        error!("jump_from_click: err=\"{e}\" ({:.1}ms) page={page}", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;

    if page >= doc.pages.len() {
        let e = format!("page index {page} out of bounds (doc has {} pages)", doc.pages.len());
        error!("jump_from_click: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        return Err(e);
    }

    let frame = &doc.pages[page].frame;
    let jump = typst_ide::jump_from_click(&**world, doc, frame, point);
    let found = jump.is_some();
    debug!("jump_from_click: ok found={found} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);

    Ok(jump.map(|j| serialize_jump(&j, &**world)))
}

// ─── Editor → Preview ─────────────────────────────────────────────────────────

/// Convert the editor cursor (byte offset inside a source file) to preview
/// positions.  Returns all matching positions across all pages — typically one,
/// but cross-references may yield multiple hits.
///
/// `path`   — absolute or workspace-relative path to the source file
/// `cursor` — byte offset of the cursor within the source text
#[tauri::command]
pub fn jump_from_cursor(
    path: String,
    cursor: usize,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<Vec<PreviewPositionResponse>, String> {
    let t = Instant::now();
    debug!("jump_from_cursor: path={path:?} cursor={cursor}");

    let abs = Path::new(&path);
    let id = world
        .path_to_id(abs)
        .ok_or_else(|| {
            let e = "Could not resolve file path to a FileId";
            error!("jump_from_cursor: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
            e.to_string()
        })?;

    let source = world.source(id).map_err(|e| {
        error!("jump_from_cursor: source error path={path:?} err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;

    let guard = pipeline.last_document.lock();
    let doc = guard.as_deref().ok_or_else(|| {
        let e = "No compiled document available";
        error!("jump_from_cursor: err=\"{e}\" ({:.1}ms) path={path:?}", t.elapsed().as_secs_f64() * 1000.0);
        e.to_string()
    })?;

    let positions = typst_ide::jump_from_cursor(doc, &source, cursor);
    let count = positions.len();
    info!("jump_from_cursor: ok — {count} position(s) ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);

    Ok(positions
        .into_iter()
        .map(|p| PreviewPositionResponse {
            // typst Position::page is 1-based; convert to 0-based.
            page: p.page.get() - 1,
            x: p.point.x.to_pt(),
            y: p.point.y.to_pt(),
        })
        .collect())
}

// ─── Response type ────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct PreviewPositionResponse {
    /// 0-based page index.
    pub page: usize,
    /// Horizontal offset in typst points from the left edge of the page.
    pub x: f64,
    /// Vertical offset in typst points from the top edge of the page.
    pub y: f64,
}
