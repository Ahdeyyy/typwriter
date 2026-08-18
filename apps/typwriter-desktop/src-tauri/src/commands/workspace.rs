use std::{collections::HashMap, fs, path::PathBuf, sync::Arc, time::Instant};

use log::{error, info};
use serde::Deserialize;
use tauri::State;

use crate::workspace::{DroppedFile, FileTreeEntry, RecentWorkspaceEntry, WorkspaceState};

#[tauri::command(async)]
pub fn open_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<Option<String>, String> {
    let t = Instant::now();
    info!("open_folder: path={path:?}");
    let result = workspace.open_folder(PathBuf::from(&path));
    match &result {
        Ok(main) => info!(
            "open_folder: ok restored_main={main:?} ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "open_folder: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn set_main_file(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("set_main_file: path={path:?}");
    if PathBuf::from(&path).is_absolute() {
        return Err("set_main_file expects a workspace-relative path".into());
    }
    let result = workspace.set_main_file(PathBuf::from(&path));
    match &result {
        Ok(_) => info!(
            "set_main_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "set_main_file: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn get_file_tree(
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<Vec<FileTreeEntry>, String> {
    let t = Instant::now();
    info!("get_file_tree: called");
    let result = workspace.get_file_tree();
    match &result {
        Ok(entries) => info!(
            "get_file_tree: ok — {} entries ({:.1}ms)",
            entries.len(),
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "get_file_tree: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn create_file(path: String, workspace: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let t = Instant::now();
    info!("create_file: path={path:?}");
    let result = workspace.create_file(&path);
    match &result {
        Ok(_) => info!(
            "create_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "create_file: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn create_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("create_folder: path={path:?}");
    let result = workspace.create_folder(&path);
    match &result {
        Ok(_) => info!(
            "create_folder: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "create_folder: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn delete_file(path: String, workspace: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let t = Instant::now();
    info!("delete_file: path={path:?}");
    let result = workspace.delete_file(&path);
    match &result {
        Ok(_) => info!(
            "delete_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "delete_file: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

/// Delete a directory.  The frontend is responsible for showing a confirmation
/// dialog before calling this command.
#[tauri::command(async)]
pub fn delete_folder(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("delete_folder: path={path:?}");
    let result = workspace.delete_folder(&path);
    match &result {
        Ok(_) => info!(
            "delete_folder: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "delete_folder: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn rename_file(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("rename_file: src={src:?} dst={dst:?}");
    let result = workspace.rename_file(&src, &dst);
    match &result {
        Ok(_) => info!(
            "rename_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "rename_file: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn move_file(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("move_file: src={src:?} dst={dst:?}");
    let result = workspace.move_file(&src, &dst);
    match &result {
        Ok(_) => info!(
            "move_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "move_file: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn move_folder(
    src: String,
    dst: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("move_folder: src={src:?} dst={dst:?}");
    let result = workspace.move_folder(&src, &dst);
    match &result {
        Ok(_) => info!(
            "move_folder: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "move_folder: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn import_files(
    sources: Vec<String>,
    dest_dir: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!(
        "import_files: dest_dir={dest_dir:?} count={}",
        sources.len()
    );
    let result = workspace.import_files(&sources, &dest_dir);
    match &result {
        Ok(_) => info!(
            "import_files: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "import_files: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

/// Header framed in front of an [`import_dropped`] payload.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DroppedBatchHeader {
    /// Workspace-relative destination directory; `""` is the workspace root.
    dest_dir: String,
    files: Vec<DroppedFile>,
}

/// Import files (and folders) dropped onto the window from outside the app.
///
/// The webview only ever hands the frontend file *contents* for an external
/// drag-and-drop — there is no path to copy from — so the whole drop arrives as
/// a single raw IPC body framed as:
///
/// ```text
/// [u32 LE header length][UTF-8 JSON header][file bytes, concatenated]
/// ```
///
/// Raw framing keeps the bytes out of JSON (where they'd be a number array),
/// and batching the whole drop into one call means one restore point and one
/// pass at resolving name collisions across everything dropped.
///
/// Returns the workspace-relative path of every file written.
#[tauri::command(async)]
pub fn import_dropped(
    request: tauri::ipc::Request<'_>,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<Vec<String>, String> {
    let t = Instant::now();
    let tauri::ipc::InvokeBody::Raw(payload) = request.body() else {
        let e = "import_dropped expects a raw request body".to_string();
        error!("import_dropped: err=\"{e}\"");
        return Err(e);
    };

    let header_end = payload
        .get(..4)
        .map(|len| u32::from_le_bytes([len[0], len[1], len[2], len[3]]) as usize)
        .and_then(|header_len| 4usize.checked_add(header_len))
        .filter(|end| *end <= payload.len())
        .ok_or_else(|| {
            let e = "Malformed drop payload: truncated header".to_string();
            error!("import_dropped: err=\"{e}\"");
            e
        })?;

    let header: DroppedBatchHeader =
        serde_json::from_slice(&payload[4..header_end]).map_err(|e| {
            let e = format!("Malformed drop header: {e}");
            error!("import_dropped: err=\"{e}\"");
            e
        })?;

    info!(
        "import_dropped: dest_dir={:?} count={}",
        header.dest_dir,
        header.files.len()
    );
    let result = workspace.import_dropped(&header.dest_dir, &header.files, &payload[header_end..]);
    match &result {
        Ok(written) => info!(
            "import_dropped: ok — {} file(s) ({:.1}ms)",
            written.len(),
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "import_dropped: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command(async)]
pub fn get_recent_workspaces(
    workspace: State<'_, Arc<WorkspaceState>>,
    include_thumbnails: Option<bool>,
) -> Vec<RecentWorkspaceEntry> {
    let include_thumbnails = include_thumbnails.unwrap_or(true);
    info!("get_recent_workspaces: called include_thumbnails={include_thumbnails}");
    let result = workspace.get_recent_workspaces(include_thumbnails);
    info!("get_recent_workspaces: returning {} entries", result.len());
    result
}

#[tauri::command(async)]
pub fn remove_recent_workspace(path: String, workspace: State<'_, Arc<WorkspaceState>>) {
    info!("remove_recent_workspace: path={path:?}");
    workspace.remove_recent_workspace(&path);
}

#[tauri::command(async)]
pub fn clear_recent_workspaces(workspace: State<'_, Arc<WorkspaceState>>) {
    info!("clear_recent_workspaces: called");
    workspace.clear_recent_workspaces();
}

#[tauri::command(async)]
pub fn save_workspace_tabs(
    tabs: Vec<String>,
    active_tab_id: Option<String>,
    unsaved: HashMap<String, String>,
    cursor: Option<usize>,
    workspace: State<'_, Arc<WorkspaceState>>,
) {
    workspace.save_workspace_tabs(tabs, active_tab_id, unsaved, cursor);
}

#[tauri::command(async)]
pub fn get_workspace_tabs(
    root: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Option<(
    Vec<String>,
    Option<String>,
    HashMap<String, String>,
    Option<usize>,
)> {
    workspace.get_workspace_tabs(&root)
}

/// Create a new workspace folder at `parent_path/name`, initialise a
/// `.typwriter/` metadata directory inside it, and return the absolute path to
/// the new workspace root.
#[tauri::command(async)]
pub fn create_workspace(parent_path: String, name: String) -> Result<String, String> {
    let t = Instant::now();
    info!("create_workspace: parent={parent_path:?} name={name:?}");

    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Workspace name must not be empty".into());
    }

    let workspace_path = PathBuf::from(&parent_path).join(&name);
    let meta_path = workspace_path.join(".typwriter");

    fs::create_dir_all(&workspace_path)
        .map_err(|e| format!("Failed to create workspace folder: {e}"))?;
    fs::create_dir_all(&meta_path)
        .map_err(|e| format!("Failed to create .typwriter folder: {e}"))?;

    let now = chrono::Utc::now().to_rfc3339();
    let meta_json = serde_json::json!({
        "name": name,
        "created_at": now,
        "version": "1"
    });
    let meta_file = meta_path.join("workspace.json");
    fs::write(&meta_file, meta_json.to_string())
        .map_err(|e| format!("Failed to write workspace.json: {e}"))?;

    let path_str = workspace_path.to_string_lossy().into_owned();
    info!(
        "create_workspace: ok path={path_str:?} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(path_str)
}

// ─── Project snippets ────────────────────────────────────────────────────────
//
// The per-project snippet set, stored in the workspace at
// `.typwriter/snippets.json`. Its app-wide sibling lives in the settings store
// (`get_user_snippets` / `set_user_snippets`); this pair is the project scope.
//
// Both are read and written as raw JSON text: the schema, and the deliberately
// forgiving parser that reports one bad entry without losing the rest, live in
// the frontend's `$lib/snippets.ts`.

#[tauri::command(async)]
pub fn get_project_snippets(workspace: State<'_, Arc<WorkspaceState>>) -> Option<String> {
    let contents = workspace.project_snippets();
    info!(
        "get_project_snippets: {}",
        match &contents {
            Some(text) => format!("{} bytes", text.len()),
            None => "none".to_string(),
        }
    );
    contents
}

#[tauri::command(async)]
pub fn set_project_snippets(
    contents: String,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("set_project_snippets: bytes={}", contents.len());
    let result = workspace.set_project_snippets(&contents);
    match &result {
        Ok(_) => info!(
            "set_project_snippets: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "set_project_snippets: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}
