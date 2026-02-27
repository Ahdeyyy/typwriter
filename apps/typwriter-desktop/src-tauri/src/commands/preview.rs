// commands/preview.rs
//
// Tauri commands for controlling the live preview:
//   - trigger_preview  (force a full recompile + page stream)
//   - set_zoom / get_zoom

use std::sync::Arc;

use tauri::State;

use crate::{compiler::PreviewPipeline, workspace::WorkspaceState};

#[tauri::command]
pub fn trigger_preview(pipeline: State<'_, Arc<PreviewPipeline>>) -> Result<(), String> {
    pipeline.trigger_compile_and_emit();
    Ok(())
}

#[tauri::command]
pub fn set_zoom(scale: f32, workspace: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    if scale <= 0.0 || scale > 16.0 {
        return Err(format!("zoom must be in (0, 16], got {scale}"));
    }
    workspace.set_zoom(scale);
    Ok(())
}

#[tauri::command]
pub fn get_zoom(workspace: State<'_, Arc<WorkspaceState>>) -> f32 {
    workspace.get_zoom()
}
