// The list of folder workspaces, persisted at `<app data>/workspaces.json`.
//
// App-storage workspaces need no registry (they are the subdirectories of the
// managed root); a folder can be anywhere, so the app has to remember where.
// Each folder workspace also has a private mirror under `<app data>/mirrors/`.

use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::PathBuf,
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::remote::RemoteSpec;

/// Workspace ids for folder workspaces carry this prefix; app-storage ones
/// carry [`APP_PREFIX`]. A bare name is an app-storage workspace too — that
/// is what `lastWorkspace` held before folders existed.
pub const FOLDER_PREFIX: &str = "folder:";
pub const APP_PREFIX: &str = "app:";

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    #[serde(default)]
    pub folders: Vec<FolderEntry>,
    /// Where "New workspace" creates the next one. Picked once, reused.
    #[serde(default)]
    pub last_parent: Option<RemoteSpec>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub id: String,
    pub name: String,
    pub remote: RemoteSpec,
    #[serde(default)]
    pub last_opened_ms: Option<i64>,
}

static LOCK: Mutex<()> = Mutex::new(());

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("workspaces.json"))
}

fn read_unlocked(app: &AppHandle) -> Registry {
    file(app)
        .ok()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn read(app: &AppHandle) -> Registry {
    let _guard = LOCK.lock();
    read_unlocked(app)
}

/// Read, edit, and write back as one step with respect to every other update.
pub fn update<T>(app: &AppHandle, edit: impl FnOnce(&mut Registry) -> T) -> Result<T, String> {
    let _guard = LOCK.lock();
    let mut registry = read_unlocked(app);
    let out = edit(&mut registry);
    let json = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
    let path = file(app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn find(app: &AppHandle, id: &str) -> Option<FolderEntry> {
    read(app).folders.into_iter().find(|f| f.id == id)
}

/// Add a folder, or return the entry that already points at it.
pub fn register(
    app: &AppHandle,
    name: String,
    remote: RemoteSpec,
    last_opened_ms: Option<i64>,
) -> Result<FolderEntry, String> {
    update(app, |registry| {
        if let Some(existing) = registry.folders.iter().find(|f| f.remote == remote) {
            return existing.clone();
        }
        let entry = FolderEntry {
            id: new_id(&remote, &registry.folders),
            name,
            remote,
            last_opened_ms,
        };
        registry.folders.push(entry.clone());
        entry
    })
}

pub fn touch(app: &AppHandle, id: &str, at_ms: i64) -> Result<(), String> {
    update(app, |registry| {
        if let Some(entry) = registry.folders.iter_mut().find(|f| f.id == id) {
            entry.last_opened_ms = Some(at_ms);
        }
    })
}

/// A stable id for a new entry. Only generated once and then stored, so the
/// hasher not being stable across Rust releases doesn't matter.
fn new_id(remote: &RemoteSpec, taken: &[FolderEntry]) -> String {
    let mut hasher = DefaultHasher::new();
    match remote {
        RemoteSpec::Tree { uri } => uri.uri.hash(&mut hasher),
        RemoteSpec::Path { path } => path.hash(&mut hasher),
    }
    let mut n = hasher.finish();
    loop {
        let id = format!("{FOLDER_PREFIX}{n:016x}");
        if !taken.iter().any(|f| f.id == id) {
            return id;
        }
        n = n.wrapping_add(1);
    }
}

/// Where a folder workspace's private mirror lives.
pub fn mirror_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let key = id.strip_prefix(FOLDER_PREFIX).unwrap_or(id);
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("Invalid workspace id: {id}"));
    }
    Ok(app_data(app)?.join("mirrors").join(key))
}
