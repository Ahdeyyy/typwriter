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

mod error;
mod path;
mod store;
mod watcher;

use log::{error, info, warn};
use parking_lot::{Mutex, RwLock};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use base64::Engine;
use notify::RecommendedWatcher;
use serde::Serialize;
use tauri::AppHandle;

use crate::{
    compiler::{render_page, CompileReason, PreviewPipeline},
    vcs::{CommitTrigger, VcsState, WorkingTreeFs},
    world::{local_file_id, EditorWorld},
};
use path::{ExternalPath, WorkspacePath};

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
    last_thumbnail_at: Mutex<Option<Instant>>,
    world: Arc<EditorWorld>,
    pipeline: Arc<PreviewPipeline>,
    /// Local-only version history. Bound to the current workspace via
    /// `VcsState::attach` whenever a folder is opened.
    pub vcs: Arc<VcsState>,
    pub app_handle: AppHandle,
}

impl WorkspaceState {
    pub fn new(
        world: Arc<EditorWorld>,
        pipeline: Arc<PreviewPipeline>,
        vcs: Arc<VcsState>,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            root: RwLock::new(None),
            main_file: RwLock::new(None),
            zoom: Mutex::new(1.0),
            _watcher: Mutex::new(None),
            last_thumbnail_at: Mutex::new(None),
            world,
            pipeline,
            vcs,
            app_handle,
        }
    }

    // ─── Workspace open ────────────────────────────────────────────────────

    /// Open a directory as the workspace root.
    /// Starts the FS watcher that auto-recompiles on external changes.
    /// Returns the workspace-relative path (forward slashes) of the restored main file, if any.
    pub fn open_folder(&self, path: PathBuf) -> Result<Option<String>, String> {
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
        *self.last_thumbnail_at.lock() = None;

        // Update the EditorWorld root and flush all in-memory caches. The
        // on-disk preview cache is rebound to the new workspace below — its
        // contents survive across opens (per workspace), so re-opening shows
        // the existing preview without recompiling.
        self.world.set_root(path.clone());
        self.pipeline.invalidate_cache();
        self.pipeline.attach_disk_cache(&path);

        // Kick the (lazy) font search off now so the system scan overlaps the
        // rest of the open path — watcher start, cache attach, frontend
        // round-trips — and is usually finished by the time the first compile
        // needs it. Idempotent, so the compile worker calling it again is free.
        self.world.ensure_fonts_loading();

        // Bind the version-history system to this workspace. Initializes a
        // `.git` repo on first open and seeds an initial restore point so the
        // timeline is never empty.
        self.vcs.attach(&path);

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
        let mut restored_main: Option<String> = None;
        if let Some(main) = store::get_workspace_main_file(&self.app_handle, &path) {
            let main_path = PathBuf::from(&main);
            if main_path.exists() {
                info!("WorkspaceState::open_folder: restoring main file main={main:?}");
                let _ = self.set_main_file(main_path.clone());
                // Compute the workspace-relative path for the frontend (forward slashes).
                restored_main = main_path
                    .strip_prefix(&path)
                    .ok()
                    .and_then(|r| r.to_str())
                    .map(|s| s.replace('\\', "/"));
                // Paint the previously-rendered preview from disk straight away,
                // so the user sees pages while fonts load and the document
                // recompiles in the background. The compile below reconciles.
                if let Some(rel) = &restored_main {
                    self.pipeline.restore_preview(rel);
                }
                self.pipeline.request_compile(CompileReason::MainFile);
            } else {
                warn!(
                    "WorkspaceState::open_folder: persisted main file no longer exists main={main:?}"
                );
            }
        }

        info!(
            "WorkspaceState::open_folder: ok restored_main={restored_main:?} ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(restored_main)
    }

    // ─── Main file ─────────────────────────────────────────────────────────

    /// Set which .typ file is compiled on preview triggers.
    pub fn set_main_file(&self, path: PathBuf) -> Result<(), String> {
        let t = Instant::now();
        info!("WorkspaceState::set_main_file: path={path:?}");

        // Snapshot the workspace root once — set_main_file is a hot path that
        // used to take this lock three times.
        let root = self.root.read().clone().ok_or_else(|| {
            let e = "No workspace open";
            error!("WorkspaceState::set_main_file: err=\"{e}\"");
            e.to_string()
        })?;

        let path = if path.is_absolute() {
            WorkspacePath::from_absolute_inside(&root, path)
                .map_err(|e| e.to_string())?
                .into_path_buf()
        } else {
            WorkspacePath::resolve(&root, path.to_string_lossy().as_ref())
                .map_err(|e| e.to_string())?
                .into_path_buf()
        };

        let relative = path.strip_prefix(&root).map_err(|_| {
            let e = format!("{} is not inside the workspace root", path.display());
            error!("WorkspaceState::set_main_file: err=\"{e}\" root={root:?}");
            e
        })?;
        let id = local_file_id(relative).ok_or_else(|| {
            let e = format!("{} is not a valid virtual path", relative.display());
            error!("WorkspaceState::set_main_file: err=\"{e}\"");
            e
        })?;

        self.world.set_main(id);
        self.pipeline.invalidate_cache();
        *self.main_file.write() = Some(path.clone());

        // Persist the choice so it can be restored on next open.
        store::set_workspace_main_file(&self.app_handle, &root, &path);

        info!(
            "WorkspaceState::set_main_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    pub fn clear_main_file(&self) {
        *self.main_file.write() = None;
        self.world.clear_main();
        self.pipeline.invalidate_cache();
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

        if doc.pages().is_empty() {
            return;
        }

        // Render page 0 at 1.0 scale (72 dpi) — small and fast.
        match render_page(&doc.pages()[0], 1.0) {
            Ok(png) => {
                if let Err(e) = store::save_thumbnail(&root, &png) {
                    warn!("WorkspaceState::generate_thumbnail: save failed err=\"{e}\"");
                }
            }
            Err(e) => error!("WorkspaceState::generate_thumbnail: render failed err=\"{e}\""),
        }
    }

    pub fn should_generate_thumbnail_for(&self, path: &Path) -> bool {
        let is_main = self
            .main_file
            .read()
            .as_ref()
            .map(|main| main == path)
            .unwrap_or(false);
        if !is_main {
            return false;
        }

        let mut last = self.last_thumbnail_at.lock();
        let now = Instant::now();
        if let Some(previous) = *last {
            if now.duration_since(previous) < Duration::from_secs(5) {
                return false;
            }
        }

        *last = Some(now);
        true
    }

    // ─── Recent workspaces ─────────────────────────────────────────────────

    /// Remove a single entry from the recent workspaces list.
    pub fn remove_recent_workspace(&self, path: &str) {
        store::remove_recent_workspace(&self.app_handle, path);
    }

    /// Clear the entire recent workspaces list.
    pub fn clear_recent_workspaces(&self) {
        store::clear_recent_workspaces(&self.app_handle);
    }

    /// Return the recent workspaces list enriched with names and, when requested, thumbnails.
    pub fn get_recent_workspaces(&self, include_thumbnails: bool) -> Vec<RecentWorkspaceEntry> {
        let paths = store::get_recent_workspaces(&self.app_handle);

        paths
            .into_iter()
            .map(|p| {
                let path_buf = PathBuf::from(&p);
                let name = path_buf
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| p.clone());

                let thumbnail = if include_thumbnails {
                    store::read_thumbnail(&path_buf)
                        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes))
                } else {
                    None
                };

                RecentWorkspaceEntry {
                    path: p,
                    name,
                    thumbnail,
                }
            })
            .collect()
    }

    // ─── Open tabs persistence ──────────────────────────────────────────────

    pub fn save_workspace_tabs(
        &self,
        tabs: Vec<String>,
        active_tab_id: Option<String>,
        unsaved: HashMap<String, String>,
    ) {
        let root = self.root.read();
        let Some(root) = root.as_ref() else {
            return;
        };
        store::save_workspace_tabs(&self.app_handle, root, tabs, active_tab_id, unsaved);
    }

    pub fn get_workspace_tabs(
        &self,
        root: &str,
    ) -> Option<(Vec<String>, Option<String>, HashMap<String, String>)> {
        store::get_workspace_tabs(&self.app_handle, &PathBuf::from(root))
    }

    // ─── File-system helpers ───────────────────────────────────────────────

    fn resolve(&self, path: &str) -> Result<PathBuf, String> {
        let root = {
            let root = self.root.read();
            root.as_ref().ok_or("No workspace open")?.clone()
        };

        WorkspacePath::resolve(&root, path)
            .map(WorkspacePath::into_path_buf)
            .map_err(|e| e.to_string())
    }

    /// Filesystem accessor for the current workspace root. Every structural
    /// file op routes its disk work through this [`WorkingTreeFs`].
    fn working_fs(&self) -> Result<Box<dyn WorkingTreeFs>, String> {
        let root = self.root.read().clone().ok_or("No workspace open")?;
        Ok(self.vcs.working_tree_fs_for(&root))
    }

    /// Capture a restore point recording a structural file operation so it can
    /// be undone from the timeline. File operations are user-intentional and
    /// infrequent, so they always snapshot (no save/compile policy gate) and
    /// are preserved from retention. The snapshot is taken *after* the
    /// operation, matching `save_file`: HEAD ends up matching disk, and the
    /// recoverable prior state lives in the preceding restore point.
    ///
    /// Failures are logged and swallowed — versioning must never block file
    /// management, mirroring the rest of the VCS integration.
    pub(crate) fn snapshot_file_op(&self, message: &str) {
        match self.vcs.commit_if_changed(CommitTrigger::FileOp, message) {
            Ok(Some(id)) => {
                let short = &id[..id.len().min(8)];
                info!("WorkspaceState::snapshot_file_op: {short} — {message}");
            }
            Ok(None) => {
                info!("WorkspaceState::snapshot_file_op: no change to snapshot — {message}");
            }
            Err(err) => {
                warn!("WorkspaceState::snapshot_file_op: failed err=\"{err}\" — {message}");
            }
        }
    }

    // ─── FS operations ─────────────────────────────────────────────────────

    /// Create an empty file at `path`.
    pub fn create_file(&self, path: &str) -> Result<(), String> {
        let t = Instant::now();
        let abs = self.resolve(path)?;
        let fs = self.working_fs()?;
        info!("WorkspaceState::create_file: abs={abs:?}");
        if let Some(parent) = abs.parent() {
            fs.create_dir_all(parent).map_err(|e| {
                error!(
                    "WorkspaceState::create_file: create_dir_all failed abs={abs:?} err=\"{e}\""
                );
                e
            })?;
        }
        fs.write_file(&abs, b"").map_err(|e| {
            error!("WorkspaceState::create_file: create failed abs={abs:?} err=\"{e}\"");
            e
        })?;
        self.snapshot_file_op(&format!("Created {}", basename(path)));
        info!(
            "WorkspaceState::create_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Create a directory (and all missing ancestors) at `path`.
    pub fn create_folder(&self, path: &str) -> Result<(), String> {
        let t = Instant::now();
        let abs = self.resolve(path)?;
        info!("WorkspaceState::create_folder: abs={abs:?}");
        self.working_fs()?.create_dir_all(&abs).map_err(|e| {
            error!("WorkspaceState::create_folder: failed abs={abs:?} err=\"{e}\"");
            e
        })?;
        // Empty directories aren't tracked by the content-addressed store, so
        // this is typically a no-op; kept for uniformity across file ops.
        self.snapshot_file_op(&format!("Created folder {}", basename(path)));
        info!(
            "WorkspaceState::create_folder: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Delete a single file and evict it from the EditorWorld caches.
    pub fn delete_file(&self, path: &str) -> Result<(), String> {
        let t = Instant::now();
        let abs = self.resolve(path)?;
        info!("WorkspaceState::delete_file: abs={abs:?}");
        self.working_fs()?.remove_file(&abs).map_err(|e| {
            error!("WorkspaceState::delete_file: failed abs={abs:?} err=\"{e}\"");
            e
        })?;
        if let Some(id) = self.world.path_to_id(&abs) {
            self.world.shadow_remove(id);
            self.world.invalidate_file(id);
        }
        if self
            .main_file
            .read()
            .as_ref()
            .map(|main| main == &abs)
            .unwrap_or(false)
        {
            self.clear_main_file();
        }
        self.snapshot_file_op(&format!("Deleted {}", basename(path)));
        info!(
            "WorkspaceState::delete_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Rename (or move within the same filesystem) a single file.
    pub fn rename_file(&self, src: &str, dst: &str) -> Result<(), String> {
        let t = Instant::now();
        let src_abs = self.resolve(src)?;
        let dst_abs = self.resolve(dst)?;
        let fs = self.working_fs()?;
        info!("WorkspaceState::rename_file: src={src_abs:?} dst={dst_abs:?}");
        if let Some(parent) = dst_abs.parent() {
            fs.create_dir_all(parent).map_err(|e| {
                error!("WorkspaceState::rename_file: create_dir_all failed dst_parent={parent:?} err=\"{e}\"");
                e
            })?;
        }
        fs.rename(&src_abs, &dst_abs).map_err(|e| {
            error!("WorkspaceState::rename_file: rename failed src={src_abs:?} dst={dst_abs:?} err=\"{e}\"");
            e
        })?;
        // Invalidate old id; new id will be cached on next access.
        if let Some(id) = self.world.path_to_id(&src_abs) {
            self.world.shadow_remove(id);
            self.world.invalidate_file(id);
        }
        self.update_main_file_path(&src_abs, &dst_abs, false)?;
        let message = if dirname(src) == dirname(dst) {
            format!("Renamed {} → {}", basename(src), basename(dst))
        } else {
            format!("Moved {} → {}", basename(src), dst)
        };
        self.snapshot_file_op(&message);
        info!(
            "WorkspaceState::rename_file: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Recursively delete a directory.
    /// The confirmation dialog is handled on the frontend; this method simply
    /// executes the deletion once called.
    pub fn delete_folder(&self, path: &str) -> Result<(), String> {
        let t = Instant::now();
        let abs = self.resolve(path)?;
        let fs = self.working_fs()?;
        info!("WorkspaceState::delete_folder: abs={abs:?}");

        // Invalidate caches for every file inside the directory before removing.
        // `collect_files_recursive` returns empty for a non-directory, so the
        // cache walk goes through the accessor too.
        let files = collect_files_recursive(fs.as_ref(), &abs);
        info!(
            "WorkspaceState::delete_folder: invalidating {} cached file(s)",
            files.len()
        );
        for file_path in files {
            if let Some(id) = self.world.path_to_id(&file_path) {
                self.world.shadow_remove(id);
                self.world.invalidate_file(id);
            }
        }

        fs.remove_dir_all(&abs).map_err(|e| {
            error!("WorkspaceState::delete_folder: failed abs={abs:?} err=\"{e}\"");
            e
        })?;
        if self
            .main_file
            .read()
            .as_ref()
            .map(|main| main.starts_with(&abs))
            .unwrap_or(false)
        {
            self.clear_main_file();
        }
        self.snapshot_file_op(&format!("Deleted folder {}", basename(path)));
        info!(
            "WorkspaceState::delete_folder: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Move a single file to a new location.
    pub fn move_file(&self, src: &str, dst: &str) -> Result<(), String> {
        info!("WorkspaceState::move_file: src={src:?} dst={dst:?} (delegates to rename_file)");
        self.rename_file(src, dst)
    }

    /// Import (copy) one or more external files into a workspace directory.
    pub fn import_files(&self, sources: &[String], dest_dir: &str) -> Result<(), String> {
        let t = Instant::now();
        let dest = self.resolve(dest_dir)?;
        let fs = self.working_fs()?;
        info!(
            "WorkspaceState::import_files: dest={dest:?} count={}",
            sources.len()
        );

        // A readable directory listing confirms `dest` exists and is a folder.
        if fs.read_dir(&dest).is_err() {
            let e = format!("{} is not a directory", dest.display());
            error!("WorkspaceState::import_files: err=\"{e}\"");
            return Err(e);
        }

        for src_str in sources {
            let src_path = ExternalPath::new(src_str).map_err(|e| e.to_string())?;
            // Source files come from a system picker / external location and are
            // read with std::fs; the destination write goes through the accessor.
            if !src_path.as_path().is_file() {
                let e = format!("Source is not a file: {}", src_path.as_path().display());
                error!("WorkspaceState::import_files: err=\"{e}\"");
                return Err(e);
            }
            let file_name = src_path.as_path().file_name().ok_or_else(|| {
                let e = format!(
                    "Cannot determine file name for {}",
                    src_path.as_path().display()
                );
                error!("WorkspaceState::import_files: err=\"{e}\"");
                e
            })?;
            let dst_path = dest.join(file_name);
            if fs.exists(&dst_path) {
                let e = format!("File already exists: {}", dst_path.display());
                error!("WorkspaceState::import_files: err=\"{e}\"");
                return Err(e);
            }
            let bytes = std::fs::read(src_path.as_path()).map_err(|e| {
                error!("WorkspaceState::import_files: read failed src={src_path:?} err=\"{e}\"");
                e.to_string()
            })?;
            fs.write_file(&dst_path, &bytes).map_err(|e| {
                error!("WorkspaceState::import_files: write failed dst={dst_path:?} err=\"{e}\"");
                e
            })?;
            info!(
                "WorkspaceState::import_files: copied {:?} -> {:?}",
                src_path, dst_path
            );
        }

        let count = sources.len();
        self.snapshot_file_op(&format!(
            "Imported {count} file{} into {}",
            if count == 1 { "" } else { "s" },
            basename(dest_dir)
        ));
        info!(
            "WorkspaceState::import_files: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Move an entire directory to a new location.
    pub fn move_folder(&self, src: &str, dst: &str) -> Result<(), String> {
        let t = Instant::now();
        let src_abs = self.resolve(src)?;
        let dst_abs = self.resolve(dst)?;
        let fs = self.working_fs()?;
        info!("WorkspaceState::move_folder: src={src_abs:?} dst={dst_abs:?}");
        if let Some(parent) = dst_abs.parent() {
            fs.create_dir_all(parent).map_err(|e| {
                error!("WorkspaceState::move_folder: create_dir_all failed dst_parent={parent:?} err=\"{e}\"");
                e
            })?;
        }
        fs.rename(&src_abs, &dst_abs).map_err(|e| {
            error!(
                "WorkspaceState::move_folder: failed src={src_abs:?} dst={dst_abs:?} err=\"{e}\""
            );
            e
        })?;
        self.update_main_file_path(&src_abs, &dst_abs, true)?;
        let message = if dirname(src) == dirname(dst) {
            format!("Renamed folder {} → {}", basename(src), basename(dst))
        } else {
            format!("Moved folder {} → {}", basename(src), dst)
        };
        self.snapshot_file_op(&message);
        info!(
            "WorkspaceState::move_folder: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    // ─── File tree ─────────────────────────────────────────────────────────

    /// Return a recursive listing of the workspace root suitable for the
    /// sidebar file tree component.
    pub fn get_file_tree(&self) -> Result<Vec<FileTreeEntry>, String> {
        let root = {
            let guard = self.root.read();
            guard
                .as_ref()
                .ok_or_else(|| {
                    error!("WorkspaceState::get_file_tree: no workspace open");
                    "No workspace open".to_string()
                })?
                .clone()
        };

        // Read through the working-tree accessor for the current root.
        let fs = self.vcs.working_tree_fs_for(&root);

        // Surface an unreadable root as an explicit error instead of silently
        // returning an empty tree. A silent empty result is indistinguishable
        // from a genuinely empty workspace, which is how an inaccessible root
        // ends up looking like a workspace with no files. An empty-but-readable
        // root is still a valid empty tree and returns Ok(vec![]).
        fs.read_dir(&root).map_err(|e| {
            error!("WorkspaceState::get_file_tree: cannot read root={root:?} err=\"{e}\"");
            format!("Cannot read workspace folder {}: {e}", root.display())
        })?;

        Ok(read_dir_recursive(fs.as_ref(), &root, &root))
    }
}

impl WorkspaceState {
    fn update_main_file_path(
        &self,
        src_abs: &Path,
        dst_abs: &Path,
        is_dir: bool,
    ) -> Result<(), String> {
        let current_main = self.main_file.read().clone();
        let Some(current_main) = current_main else {
            return Ok(());
        };

        let updated_main = if is_dir {
            rewrite_path_prefix(&current_main, src_abs, dst_abs)
        } else if current_main == src_abs {
            Some(dst_abs.to_path_buf())
        } else {
            None
        };

        let Some(updated_main) = updated_main else {
            return Ok(());
        };

        let root = self.root.read();
        let root = root
            .as_ref()
            .ok_or_else(|| "No workspace open".to_string())?;
        let relative = updated_main.strip_prefix(root).map_err(|_| {
            format!(
                "{} is not inside the workspace root",
                updated_main.display()
            )
        })?;

        let id = local_file_id(relative)
            .ok_or_else(|| format!("{} is not a valid virtual path", relative.display()))?;
        self.world.set_main(id);
        *self.main_file.write() = Some(updated_main.clone());
        store::set_workspace_main_file(&self.app_handle, root, &updated_main);
        self.pipeline.invalidate_cache();

        Ok(())
    }
}

// ─── Directory reading ────────────────────────────────────────────────────────

/// Directories never shown in the file tree and never descended into. Mirrors
/// the watcher's ignore list (`watcher::IGNORED_DIRS`) so the tree walk doesn't
/// spend time (and IPC payload) recursing through huge generated/dependency
/// folders. Dot-prefixed names (`.git`, `.typwriter`, `.svelte-kit`) are already
/// filtered separately; these are the non-dotfile cases.
const IGNORED_TREE_DIRS: &[&str] = &["node_modules", "target", "dist"];

fn read_dir_recursive(fs: &dyn WorkingTreeFs, root: &Path, dir: &Path) -> Vec<FileTreeEntry> {
    let entries = match fs.read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            warn!("read_dir_recursive: failed to read dir={dir:?} err=\"{err}\"");
            return vec![];
        }
    };

    let mut result: Vec<FileTreeEntry> = entries
        .into_iter()
        .filter_map(|entry| {
            let name = entry.name;
            // Skip hidden files/dirs (e.g. .git).
            if name.starts_with('.') {
                return None;
            }
            let is_dir = entry.is_dir;
            // Don't surface or descend into generated/dependency directories.
            if is_dir && IGNORED_TREE_DIRS.contains(&name.as_str()) {
                return None;
            }
            let rel = entry.path.strip_prefix(root).ok()?;
            let path_str = rel.to_str()?.to_string();
            let children = if is_dir {
                read_dir_recursive(fs, root, &entry.path)
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

/// Recursively collect all file paths under `dir`, through the
/// [`WorkingTreeFs`] accessor.
fn collect_files_recursive(fs: &dyn WorkingTreeFs, dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match fs.read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            warn!("collect_files_recursive: failed to read dir={dir:?} err=\"{err}\"");
            return files;
        }
    };

    for entry in entries {
        if entry.is_dir {
            files.extend(collect_files_recursive(fs, &entry.path));
        } else {
            files.push(entry.path);
        }
    }
    files
}

fn rewrite_path_prefix(path: &Path, src_prefix: &Path, dst_prefix: &Path) -> Option<PathBuf> {
    let suffix = path.strip_prefix(src_prefix).ok()?;
    Some(dst_prefix.join(suffix))
}

/// Last path segment of a workspace-relative (forward- or back-slash) path,
/// used to build human-readable restore-point messages.
fn basename(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
}

/// Parent portion of a workspace-relative path, or `""` for a top-level entry.
/// Used to distinguish a rename (same parent) from a move (different parent).
fn dirname(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(idx) => &trimmed[..idx],
        None => "",
    }
}
