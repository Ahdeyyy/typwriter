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
    layout::{Abs, PagedDocument, Point},
    World,
};

use crate::{
    commands::editor::{serialize_jump, JumpResponse},
    compiler::PreviewPipeline,
    world::EditorWorld,
};

const MAX_CURSOR_SHIFT_BYTES: usize = 128;

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
        error!(
            "jump_from_click: err=\"{e}\" ({:.1}ms) page={page}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    if page >= doc.pages.len() {
        let e = format!(
            "page index {page} out of bounds (doc has {} pages)",
            doc.pages.len()
        );
        error!(
            "jump_from_click: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Err(e);
    }

    let frame = &doc.pages[page].frame;
    let jump = typst_ide::jump_from_click(&**world, doc, frame, point);
    let found = jump.is_some();
    debug!(
        "jump_from_click: ok found={found} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(jump.map(|j| serialize_jump(&j, &**world)))
}

// ─── Editor → Preview ─────────────────────────────────────────────────────────

/// Convert the editor cursor (byte offset inside a source file) to preview
/// position. When the engine returns multiple candidates, probe nearby byte
/// offsets on both sides of the cursor to disambiguate which preview position
/// best matches the current caret location.
///
/// `path`   — absolute or workspace-relative path to the source file
/// `cursor` — byte offset of the cursor within the source text
#[tauri::command]
pub fn jump_from_cursor(
    path: String,
    cursor: usize,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<Option<PreviewPositionResponse>, String> {
    let t = Instant::now();
    debug!("jump_from_cursor: path={path:?} cursor={cursor}");

    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or_else(|| {
        let e = "Could not resolve file path to a FileId";
        error!(
            "jump_from_cursor: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!(
            "jump_from_cursor: source error path={path:?} err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let guard = pipeline.last_document.lock();
    let doc = guard.as_deref().ok_or_else(|| {
        let e = "No compiled document available";
        error!(
            "jump_from_cursor: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let text = source.text();
    let positions = typst_ide::jump_from_cursor(doc, &source, cursor);
    let count = positions.len();
    let resolved = resolve_preview_position(doc, &source, text, cursor, positions);
    info!(
        "jump_from_cursor: ok — {count} position(s), resolved={} ({:.1}ms)",
        resolved.is_some(),
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(resolved.map(preview_position_response))
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

fn resolve_preview_position(
    doc: &PagedDocument,
    source: &typst::syntax::Source,
    text: &str,
    cursor: usize,
    positions: Vec<typst::layout::Position>,
) -> Option<typst::layout::Position> {
    match positions.len() {
        0 => None,
        1 => positions.into_iter().next(),
        2 => positions.into_iter().last(),
        _ => {
            let left_probe =
                find_unique_probe_position(doc, source, text, cursor, ProbeDirection::Left);
            let right_probe =
                find_unique_probe_position(doc, source, text, cursor, ProbeDirection::Right);

            let mut best_index = 0usize;
            let mut best_score = f64::INFINITY;

            for (index, candidate) in positions.iter().enumerate() {
                let mut score = 0.0;
                let mut anchors = 0usize;

                if let Some(left) = left_probe.as_ref() {
                    score += preview_position_distance(candidate, left);
                    anchors += 1;
                }

                if let Some(right) = right_probe.as_ref() {
                    score += preview_position_distance(candidate, right);
                    anchors += 1;
                }

                if anchors == 0 {
                    score = index as f64;
                }

                if score < best_score {
                    best_score = score;
                    best_index = index;
                }
            }

            positions.into_iter().nth(best_index)
        }
    }
}

fn find_unique_probe_position(
    doc: &PagedDocument,
    source: &typst::syntax::Source,
    text: &str,
    cursor: usize,
    direction: ProbeDirection,
) -> Option<typst::layout::Position> {
    let mut probe = clamp_to_char_boundary(text, cursor.min(text.len()));
    let mut shifted = 0usize;

    while shifted < MAX_CURSOR_SHIFT_BYTES {
        let next = match direction {
            ProbeDirection::Left => previous_char_boundary(text, probe)?,
            ProbeDirection::Right => next_char_boundary(text, probe)?,
        };

        shifted += probe.abs_diff(next);
        if shifted > MAX_CURSOR_SHIFT_BYTES {
            break;
        }

        probe = next;
        let mut positions = typst_ide::jump_from_cursor(doc, source, probe).into_iter();
        let first = positions.next()?;

        if positions.next().is_none() {
            return Some(first);
        }
    }

    None
}

fn previous_char_boundary(text: &str, index: usize) -> Option<usize> {
    let index = clamp_to_char_boundary(text, index);
    if index == 0 {
        return None;
    }

    text[..index]
        .char_indices()
        .next_back()
        .map(|(offset, _)| offset)
}

fn next_char_boundary(text: &str, index: usize) -> Option<usize> {
    let index = clamp_to_char_boundary(text, index);
    if index >= text.len() {
        return None;
    }

    let mut iter = text[index..].char_indices();
    let (_, ch) = iter.next()?;
    Some(index + ch.len_utf8())
}

fn clamp_to_char_boundary(text: &str, index: usize) -> usize {
    let mut clamped = index.min(text.len());
    while clamped > 0 && !text.is_char_boundary(clamped) {
        clamped -= 1;
    }
    clamped
}

fn preview_position_distance(a: &typst::layout::Position, b: &typst::layout::Position) -> f64 {
    let page_delta = a.page.get().abs_diff(b.page.get()) as f64;
    let dx = (a.point.x - b.point.x).to_pt();
    let dy = (a.point.y - b.point.y).to_pt();

    page_delta * 10_000.0 + dx * dx + dy * dy
}

fn preview_position_response(position: typst::layout::Position) -> PreviewPositionResponse {
    PreviewPositionResponse {
        page: position.page.get() - 1,
        x: position.point.x.to_pt(),
        y: position.point.y.to_pt(),
    }
}

#[derive(Clone, Copy)]
enum ProbeDirection {
    Left,
    Right,
}
