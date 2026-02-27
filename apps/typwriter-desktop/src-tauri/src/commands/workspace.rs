use std::{path::PathBuf, sync::Arc};

use tauri::State;

use crate::workspace::{FileTreeEntry, WorkspaceState};

#[tauri::command]
pub fn open_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.open_folder(PathBuf::from(path))
}

#[tauri::command]
pub fn set_main_file(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.set_main_file(PathBuf::from(path))
}

#[tauri::command]
pub fn get_file_tree(
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<Vec<FileTreeEntry>, String> {
    workspace.get_file_tree()
}

#[tauri::command]
pub fn create_file(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.create_file(&path)
}

#[tauri::command]
pub fn create_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.create_folder(&path)
}

#[tauri::command]
pub fn delete_file(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.delete_file(&path)
}

/// Delete a directory.  The frontend is responsible for showing a confirmation
/// dialog before calling this command.
#[tauri::command]
pub fn delete_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.delete_folder(&path)
}

#[tauri::command]
pub fn rename_file(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.rename_file(&src, &dst)
}

#[tauri::command]
pub fn move_file(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.move_file(&src, &dst)
}

#[tauri::command]
pub fn move_folder(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    workspace.move_folder(&src, &dst)
}
