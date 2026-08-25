// Tauri commands for the version-history pane: create restore points, list
// history, diff commits, and restore the workspace or a single file.

use std::{sync::Arc, time::Instant};

use log::{error, info};
use tauri::State;

use crate::compiler::{PageDiffEngine, PageDiffSide};
use crate::vcs::{RestorePoint, VcsState, WorkspaceDiff};

#[tauri::command(async)]
pub fn vcs_create_restore_point(
    message: String,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<Option<String>, String> {
    let t = Instant::now();
    info!("vcs_create_restore_point: msg={message:?}");
    let result = vcs.create_manual_restore_point(&message);
    match &result {
        Ok(id) => info!(
            "vcs_create_restore_point: ok id={id:?} ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!("vcs_create_restore_point: err=\"{e}\""),
    }
    result
}

#[tauri::command(async)]
pub fn vcs_current_id(vcs: State<'_, Arc<VcsState>>) -> Result<Option<String>, String> {
    vcs.current_id()
}

#[tauri::command(async)]
pub fn vcs_list_history(
    limit: Option<usize>,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<Vec<RestorePoint>, String> {
    let t = Instant::now();
    let result = vcs.list_history(limit);
    match &result {
        Ok(v) => info!(
            "vcs_list_history: ok — {} entries ({:.1}ms)",
            v.len(),
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!("vcs_list_history: err=\"{e}\""),
    }
    result
}

#[tauri::command(async)]
pub fn vcs_diff_vs_current(
    commit_id: String,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<WorkspaceDiff, String> {
    let t = Instant::now();
    let result = vcs.diff_vs_current(&commit_id);
    match &result {
        Ok(d) => info!(
            "vcs_diff_vs_current: ok — {} file(s) ({:.1}ms)",
            d.files.len(),
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!("vcs_diff_vs_current: err=\"{e}\""),
    }
    result
}

#[tauri::command(async)]
pub fn vcs_diff_between(
    from_id: String,
    to_id: String,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<WorkspaceDiff, String> {
    let t = Instant::now();
    let result = vcs.diff_between(&from_id, &to_id);
    match &result {
        Ok(d) => info!(
            "vcs_diff_between: ok — {} file(s) ({:.1}ms)",
            d.files.len(),
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!("vcs_diff_between: err=\"{e}\""),
    }
    result
}

#[tauri::command(async)]
pub fn vcs_restore_workspace(
    commit_id: String,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("vcs_restore_workspace: id={commit_id:?}");
    let result = vcs.restore_workspace(&commit_id);
    match &result {
        Ok(_) => info!(
            "vcs_restore_workspace: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!("vcs_restore_workspace: err=\"{e}\""),
    }
    result
}

#[tauri::command(async)]
pub fn vcs_restore_file(
    commit_id: String,
    path: String,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("vcs_restore_file: id={commit_id:?} path={path:?}");
    let result = vcs.restore_file(&commit_id, &path);
    match &result {
        Ok(_) => info!(
            "vcs_restore_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!("vcs_restore_file: err=\"{e}\""),
    }
    result
}

// ─── Page-level diff ────────────────────────────────────────────────────────
//
// Unlike the file diffs above, this one has to *compile* the restore point
// before it can say anything, so it can't be a request/response command: a
// long document would block the caller for seconds and there would be no way
// to call it off when the user clicks a different point. The command enqueues
// and returns the request id immediately; the result arrives on `vcs:page-diff`
// (or `vcs:page-diff-error`) tagged with that id.

/// Queue a page-level comparison. `to_id` of `None` compares the restore point
/// against the document the preview is currently showing.
#[tauri::command(async)]
pub fn vcs_page_diff_request(
    from_id: String,
    to_id: Option<String>,
    engine: State<'_, Arc<PageDiffEngine>>,
) -> u64 {
    let request_id = engine.request(from_id, to_id);
    info!("vcs_page_diff_request: queued request={request_id}");
    request_id
}

/// Abandon the comparison: stop the worker at its next phase boundary and
/// drop the laid-out documents it was holding for full-size renders. Called
/// when the frontend stops looking at a comparison, not merely when it wants
/// a different one — a superseding `vcs_page_diff_request` handles that on
/// its own and must keep the documents alive.
#[tauri::command(async)]
pub fn vcs_page_diff_cancel(engine: State<'_, Arc<PageDiffEngine>>) {
    engine.release();
    info!("vcs_page_diff_cancel: released");
}

/// Rasterize one page of the last comparison at `scale` (px per typst point,
/// clamped server-side) and return its `previewimg://` path component.
///
/// The contact sheet is 72 dpi — readable as a shape, not as text — so opening
/// a page full size needs a genuinely sharper render. It is cheap because the
/// engine still holds both laid-out documents: one rasterization, no compile.
/// Fails once those documents have been released, which is the frontend's cue
/// to recompute the comparison.
#[tauri::command(async)]
pub fn vcs_page_diff_render_page(
    side: PageDiffSide,
    page_index: usize,
    scale: f32,
    engine: State<'_, Arc<PageDiffEngine>>,
) -> Result<String, String> {
    let t = Instant::now();
    let result = engine.render_page_at(side, page_index, scale);
    match &result {
        Ok(key) => info!(
            "vcs_page_diff_render_page: ok side={side:?} page={page_index} key={key} ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!("vcs_page_diff_render_page: err=\"{e}\""),
    }
    result
}
