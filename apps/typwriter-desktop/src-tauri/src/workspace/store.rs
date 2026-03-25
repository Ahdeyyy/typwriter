// workspace/store.rs
//
// Persistence helpers using tauri-plugin-store.
//
// Stored in a single JSON file ("app_data.json") located in the Tauri app
// data directory.  Two keys are used:
//
//   "recent_workspaces"    – JSON array of path strings (max 10, newest first)
//   "workspace_main_files" – JSON object  { "<root_path>": "<main_file_path>" }
//
// Thumbnail PNGs are written directly to `<workspace_root>/.typwriter/thumbnail.png`.

use std::path::Path;
use std::time::Instant;

use log::{info, warn};
use serde_json::{json, Value as JsonValue};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "app_data.json";
const MAX_RECENT: usize = 10;

// ─── Recent workspaces ────────────────────────────────────────────────────────

/// Add `root` to the front of the recent-workspaces list, deduplicating
/// and capping at [`MAX_RECENT`] entries.
pub fn add_recent_workspace(handle: &AppHandle, root: &Path) {
    let t = Instant::now();
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("store: could not open {STORE_FILE}");
        return;
    };

    let path_str = root.to_string_lossy().to_string();

    let mut list: Vec<String> = store
        .get("recent_workspaces")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    // Remove duplicates of this path.
    list.retain(|p| p != &path_str);

    // Prepend.
    list.insert(0, path_str.clone());

    // Cap at MAX_RECENT.
    list.truncate(MAX_RECENT);

    store.set("recent_workspaces", json!(list));
    let _ = store.save();
    info!(
        "store: added recent workspace ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
}

/// Remove a single workspace path from the recent list.
pub fn remove_recent_workspace(handle: &AppHandle, path: &str) {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("store: could not open {STORE_FILE}");
        return;
    };

    let mut list: Vec<String> = store
        .get("recent_workspaces")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    list.retain(|p| p != path);

    store.set("recent_workspaces", json!(list));
    let _ = store.save();
    info!("store: removed recent workspace {path:?}");
}

/// Clear the entire recent workspaces list.
pub fn clear_recent_workspaces(handle: &AppHandle) {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("store: could not open {STORE_FILE}");
        return;
    };

    store.set("recent_workspaces", json!(Vec::<String>::new()));
    let _ = store.save();
    info!("store: cleared recent workspaces");
}

/// Return the recent workspaces list (newest first).
pub fn get_recent_workspaces(handle: &AppHandle) -> Vec<String> {
    let Ok(store) = handle.store(STORE_FILE) else {
        return vec![];
    };

    store
        .get("recent_workspaces")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

// ─── Per-workspace main file ──────────────────────────────────────────────────

/// Persist which `.typ` file is the main file for the workspace at `root`.
pub fn set_workspace_main_file(handle: &AppHandle, root: &Path, main_file: &Path) {
    let t = Instant::now();
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("store: could not open {STORE_FILE}");
        return;
    };

    let root_key = root.to_string_lossy().to_string();
    let main_val = main_file.to_string_lossy().to_string();

    let mut map: serde_json::Map<String, JsonValue> = store
        .get("workspace_main_files")
        .and_then(|v| {
            if let JsonValue::Object(m) = v {
                Some(m)
            } else {
                None
            }
        })
        .unwrap_or_default();

    map.insert(root_key, json!(main_val));

    store.set("workspace_main_files", JsonValue::Object(map));
    let _ = store.save();
    info!(
        "store: set workspace main file ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
}

/// Look up the persisted main file for the workspace rooted at `root`.
pub fn get_workspace_main_file(handle: &AppHandle, root: &Path) -> Option<String> {
    let store = handle.store(STORE_FILE).ok()?;

    let root_key = root.to_string_lossy().to_string();

    let map: serde_json::Map<String, JsonValue> =
        store.get("workspace_main_files").and_then(|v| {
            if let JsonValue::Object(m) = v {
                Some(m)
            } else {
                None
            }
        })?;

    map.get(&root_key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// ─── .typwriter folder & thumbnail ───────────────────────────────────────────

const TYPWRITER_DIR: &str = ".typwriter";
const THUMBNAIL_FILE: &str = "thumbnail.png";

/// Ensure the `.typwriter` metadata directory exists inside `root`.
pub fn ensure_typwriter_dir(root: &Path) -> Result<(), String> {
    let dir = root.join(TYPWRITER_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create .typwriter dir: {e}"))
}

/// Write a thumbnail PNG to `<root>/.typwriter/thumbnail.png`.
pub fn save_thumbnail(root: &Path, png_bytes: &[u8]) -> Result<(), String> {
    let t = Instant::now();
    let dir = root.join(TYPWRITER_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(THUMBNAIL_FILE);
    std::fs::write(&path, png_bytes).map_err(|e| format!("Failed to write thumbnail: {e}"))?;
    info!(
        "store: saved thumbnail {} bytes ({:.1}ms)",
        png_bytes.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

/// Read the thumbnail for a workspace (if it exists) and return raw PNG bytes.
pub fn read_thumbnail(root: &Path) -> Option<Vec<u8>> {
    let path = root.join(TYPWRITER_DIR).join(THUMBNAIL_FILE);
    std::fs::read(&path).ok()
}
