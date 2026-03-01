use std::{path::PathBuf, sync::Arc, time::Instant};

use log::{error, info};
use tauri::State;

use crate::workspace::{FileTreeEntry, RecentWorkspaceEntry, WorkspaceState};

#[tauri::command]
pub fn open_folder(path: String, workspace: State<'_, Arc<WorkspaceState>>) -> Result<Option<String>, String> {
    let t = Instant::now();
    info!("open_folder: path={path:?}");
    let result = workspace.open_folder(PathBuf::from(&path));
    match &result {
        Ok(main) => info!("open_folder: ok restored_main={main:?} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e)   => error!("open_folder: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn set_main_file(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("set_main_file: path={path:?}");
    let result = workspace.set_main_file(PathBuf::from(&path));
    match &result {
        Ok(_)  => info!("set_main_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("set_main_file: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn get_file_tree(
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<Vec<FileTreeEntry>, String> {
    let t = Instant::now();
    info!("get_file_tree: called");
    let result = workspace.get_file_tree();
    match &result {
        Ok(entries) => info!("get_file_tree: ok — {} entries ({:.1}ms)", entries.len(), t.elapsed().as_secs_f64() * 1000.0),
        Err(e)      => error!("get_file_tree: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn create_file(path: String, workspace: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let t = Instant::now();
    info!("create_file: path={path:?}");
    let result = workspace.create_file(&path);
    match &result {
        Ok(_)  => info!("create_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("create_file: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn create_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("create_folder: path={path:?}");
    let result = workspace.create_folder(&path);
    match &result {
        Ok(_)  => info!("create_folder: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("create_folder: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn delete_file(path: String, workspace: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let t = Instant::now();
    info!("delete_file: path={path:?}");
    let result = workspace.delete_file(&path);
    match &result {
        Ok(_)  => info!("delete_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("delete_file: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

/// Delete a directory.  The frontend is responsible for showing a confirmation
/// dialog before calling this command.
#[tauri::command]
pub fn delete_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("delete_folder: path={path:?}");
    let result = workspace.delete_folder(&path);
    match &result {
        Ok(_)  => info!("delete_folder: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("delete_folder: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn rename_file(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("rename_file: src={src:?} dst={dst:?}");
    let result = workspace.rename_file(&src, &dst);
    match &result {
        Ok(_)  => info!("rename_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("rename_file: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn move_file(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("move_file: src={src:?} dst={dst:?}");
    let result = workspace.move_file(&src, &dst);
    match &result {
        Ok(_)  => info!("move_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("move_file: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn move_folder(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("move_folder: src={src:?} dst={dst:?}");
    let result = workspace.move_folder(&src, &dst);
    match &result {
        Ok(_)  => info!("move_folder: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("move_folder: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn import_files(
    sources: Vec<String>,
    dest_dir: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("import_files: dest_dir={dest_dir:?} count={}", sources.len());
    let result = workspace.import_files(&sources, &dest_dir);
    match &result {
        Ok(_)  => info!("import_files: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
        Err(e) => error!("import_files: err=\"{e}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0),
    }
    result
}

#[tauri::command]
pub fn get_recent_workspaces(
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Vec<RecentWorkspaceEntry> {
    info!("get_recent_workspaces: called");
    let result = workspace.get_recent_workspaces_with_thumbnails();
    info!("get_recent_workspaces: returning {} entries", result.len());
    result
}
