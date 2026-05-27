// commands/vcs.rs
//
// Tauri commands for the version-history pane:
//   - vcs_create_restore_point  (manual "save a named restore point" button)
//   - vcs_list_history          (timeline data)
//   - vcs_diff_vs_current       (selected commit vs working tree)
//   - vcs_diff_between          (two commits)
//   - vcs_restore_workspace     (full restore)
//   - vcs_restore_file          (single-file restore)

use std::{sync::Arc, time::Instant};

use log::{error, info};
use tauri::State;

use crate::vcs::{RestorePoint, VcsState, WorkspaceDiff};

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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
