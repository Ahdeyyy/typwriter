use std::path::PathBuf;

use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::{app_state::AppState, compiler::TypstCompiler, manager::ProjectManager};

/// Opens a workspace at the given path
/// initializes the s,tate of the compiler and the files contained in it
///
#[tauri::command(rename_all = "snake_case")]
pub async fn open_workspace(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), ()> {
    let resource_path = app
        .path()
        .resolve("fonts/", BaseDirectory::Resource)
        .unwrap_or_default();

    let root = PathBuf::from(path);
    let mut project_manager = state.project.write().await;
    let mut compiler = state.compiler.write().await;
    *project_manager = ProjectManager::new(root.clone());
    *compiler = TypstCompiler::new(root, resource_path);
    Ok(())
}

/// Opens a file in the currently active workspace
/// sets the active file in the project manager
#[tauri::command(rename_all = "snake_case")]
pub async fn open_file(state: tauri::State<'_, AppState>, file_path: String) -> Result<(), ()> {
    let mut project_manager = state.project.write().await;

    project_manager.set_active_file(PathBuf::from(file_path));

    Ok(())
}
