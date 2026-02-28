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

mod store;
mod watcher;

use log::{error, info, warn};
use parking_lot::{Mutex, RwLock};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use base64::Engine;
use notify::RecommendedWatcher;
use serde::Serialize;
use tauri::AppHandle;
use typst::syntax::{FileId, VirtualPath};

use crate::{compiler::render_page, compiler::PreviewPipeline, world::EditorWorld};

// ─── Recent workspace entry (returned to the frontend) ────────────────────────

#[derive(Serialize, Clone, Debug)]
pub struct RecentWorkspaceEntry {
    pub path: String,
    pub name: String,
    /// Base64-encoded PNG thumbnail, if available.
    pub thumbnail: Option<String>,
}

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
        let t = Instant::now();
        info!("WorkspaceState::open_folder: path={path:?}");

        // Validate it's actually a directory.
        if !path.is_dir() {
            let e = format!("{} is not a directory", path.display());
            error!("WorkspaceState::open_folder: err=\"{e}\"");
            return Err(e);
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
        .map_err(|e| {
            error!("WorkspaceState::open_folder: watcher start failed err=\"{e}\" path={path:?}");
            e.to_string()
        })?;

        *self._watcher.lock() = Some(new_watcher);
        *self.root.write() = Some(path.clone());
        *self.main_file.write() = None;

        // ── Persistence ────────────────────────────────────────────────
        // 1. Add to the recent-workspaces list.
        store::add_recent_workspace(&self.app_handle, &path);

        // 2. Ensure the .typwriter metadata directory exists.
        let _ = store::ensure_typwriter_dir(&path);

        // 3. Restore the previously-set main file (if it still exists).
        if let Some(main) = store::get_workspace_main_file(&self.app_handle, &path) {
            let main_path = PathBuf::from(&main);
            if main_path.exists() {
                info!("WorkspaceState::open_folder: restoring main file main={main:?}");
                let _ = self.set_main_file(main_path);
            } else {
                warn!("WorkspaceState::open_folder: persisted main file no longer exists main={main:?}");
            }
        }

        info!("WorkspaceState::open_folder: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    // ─── Main file ─────────────────────────────────────────────────────────

    /// Set which .typ file is compiled on preview triggers.
    pub fn set_main_file(&self, path: PathBuf) -> Result<(), String> {
        let t = Instant::now();
        info!("WorkspaceState::set_main_file: path={path:?}");

        let id = {
            let guard = self.root.read();
            let root = guard.as_ref().ok_or_else(|| {
                let e = "No workspace open";
                error!("WorkspaceState::set_main_file: err=\"{e}\"");
                e.to_string()
            })?;
            let relative = path.strip_prefix(root).map_err(|_| {
                let e = format!("{} is not inside the workspace root", path.display());
                error!("WorkspaceState::set_main_file: err=\"{e}\" root={root:?}");
                e
            })?;
            FileId::new(None, VirtualPath::new(relative))
        };

        self.world.set_main(id);
        self.pipeline.invalidate_cache();
        *self.main_file.write() = Some(path.clone());

        // Persist the choice so it can be restored on next open.
        if let Some(root) = self.root.read().as_ref() {
            store::set_workspace_main_file(&self.app_handle, root, &path);
        }

        info!("WorkspaceState::set_main_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
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

    // ─── Thumbnail ─────────────────────────────────────────────────────────

    /// Generate a thumbnail from the first page of the last compiled document
    /// and write it to `.typwriter/thumbnail.png` in the workspace root.
    /// Silently does nothing if there is no compiled document or no workspace.
    pub fn generate_thumbnail(&self) {
        let root = match self.root.read().clone() {
            Some(r) => r,
            None => return,
        };

        let doc = match self.pipeline.last_document.lock().clone() {
            Some(d) => d,
            None => return,
        };

        if doc.pages.is_empty() {
            return;
        }

        // Render page 0 at 1.0 scale (72 dpi) — small and fast.
        match render_page(&doc.pages[0], 1.0) {
            Ok(png) => {
                if let Err(e) = store::save_thumbnail(&root, &png) {
                    warn!("WorkspaceState::generate_thumbnail: save failed err=\"{e}\"");
                }
            }
            Err(e) => error!("WorkspaceState::generate_thumbnail: render failed err=\"{e}\""),
        }
    }

    // ─── Recent workspaces ─────────────────────────────────────────────────

    /// Return the recent workspaces list enriched with names and thumbnails.
    pub fn get_recent_workspaces_with_thumbnails(&self) -> Vec<RecentWorkspaceEntry> {
        let paths = store::get_recent_workspaces(&self.app_handle);

        paths
            .into_iter()
            .map(|p| {
                let path_buf = PathBuf::from(&p);
                let name = path_buf
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| p.clone());

                let thumbnail = store::read_thumbnail(&path_buf)
                    .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes));

                RecentWorkspaceEntry {
                    path: p,
                    name,
                    thumbnail,
                }
            })
            .collect()
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
        let t = Instant::now();
        let abs = self.resolve(path)?;
        info!("WorkspaceState::create_file: abs={abs:?}");
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                error!("WorkspaceState::create_file: create_dir_all failed abs={abs:?} err=\"{e}\"");
                e.to_string()
            })?;
        }
        std::fs::File::create(&abs).map_err(|e| {
            error!("WorkspaceState::create_file: create failed abs={abs:?} err=\"{e}\"");
            e.to_string()
        })?;
        info!("WorkspaceState::create_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    /// Create a directory (and all missing ancestors) at `path`.
    pub fn create_folder(&self, path: &str) -> Result<(), String> {
        let t = Instant::now();
        let abs = self.resolve(path)?;
        info!("WorkspaceState::create_folder: abs={abs:?}");
        std::fs::create_dir_all(&abs).map_err(|e| {
            error!("WorkspaceState::create_folder: failed abs={abs:?} err=\"{e}\"");
            e.to_string()
        })?;
        info!("WorkspaceState::create_folder: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    /// Delete a single file and evict it from the EditorWorld caches.
    pub fn delete_file(&self, path: &str) -> Result<(), String> {
        let t = Instant::now();
        let abs = self.resolve(path)?;
        info!("WorkspaceState::delete_file: abs={abs:?}");
        std::fs::remove_file(&abs).map_err(|e| {
            error!("WorkspaceState::delete_file: failed abs={abs:?} err=\"{e}\"");
            e.to_string()
        })?;
        if let Some(id) = self.world.path_to_id(&abs) {
            self.world.shadow_remove(id);
            self.world.invalidate_file(id);
        }
        info!("WorkspaceState::delete_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    /// Rename (or move within the same filesystem) a single file.
    pub fn rename_file(&self, src: &str, dst: &str) -> Result<(), String> {
        let t = Instant::now();
        let src_abs = self.resolve(src)?;
        let dst_abs = self.resolve(dst)?;
        info!("WorkspaceState::rename_file: src={src_abs:?} dst={dst_abs:?}");
        if let Some(parent) = dst_abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                error!("WorkspaceState::rename_file: create_dir_all failed dst_parent={parent:?} err=\"{e}\"");
                e.to_string()
            })?;
        }
        std::fs::rename(&src_abs, &dst_abs).map_err(|e| {
            error!("WorkspaceState::rename_file: rename failed src={src_abs:?} dst={dst_abs:?} err=\"{e}\"");
            e.to_string()
        })?;
        // Invalidate old id; new id will be cached on next access.
        if let Some(id) = self.world.path_to_id(&src_abs) {
            self.world.shadow_remove(id);
            self.world.invalidate_file(id);
        }
        info!("WorkspaceState::rename_file: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    /// Recursively delete a directory.
    /// The confirmation dialog is handled on the frontend; this method simply
    /// executes the deletion once called.
    pub fn delete_folder(&self, path: &str) -> Result<(), String> {
        let t = Instant::now();
        let abs = self.resolve(path)?;
        info!("WorkspaceState::delete_folder: abs={abs:?}");

        // Invalidate caches for every file inside the directory before removing.
        if abs.is_dir() {
            let files = collect_files_recursive(&abs);
            info!("WorkspaceState::delete_folder: invalidating {} cached file(s)", files.len());
            for file_path in files {
                if let Some(id) = self.world.path_to_id(&file_path) {
                    self.world.shadow_remove(id);
                    self.world.invalidate_file(id);
                }
            }
        }

        std::fs::remove_dir_all(&abs).map_err(|e| {
            error!("WorkspaceState::delete_folder: failed abs={abs:?} err=\"{e}\"");
            e.to_string()
        })?;
        info!("WorkspaceState::delete_folder: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    /// Move a single file to a new location.
    pub fn move_file(&self, src: &str, dst: &str) -> Result<(), String> {
        info!("WorkspaceState::move_file: src={src:?} dst={dst:?} (delegates to rename_file)");
        self.rename_file(src, dst)
    }

    /// Move an entire directory to a new location.
    pub fn move_folder(&self, src: &str, dst: &str) -> Result<(), String> {
        let t = Instant::now();
        let src_abs = self.resolve(src)?;
        let dst_abs = self.resolve(dst)?;
        info!("WorkspaceState::move_folder: src={src_abs:?} dst={dst_abs:?}");
        std::fs::rename(&src_abs, &dst_abs).map_err(|e| {
            error!("WorkspaceState::move_folder: failed src={src_abs:?} dst={dst_abs:?} err=\"{e}\"");
            e.to_string()
        })?;
        info!("WorkspaceState::move_folder: ok ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    // ─── File tree ─────────────────────────────────────────────────────────

    /// Return a recursive listing of the workspace root suitable for the
    /// sidebar file tree component.
    pub fn get_file_tree(&self) -> Result<Vec<FileTreeEntry>, String> {
        let root = {
            let guard = self.root.read();
            guard.as_ref().ok_or_else(|| {
                error!("WorkspaceState::get_file_tree: no workspace open");
                "No workspace open".to_string()
            })?.clone()
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
