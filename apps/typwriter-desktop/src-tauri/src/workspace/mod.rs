// workspace/mod.rs
//
// WorkspaceState owns:
//   - the workspace root path
//   - the active main .typ file
//   - the current preview zoom/scale level
//   - the live FS watcher (kept alive for the app lifetime)
//
// All file-system operations (create/delete/rename/move) funnel through here
// so that the EditorWorld caches stay consistent.

mod watcher;

use parking_lot::{Mutex, RwLock};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use notify::RecommendedWatcher;
use serde::Serialize;
use tauri::AppHandle;
use typst::syntax::{FileId, VirtualPath};

use crate::{compiler::PreviewPipeline, world::EditorWorld};

// ─── File tree ────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileTreeEntry>,
}

// ─── WorkspaceState ──────────────────────────────────────────────────────────

pub struct WorkspaceState {
    pub root: RwLock<Option<PathBuf>>,
    pub main_file: RwLock<Option<PathBuf>>,
    pub zoom: Mutex<f32>,
    /// Keeps the watcher alive for the process lifetime.
    _watcher: Mutex<Option<RecommendedWatcher>>,
    world: Arc<EditorWorld>,
    pipeline: Arc<PreviewPipeline>,
    pub app_handle: AppHandle,
}

impl WorkspaceState {
    pub fn new(
        world: Arc<EditorWorld>,
        pipeline: Arc<PreviewPipeline>,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            root: RwLock::new(None),
            main_file: RwLock::new(None),
            zoom: Mutex::new(1.0),
            _watcher: Mutex::new(None),
            world,
            pipeline,
            app_handle,
        }
    }

    // ─── Workspace open ────────────────────────────────────────────────────

    /// Open a directory as the workspace root.
    /// Starts the FS watcher that auto-recompiles on external changes.
    pub fn open_folder(&self, path: PathBuf) -> Result<(), String> {
        // Validate it's actually a directory.
        if !path.is_dir() {
            return Err(format!("{} is not a directory", path.display()));
        }

        // Stop any previous watcher.
        *self._watcher.lock() = None;

        // Update the EditorWorld root and flush all caches.
        self.world.set_root(path.clone());

        // Start a new watcher for the new root.
        let new_watcher = watcher::start_watcher(
            path.clone(),
            self.world.clone(),
            self.pipeline.clone(),
            self.app_handle.clone(),
        )
        .map_err(|e| e.to_string())?;

        *self._watcher.lock() = Some(new_watcher);
        *self.root.write() = Some(path);
        *self.main_file.write() = None;

        Ok(())
    }

    // ─── Main file ─────────────────────────────────────────────────────────

    /// Set which .typ file is compiled on preview triggers.
    pub fn set_main_file(&self, path: PathBuf) -> Result<(), String> {
        let id = {
            let guard = self.root.read();
            let root = guard.as_ref().ok_or("No workspace open")?;
            let relative = path.strip_prefix(root).map_err(|_| {
                format!("{} is not inside the workspace root", path.display())
            })?;
            FileId::new(None, VirtualPath::new(relative))
        };

        self.world.set_main(id);
        self.pipeline.invalidate_cache();
        *self.main_file.write() = Some(path);
        Ok(())
    }

    // ─── Zoom / scale ──────────────────────────────────────────────────────

    pub fn set_zoom(&self, scale: f32) {
        *self.zoom.lock() = scale;
        self.pipeline.set_zoom(scale);
    }

    pub fn get_zoom(&self) -> f32 {
        *self.zoom.lock()
    }

    // ─── File-system helpers ───────────────────────────────────────────────

    /// Resolve a workspace-relative string path to an absolute PathBuf.
    /// If `path` is already absolute it is returned as-is.
    fn resolve(&self, path: &str) -> Result<PathBuf, String> {
        let p = PathBuf::from(path);
        if p.is_absolute() {
            return Ok(p);
        }
        let root = self.root.read();
        let root = root.as_ref().ok_or("No workspace open")?;
        Ok(root.join(p))
    }

    // ─── FS operations ─────────────────────────────────────────────────────

    /// Create an empty file at `path`.
    pub fn create_file(&self, path: &str) -> Result<(), String> {
        let abs = self.resolve(path)?;
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::File::create(&abs).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Create a directory (and all missing ancestors) at `path`.
    pub fn create_folder(&self, path: &str) -> Result<(), String> {
        let abs = self.resolve(path)?;
        std::fs::create_dir_all(&abs).map_err(|e| e.to_string())
    }

    /// Delete a single file and evict it from the EditorWorld caches.
    pub fn delete_file(&self, path: &str) -> Result<(), String> {
        let abs = self.resolve(path)?;
        std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
        if let Some(id) = self.world.path_to_id(&abs) {
            self.world.shadow_remove(id);
            self.world.invalidate_file(id);
        }
        Ok(())
    }

    /// Rename (or move within the same filesystem) a single file.
    pub fn rename_file(&self, src: &str, dst: &str) -> Result<(), String> {
        let src_abs = self.resolve(src)?;
        let dst_abs = self.resolve(dst)?;
        if let Some(parent) = dst_abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&src_abs, &dst_abs).map_err(|e| e.to_string())?;
        // Invalidate old id; new id will be cached on next access.
        if let Some(id) = self.world.path_to_id(&src_abs) {
            self.world.shadow_remove(id);
            self.world.invalidate_file(id);
        }
        Ok(())
    }

    /// Recursively delete a directory.
    /// The confirmation dialog is handled on the frontend; this method simply
    /// executes the deletion once called.
    pub fn delete_folder(&self, path: &str) -> Result<(), String> {
        let abs = self.resolve(path)?;

        // Invalidate caches for every file inside the directory before removing.
        if abs.is_dir() {
            for file_path in collect_files_recursive(&abs) {
                if let Some(id) = self.world.path_to_id(&file_path) {
                    self.world.shadow_remove(id);
                    self.world.invalidate_file(id);
                }
            }
        }

        std::fs::remove_dir_all(&abs).map_err(|e| e.to_string())
    }

    /// Move a single file to a new location.
    pub fn move_file(&self, src: &str, dst: &str) -> Result<(), String> {
        self.rename_file(src, dst)
    }

    /// Move an entire directory to a new location.
    pub fn move_folder(&self, src: &str, dst: &str) -> Result<(), String> {
        let src_abs = self.resolve(src)?;
        let dst_abs = self.resolve(dst)?;
        std::fs::rename(&src_abs, &dst_abs).map_err(|e| e.to_string())
    }

    // ─── File tree ─────────────────────────────────────────────────────────

    /// Return a recursive listing of the workspace root suitable for the
    /// sidebar file tree component.
    pub fn get_file_tree(&self) -> Result<Vec<FileTreeEntry>, String> {
        let root = {
            let guard = self.root.read();
            guard.as_ref().ok_or("No workspace open")?.clone()
        };
        Ok(read_dir_recursive(&root, &root))
    }

}

// ─── Directory reading ────────────────────────────────────────────────────────

fn read_dir_recursive(root: &Path, dir: &Path) -> Vec<FileTreeEntry> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };

    let mut result: Vec<FileTreeEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            // Skip hidden files/dirs (e.g. .git).
            if name.starts_with('.') {
                return None;
            }
            let rel = path.strip_prefix(root).ok()?;
            let path_str = rel.to_str()?.to_string();
            let is_dir = path.is_dir();
            let children = if is_dir {
                read_dir_recursive(root, &path)
            } else {
                vec![]
            };
            Some(FileTreeEntry {
                name,
                path: path_str,
                is_dir,
                children,
            })
        })
        .collect();

    // Directories first, then files; both sorted alphabetically.
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    result
}

/// Recursively collect all file paths under `dir`.
fn collect_files_recursive(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_files_recursive(&path));
            } else {
                files.push(path);
            }
        }
    }
    files
}

