// vcs/mod.rs
//
// Local-only versioning for a workspace. Snapshots ("restore points") live
// under `<workspace>/.typwriter/history/` as a content-addressed blob store
// plus JSON manifests — no git, no gix. The store is accessed through
// `WorkingTreeFs`, which means the same code path works on desktop's
// std::fs and Android's SAF; snapshots travel with the workspace folder
// when it's synced, backed up, or moved.
//
// Design choices worth keeping in mind:
//
//   * Snapshots are triggered by `save`, by successful compile, and on
//     manual demand. All routes funnel into [`VcsState::commit_if_changed`],
//     which compares the working tree's flat path→hash map against HEAD and
//     short-circuits when nothing changed. That dedupe is what keeps the
//     history clean when both Save and Compile fire on the same edit.
//
//   * `.typwriter/` and `.git/` are skipped when walking — the preview
//     cache, history itself, and any external git metadata don't belong
//     in a snapshot.
//
//   * "Changed files" for timeline coloring comes from set-diffing each
//     snapshot's file map against its parent's. The frontend hashes paths
//     to colors; the backend just lists names.
//
//   * Diffing returns raw before/after blob bytes per file. `@pierre/diff`
//     on the frontend renders the actual side-by-side / inline view.
//
//   * Retention: Save and Compile snapshots are subject to the user's
//     configured count / age caps. Manual / Initial / PreRestore are
//     always preserved.

mod commit;
mod diff;
mod fs;
mod history;
mod paths;
mod restore;
mod retention;
mod store;

pub use commit::CommitTrigger;
#[allow(unused_imports)]
pub use diff::{FileDiff, FileDiffStatus, WorkspaceDiff};
pub use history::RestorePoint;
pub use retention::RetentionPolicy;

#[cfg(target_os = "android")]
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use log::{info, warn};
use parking_lot::{Mutex, RwLock};

#[cfg(not(target_os = "android"))]
use fs::LocalWorkingTreeFs;

/// User preferences governing automatic snapshot creation. Lives behind an
/// `Arc<RwLock<_>>` managed by Tauri; refreshed whenever the frontend
/// mutates settings via `set_app_settings`.
#[derive(Clone, Debug)]
pub struct SnapshotPolicy {
    pub on_save: bool,
    pub on_compile: bool,
    pub min_interval_seconds: u32,
    pub retention: RetentionPolicy,
}

impl Default for SnapshotPolicy {
    fn default() -> Self {
        Self {
            on_save: true,
            on_compile: true,
            min_interval_seconds: 0,
            retention: RetentionPolicy::default(),
        }
    }
}

impl SnapshotPolicy {
    pub fn from_settings(settings: &crate::commands::settings::AppSettings) -> Self {
        Self {
            on_save: settings.auto_snapshot_on_save,
            on_compile: settings.auto_snapshot_on_compile,
            min_interval_seconds: settings.auto_snapshot_min_interval_seconds,
            retention: RetentionPolicy {
                max_auto_count: settings.snapshot_retention_max_count,
                max_auto_age_days: settings.snapshot_retention_max_days,
            },
        }
    }

    /// Does this trigger fall under the auto-snapshot gate? Manual / Initial
    /// / PreRestore always bypass — those are user-driven or safety-critical
    /// and never throttled by user prefs.
    pub fn allows(&self, trigger: CommitTrigger) -> bool {
        match trigger {
            CommitTrigger::Save => self.on_save,
            CommitTrigger::Compile => self.on_compile,
            CommitTrigger::Manual | CommitTrigger::Initial | CommitTrigger::PreRestore => true,
        }
    }
}

/// Process-wide VCS coordinator. Stores the currently-attached workspace
/// root; on each operation we re-derive the `WorkingTreeFs` (desktop or
/// SAF-backed Android variant) and re-enter the store.
pub struct VcsState {
    root: RwLock<Option<PathBuf>>,
    #[cfg(target_os = "android")]
    app_handle: tauri::AppHandle,
    #[cfg(target_os = "android")]
    saf_roots: RwLock<HashMap<PathBuf, tauri_plugin_android_fs::FileUri>>,
    /// Time of the last auto-snapshot. Used to throttle Save / Compile
    /// triggers when the user has configured a `min_interval_seconds`.
    /// `None` until the first successful auto-commit.
    last_auto_snapshot: Mutex<Option<Instant>>,
}

impl VcsState {
    pub fn new(_app_handle: tauri::AppHandle) -> Self {
        Self {
            root: RwLock::new(None),
            #[cfg(target_os = "android")]
            app_handle: _app_handle,
            #[cfg(target_os = "android")]
            saf_roots: RwLock::new(HashMap::new()),
            last_auto_snapshot: Mutex::new(None),
        }
    }

    #[cfg(target_os = "android")]
    pub fn remember_saf_root(
        &self,
        workspace_root: PathBuf,
        uri: tauri_plugin_android_fs::FileUri,
    ) {
        self.saf_roots.write().insert(workspace_root, uri);
    }

    /// Bind the VCS to a workspace root and seed the timeline with an
    /// initial snapshot if there's no history yet. Errors are logged and
    /// swallowed — versioning failing must never block opening a workspace.
    pub fn attach(self: &Arc<Self>, workspace_root: &Path) {
        *self.root.write() = Some(workspace_root.to_path_buf());
        *self.last_auto_snapshot.lock() = None;

        #[cfg(target_os = "android")]
        {
            let this = Arc::clone(self);
            let workspace_root = workspace_root.to_path_buf();
            let for_thread = workspace_root.clone();
            if let Err(err) = std::thread::Builder::new()
                .name("typwriter-vcs-attach".into())
                .spawn(move || this.attach_initial(&for_thread))
            {
                warn!(
                    "vcs::attach: failed to spawn background attach root={workspace_root:?} err=\"{err}\""
                );
            }
        }

        #[cfg(not(target_os = "android"))]
        {
            self.attach_initial(workspace_root);
        }
    }

    fn attach_initial(&self, workspace_root: &Path) {
        // Best-effort seed. We use unlimited retention here so the very
        // first snapshot is never immediately pruned.
        if let Err(err) = self.commit_if_changed_for_root(
            workspace_root,
            CommitTrigger::Initial,
            "Initial restore point",
            &RetentionPolicy::unlimited(),
        ) {
            warn!("vcs::attach: initial snapshot skipped err=\"{err}\"");
            return;
        }
        info!("vcs::attach: ready root={workspace_root:?}");
    }

    fn workspace_root(&self) -> Option<PathBuf> {
        self.root.read().clone()
    }

    #[cfg(target_os = "android")]
    fn working_tree_fs(&self, root: &Path) -> fs::AndroidWorkingTreeFs<tauri::Wry> {
        let app_handle = self.app_handle.clone();
        if let Some(uri) = self.saf_roots.read().get(root).cloned() {
            fs::AndroidWorkingTreeFs::new_with_root(app_handle, root.to_path_buf(), uri)
        } else {
            fs::AndroidWorkingTreeFs::new(app_handle)
        }
    }

    /// Create a snapshot iff the working tree differs from HEAD. Returns the
    /// new snapshot id, or `None` when there was nothing to commit.
    pub fn commit_if_changed(
        &self,
        trigger: CommitTrigger,
        message: &str,
    ) -> Result<Option<String>, String> {
        let Some(root) = self.workspace_root() else {
            return Ok(None);
        };
        self.commit_if_changed_for_root(&root, trigger, message, &RetentionPolicy::unlimited())
    }

    fn commit_if_changed_for_root(
        &self,
        root: &Path,
        trigger: CommitTrigger,
        message: &str,
        retention: &RetentionPolicy,
    ) -> Result<Option<String>, String> {
        #[cfg(target_os = "android")]
        {
            let fs = self.working_tree_fs(root);
            return commit::commit_if_changed(root, &fs, trigger, message, retention);
        }
        #[cfg(not(target_os = "android"))]
        {
            let fs = LocalWorkingTreeFs;
            commit::commit_if_changed(root, &fs, trigger, message, retention)
        }
    }

    /// Auto-snapshot gated by the user's [`SnapshotPolicy`]. Skips the
    /// snapshot entirely when the relevant toggle is off, and throttles by
    /// `min_interval_seconds` against the timestamp of the previous
    /// successful auto-snapshot.
    pub fn auto_commit_if_changed(
        &self,
        trigger: CommitTrigger,
        message: &str,
        policy: &SnapshotPolicy,
    ) -> Result<Option<String>, String> {
        if !policy.allows(trigger) {
            return Ok(None);
        }
        if policy.min_interval_seconds > 0 {
            if let Some(last) = *self.last_auto_snapshot.lock() {
                if last.elapsed().as_secs() < policy.min_interval_seconds as u64 {
                    return Ok(None);
                }
            }
        }
        let Some(root) = self.workspace_root() else {
            return Ok(None);
        };
        let result =
            self.commit_if_changed_for_root(&root, trigger, message, &policy.retention)?;
        if result.is_some() {
            *self.last_auto_snapshot.lock() = Some(Instant::now());
        }
        Ok(result)
    }

    /// User-driven restore-point creation with a custom message.
    pub fn create_manual_restore_point(&self, message: &str) -> Result<Option<String>, String> {
        let msg = if message.trim().is_empty() {
            "Restore point"
        } else {
            message
        };
        self.commit_if_changed(CommitTrigger::Manual, msg)
    }

    /// Read the current HEAD id — the snapshot the working tree was last
    /// committed at or restored to. Returns `None` when no snapshots exist
    /// yet, or when no workspace is attached. The timeline UI uses this to
    /// mark the "you are here" point.
    pub fn current_id(&self) -> Result<Option<String>, String> {
        let Some(root) = self.workspace_root() else {
            return Ok(None);
        };
        #[cfg(target_os = "android")]
        {
            let fs = self.working_tree_fs(&root);
            return store::read_head(&fs, &root);
        }
        #[cfg(not(target_os = "android"))]
        {
            let fs = LocalWorkingTreeFs;
            store::read_head(&fs, &root)
        }
    }

    /// Return the snapshot history of the workspace, newest first.
    pub fn list_history(&self, limit: Option<usize>) -> Result<Vec<RestorePoint>, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        #[cfg(target_os = "android")]
        {
            let fs = self.working_tree_fs(&root);
            return history::list_history(&root, &fs, limit);
        }
        #[cfg(not(target_os = "android"))]
        {
            let fs = LocalWorkingTreeFs;
            history::list_history(&root, &fs, limit)
        }
    }

    /// Diff a snapshot against the current working tree.
    pub fn diff_vs_current(&self, commit_id: &str) -> Result<WorkspaceDiff, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        #[cfg(target_os = "android")]
        {
            let fs = self.working_tree_fs(&root);
            return diff::diff_vs_current(&root, &fs, commit_id);
        }
        #[cfg(not(target_os = "android"))]
        {
            let fs = LocalWorkingTreeFs;
            diff::diff_vs_current(&root, &fs, commit_id)
        }
    }

    /// Diff two snapshots against each other.
    pub fn diff_between(&self, from_id: &str, to_id: &str) -> Result<WorkspaceDiff, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        #[cfg(target_os = "android")]
        {
            let fs = self.working_tree_fs(&root);
            return diff::diff_between(&root, &fs, from_id, to_id);
        }
        #[cfg(not(target_os = "android"))]
        {
            let fs = LocalWorkingTreeFs;
            diff::diff_between(&root, &fs, from_id, to_id)
        }
    }

    /// Restore the entire workspace to a given snapshot.
    pub fn restore_workspace(&self, commit_id: &str) -> Result<(), String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        #[cfg(target_os = "android")]
        {
            let fs = self.working_tree_fs(&root);
            return restore::restore_workspace(&root, &fs, commit_id);
        }
        #[cfg(not(target_os = "android"))]
        {
            let fs = LocalWorkingTreeFs;
            restore::restore_workspace(&root, &fs, commit_id)
        }
    }

    /// Restore a single file from a snapshot, leaving the rest of the
    /// workspace alone.
    pub fn restore_file(&self, commit_id: &str, path: &str) -> Result<(), String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        #[cfg(target_os = "android")]
        {
            let fs = self.working_tree_fs(&root);
            return restore::restore_file(&root, &fs, commit_id, path);
        }
        #[cfg(not(target_os = "android"))]
        {
            let fs = LocalWorkingTreeFs;
            restore::restore_file(&root, &fs, commit_id, path)
        }
    }
}
