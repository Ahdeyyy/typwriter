// commands/preview.rs
//
// Tauri commands for controlling the live preview:
//   - trigger_preview  (force a full recompile + page stream)
//   - set_zoom / get_zoom

use std::sync::Arc;

use log::{error, info};
use tauri::State;

use crate::{compiler::PreviewPipeline, workspace::WorkspaceState};

#[tauri::command]
pub fn trigger_preview(pipeline: State<'_, Arc<PreviewPipeline>>) -> Result<(), String> {
    info!("trigger_preview: called");
    pipeline.trigger_compile_and_emit();
    Ok(())
}

#[tauri::command]
pub fn set_zoom(scale: f32, workspace: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    info!("set_zoom: scale={scale}");
    if scale <= 0.0 || scale > 16.0 {
        let e = format!("zoom must be in (0, 16], got {scale}");
        error!("set_zoom: err=\"{e}\"");
        return Err(e);
    }
    workspace.set_zoom(scale);
    info!("set_zoom: ok scale={scale}");
    Ok(())
}

#[tauri::command]
pub fn get_zoom(workspace: State<'_, Arc<WorkspaceState>>) -> f32 {
    let zoom = workspace.get_zoom();
    info!("get_zoom: returning {zoom}");
    zoom
}
