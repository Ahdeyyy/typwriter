// Workspace lifecycle + file operations. Every mutation returns the refreshed
// file tree (root node) so the frontend never patches the tree client-side.
//
// All commands here are `async` so they run on the async runtime instead of
// the main thread — a sync command doing disk IO (or worse, a blocking dialog)
// on the main thread can stall the whole UI on Android. Long-blocking bodies
// (pickers, SAF reads) additionally hop to `spawn_blocking`.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use log::info;
use tauri::{AppHandle, Manager, State};

use crate::{
    compiler::CompileState,
    workspace::{
        build_tree, detect_main_file, read_meta, resolve_in_root, workspaces_root, write_meta,
        FileNode, WorkspaceInfo, WorkspaceMeta, WorkspaceState,
    },
    world::MobileWorld,
};

const STARTER_MAIN: &str = "= Hello, Typst!\n";

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) fn root_dir(app: &AppHandle) -> PathBuf {
    let documents = app.path().document_dir().ok();
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    workspaces_root(documents, app_data)
}

fn current_root(workspace: &WorkspaceState) -> Result<PathBuf, String> {
    workspace
        .root
        .read()
        .clone()
        .ok_or_else(|| "No workspace open".to_string())
}

fn tree_of(workspace: &WorkspaceState) -> Result<FileNode, String> {
    Ok(build_tree(&current_root(workspace)?))
}

/// Reject names that are unsafe as a single path segment.
fn validate_workspace_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Workspace name cannot be empty".into());
    }
    if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Workspace name contains invalid characters".into());
    }
    Ok(())
}

/// The package store directory (if it lives under the workspaces root). Such
/// an entry is listed as a `system` workspace so the UI can present it as
/// app-managed rather than user-created.
fn system_dir(app: &AppHandle) -> Option<PathBuf> {
    crate::packages_dirs(app).1
}

#[tauri::command]
pub async fn list_workspaces(app: AppHandle) -> Result<Vec<WorkspaceMeta>, String> {
    let root = root_dir(&app);
    let system = system_dir(&app);
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let meta = read_meta(&path);
        out.push(WorkspaceMeta {
            name: name.to_string(),
            path: path.to_string_lossy().into_owned(),
            last_opened_ms: meta.last_opened_ms,
            system: system.as_deref() == Some(path.as_path()),
        });
    }
    out.sort_by(|a, b| b.last_opened_ms.cmp(&a.last_opened_ms).then(a.name.cmp(&b.name)));
    Ok(out)
}

#[tauri::command]
pub async fn create_workspace(name: String, app: AppHandle) -> Result<WorkspaceMeta, String> {
    validate_workspace_name(&name)?;
    let dir = root_dir(&app).join(&name);
    if dir.exists() {
        return Err(format!("A workspace named \"{name}\" already exists"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("main.typ"), STARTER_MAIN).map_err(|e| e.to_string())?;
    let mut meta = read_meta(&dir);
    meta.main_file = Some("main.typ".to_string());
    write_meta(&dir, &meta)?;
    info!("create_workspace: {name:?}");
    Ok(WorkspaceMeta {
        name,
        path: dir.to_string_lossy().into_owned(),
        last_opened_ms: None,
        system: false,
    })
}

#[tauri::command]
pub async fn delete_workspace(name: String, app: AppHandle) -> Result<(), String> {
    validate_workspace_name(&name)?;
    let dir = root_dir(&app).join(&name);
    if system_dir(&app).as_deref() == Some(dir.as_path()) {
        return Err("The package store is managed by the app and can't be deleted".into());
    }
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    info!("delete_workspace: {name:?}");
    Ok(())
}

#[tauri::command]
pub async fn open_workspace(
    name: String,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<WorkspaceInfo, String> {
    let t = Instant::now();
    let dir = root_dir(&app).join(&name);
    if !dir.is_dir() {
        return Err(format!("Workspace \"{name}\" not found"));
    }

    let mut meta = read_meta(&dir);
    let main_file = detect_main_file(&dir, meta.main_file.as_deref());

    *workspace.root.write() = Some(dir.clone());
    world.set_root(dir.clone());
    // Drop the previous workspace's compiled document so the preview (and PDF
    // export) can never serve the old workspace's pages after a switch.
    *compile.document.lock() = None;
    compile.page_lookup.lock().clear();
    if let Some(rel) = &main_file {
        world.set_main(world.rel_to_id(rel)?);
    }

    // Record last-opened and persist the resolved main file.
    meta.main_file = main_file.clone();
    meta.last_opened_ms = Some(now_ms());
    write_meta(&dir, &meta)?;

    let still_exists =
        |rel: &str| resolve_in_root(&dir, rel).map(|p| p.is_file()).unwrap_or(false);

    let last_file = meta.last_file.clone().filter(|rel| still_exists(rel));

    // Restore open tabs, dropping any whose file no longer exists.
    let open_tabs: Vec<String> = meta
        .open_tabs
        .iter()
        .filter(|rel| still_exists(rel))
        .cloned()
        .collect();
    let active_tab = meta
        .active_tab
        .clone()
        .filter(|rel| open_tabs.iter().any(|t| t == rel));

    info!(
        "open_workspace: {name:?} main={main_file:?} tabs={} ({:.1}ms)",
        open_tabs.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(WorkspaceInfo {
        name,
        root: dir.to_string_lossy().into_owned(),
        tree: build_tree(&dir),
        main_file,
        last_file,
        open_tabs,
        active_tab,
    })
}

#[tauri::command]
pub async fn get_file_tree(workspace: State<'_, Arc<WorkspaceState>>) -> Result<FileNode, String> {
    tree_of(&workspace)
}

#[tauri::command]
pub async fn set_main_file(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<(), String> {
    let root = current_root(&workspace)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    if !abs.is_file() {
        return Err(format!("Not a file: {rel_path}"));
    }
    world.set_main(world.rel_to_id(&rel_path)?);
    let mut meta = read_meta(&root);
    meta.main_file = Some(rel_path.clone());
    write_meta(&root, &meta)?;
    info!("set_main_file: {rel_path:?}");
    Ok(())
}

#[tauri::command]
pub async fn set_last_file(
    rel_path: Option<String>,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let root = current_root(&workspace)?;
    let mut meta = read_meta(&root);
    meta.last_file = rel_path;
    write_meta(&root, &meta)
}

/// Open the platform folder picker and persist the chosen folder as the
/// app-wide fonts source. Returns the folder's display name, or `None` if the
/// user cancelled. On Android this uses the SAF directory picker so the fonts
/// stay reachable after a restart. The fonts are (re)loaded immediately on a
/// background thread — no app restart needed.
#[tauri::command]
pub async fn pick_fonts_dir(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<Option<String>, String> {
    let world = world.inner().clone();
    let handle = app.clone();
    // The picker blocks until the user responds — keep it off the runtime.
    let picked = tauri::async_runtime::spawn_blocking(move || crate::fonts::pick(&handle))
        .await
        .map_err(|e| format!("picker task panicked: {e}"))??;
    if picked.is_some() {
        crate::fonts::load_in_background(app, world);
    }
    Ok(picked)
}

/// Clear the app-wide fonts source (and release any SAF permission), then
/// reload the font set (back to embedded + the conventional folder).
#[tauri::command]
pub async fn clear_fonts_dir(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<(), String> {
    crate::fonts::clear_source(&app)?;
    crate::fonts::load_in_background(app, world.inner().clone());
    Ok(())
}

/// Display name of the persisted fonts source, or `None` when unset. The
/// settings UI reads this so the shown folder always matches what the backend
/// actually loads.
#[tauri::command]
pub async fn get_fonts_dir(app: AppHandle) -> Result<Option<String>, String> {
    Ok(crate::fonts::source_display_name(&app))
}

#[tauri::command]
pub async fn set_open_tabs(
    open_tabs: Vec<String>,
    active_tab: Option<String>,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let root = current_root(&workspace)?;
    let mut meta = read_meta(&root);
    meta.open_tabs = open_tabs;
    meta.active_tab = active_tab;
    write_meta(&root, &meta)
}

#[tauri::command]
pub async fn create_file(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<FileNode, String> {
    let root = current_root(&workspace)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    if abs.exists() {
        return Err(format!("Already exists: {rel_path}"));
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs, b"").map_err(|e| e.to_string())?;
    info!("create_file: {rel_path:?}");
    tree_of(&workspace)
}

#[tauri::command]
pub async fn create_folder(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<FileNode, String> {
    let root = current_root(&workspace)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    if abs.exists() {
        return Err(format!("Already exists: {rel_path}"));
    }
    std::fs::create_dir_all(&abs).map_err(|e| e.to_string())?;
    info!("create_folder: {rel_path:?}");
    tree_of(&workspace)
}

#[tauri::command]
pub async fn rename_entry(
    rel_path: String,
    new_name: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<FileNode, String> {
    if new_name.contains(['/', '\\']) {
        return Err("Name cannot contain path separators".into());
    }
    let root = current_root(&workspace)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    let parent = abs
        .parent()
        .ok_or_else(|| "Cannot rename the workspace root".to_string())?;
    let dest = parent.join(&new_name);
    if dest.exists() {
        return Err(format!("Already exists: {new_name}"));
    }
    std::fs::rename(&abs, &dest).map_err(|e| e.to_string())?;
    info!("rename_entry: {rel_path:?} -> {new_name:?}");
    tree_of(&workspace)
}

#[tauri::command]
pub async fn move_entry(
    rel_path: String,
    new_parent_rel: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<FileNode, String> {
    let root = current_root(&workspace)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    // Empty new_parent_rel means the workspace root.
    let new_parent = if new_parent_rel.is_empty() {
        root.clone()
    } else {
        resolve_in_root(&root, &new_parent_rel)?
    };
    if !new_parent.is_dir() {
        return Err(format!("Not a folder: {new_parent_rel}"));
    }
    let file_name = abs
        .file_name()
        .ok_or_else(|| "Invalid source path".to_string())?;
    let dest = new_parent.join(file_name);
    if dest.exists() {
        return Err("Target already exists in destination folder".into());
    }
    // Guard against moving a directory into itself / its descendant.
    if abs.is_dir() && dest.starts_with(&abs) {
        return Err("Cannot move a folder into itself".into());
    }
    std::fs::rename(&abs, &dest).map_err(|e| e.to_string())?;
    info!("move_entry: {rel_path:?} -> {new_parent_rel:?}");
    tree_of(&workspace)
}

#[tauri::command]
pub async fn delete_entry(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<FileNode, String> {
    let root = current_root(&workspace)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    delete_path(&abs)?;
    info!("delete_entry: {rel_path:?}");
    tree_of(&workspace)
}

fn delete_path(abs: &Path) -> Result<(), String> {
    if abs.is_dir() {
        std::fs::remove_dir_all(abs).map_err(|e| e.to_string())
    } else if abs.exists() {
        std::fs::remove_file(abs).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}
