// Local-only versioning for a workspace. Snapshots ("restore points") live
// under `<workspace>/.typwriter/history/` as a content-addressed blob store
// plus JSON manifests — no git, no gix. The store is accessed through
// `WorkingTreeFs`; snapshots travel with the workspace folder when it's
// synced, backed up, or moved.
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
pub(crate) mod fs;
mod history;
mod index;
mod paths;
mod restore;
mod retention;
mod store;

pub use commit::CommitTrigger;
#[allow(unused_imports)]
pub use diff::{FileDiff, FileDiffStatus, WorkspaceDiff};
pub use history::RestorePoint;
pub use retention::RetentionPolicy;

/// Workspace-relative path → blob hash, as recorded in a snapshot manifest.
pub type SnapshotFiles = std::collections::BTreeMap<String, String>;

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Weak};
use std::time::Instant;

use log::{info, warn};
use parking_lot::{Mutex, RwLock};

use fs::LocalWorkingTreeFs;
pub use fs::WorkingTreeFs;
use index::TreeIndex;

/// One queued auto-snapshot. The root is captured when the request is made,
/// so a snapshot asked for just before a workspace switch still lands in the
/// workspace it was about.
struct AutoSnapshotRequest {
    root: PathBuf,
    trigger: CommitTrigger,
    message: String,
    policy: SnapshotPolicy,
}

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
    /// / PreRestore / FileOp always bypass — those are user-driven or
    /// safety-critical and never throttled by user prefs.
    pub fn allows(&self, trigger: CommitTrigger) -> bool {
        match trigger {
            CommitTrigger::Save => self.on_save,
            CommitTrigger::Compile => self.on_compile,
            CommitTrigger::Manual
            | CommitTrigger::Initial
            | CommitTrigger::PreRestore
            | CommitTrigger::FileOp => true,
        }
    }
}

/// Process-wide VCS coordinator. Stores the currently-attached workspace
/// root; on each operation we re-derive the `WorkingTreeFs` and re-enter the
/// store.
pub struct VcsState {
    root: RwLock<Option<PathBuf>>,
    /// Time of the last auto-snapshot. Used to throttle Save / Compile
    /// triggers when the user has configured a `min_interval_seconds`.
    /// `None` until the first successful auto-commit.
    last_auto_snapshot: Mutex<Option<Instant>>,
    /// Serializes all snapshot writes. The initial seed runs on its own
    /// thread (so opening a workspace never waits on it), which means it can
    /// overlap a save/compile/file-op commit; manifests and HEAD are written
    /// as separate files, so two racing commits could interleave into a
    /// torn timeline. Holding this lock across `commit_if_changed` makes
    /// commit ordering deterministic.
    ///
    /// The guarded value is the stat cache for the workspace last committed
    /// to; it lives here because the walk is the only thing that touches it.
    commit_lock: Mutex<Option<TreeIndex>>,
    /// Queue feeding the auto-snapshot worker, which is spawned on first use.
    auto_tx: Mutex<Option<Sender<AutoSnapshotRequest>>>,
}

impl VcsState {
    pub fn new(_app_handle: tauri::AppHandle) -> Self {
        Self {
            root: RwLock::new(None),
            last_auto_snapshot: Mutex::new(None),
            commit_lock: Mutex::new(None),
            auto_tx: Mutex::new(None),
        }
    }

    /// Run `op` with the commit lock held and the stat cache for `root`
    /// loaded, swapping the cache out if it belonged to another workspace.
    fn with_index<T>(&self, root: &Path, op: impl FnOnce(&mut TreeIndex) -> T) -> T {
        let mut guard = self.commit_lock.lock();
        if guard.as_ref().is_none_or(|index| index.root() != root) {
            *guard = Some(TreeIndex::load(&LocalWorkingTreeFs, root));
        }
        op(guard.as_mut().expect("index loaded above"))
    }

    /// Bind the VCS to a workspace root. Cheap and synchronous — call this on
    /// the workspace-open path. Pair it with [`Self::spawn_initial_snapshot`]
    /// to seed the timeline without blocking the open.
    pub fn bind_root(&self, workspace_root: &Path) {
        *self.root.write() = Some(workspace_root.to_path_buf());
        *self.last_auto_snapshot.lock() = None;
    }

    /// Standalone documents do not snapshot the surrounding source folder.
    pub fn detach(&self) {
        *self.root.write() = None;
        *self.last_auto_snapshot.lock() = None;
    }

    /// Seed the timeline with an initial snapshot on a background thread, if
    /// there's no history yet. Errors are logged and swallowed — versioning
    /// failing must never block opening a workspace.
    ///
    /// Reads and hashes every file in the workspace, which is exactly the
    /// work that made large workspaces slow to open when this ran inline, so
    /// it must stay off the open path.
    pub fn spawn_initial_snapshot(self: &Arc<Self>, workspace_root: &Path) {
        let workspace_root = workspace_root.to_path_buf();
        let state = Arc::clone(self);
        let result = std::thread::Builder::new()
            .name("vcs-initial-snapshot".into())
            .spawn(move || state.attach_initial(&workspace_root));
        if let Err(err) = result {
            warn!("vcs::spawn_initial_snapshot: thread spawn failed err=\"{err}\"");
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

    /// Build a filesystem accessor for *reading* the working tree at `root`
    /// (e.g. the sidebar file tree). Mirrors how snapshots read the working
    /// tree, keeping the file tree and version history in lockstep.
    pub fn working_tree_fs_for(&self, root: &Path) -> Box<dyn WorkingTreeFs> {
        let _ = root;
        Box::new(LocalWorkingTreeFs)
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
        // Held across the whole walk-hash-write pass so a backgrounded
        // initial snapshot can't interleave with a save/compile commit.
        self.with_index(root, |index| {
            commit::commit_if_changed(root, &LocalWorkingTreeFs, index, trigger, message, retention)
        })
    }

    /// Queue an auto-snapshot gated by the user's [`SnapshotPolicy`], and
    /// return immediately. The snapshot itself is taken on a dedicated worker
    /// thread: walking the workspace must never sit on the save path or the
    /// compile worker, where a large tree used to stall both for seconds.
    ///
    /// Skips entirely when the relevant toggle is off; the
    /// `min_interval_seconds` throttle is applied by the worker, against the
    /// timestamp of the previous successful auto-snapshot.
    pub fn request_auto_snapshot(
        self: &Arc<Self>,
        trigger: CommitTrigger,
        message: &str,
        policy: &SnapshotPolicy,
    ) {
        if !policy.allows(trigger) {
            return;
        }
        let Some(root) = self.workspace_root() else {
            return;
        };
        let request = AutoSnapshotRequest {
            root,
            trigger,
            message: message.to_string(),
            policy: policy.clone(),
        };

        let mut tx = self.auto_tx.lock();
        if tx.is_none() {
            let (sender, receiver) = mpsc::channel();
            // Weak, so the worker never keeps the state alive: once the state
            // (and with it the sender) is dropped, `recv` fails and it exits.
            let state = Arc::downgrade(self);
            let spawned = std::thread::Builder::new()
                .name("vcs-auto-snapshot".into())
                .spawn(move || Self::run_auto_snapshot_worker(state, receiver));
            if let Err(err) = spawned {
                warn!("vcs::request_auto_snapshot: thread spawn failed err=\"{err}\"");
                return;
            }
            *tx = Some(sender);
        }
        if let Some(sender) = tx.as_ref() {
            if sender.send(request).is_err() {
                warn!("vcs::request_auto_snapshot: worker is gone, snapshot skipped");
            }
        }
    }

    fn run_auto_snapshot_worker(state: Weak<Self>, rx: Receiver<AutoSnapshotRequest>) {
        while let Ok(request) = rx.recv() {
            let Some(state) = state.upgrade() else {
                return;
            };
            if let Err(err) = state.auto_commit(&request) {
                warn!(
                    "vcs: {} auto-snapshot failed err=\"{err}\"",
                    request.trigger.tag()
                );
            }
        }
    }

    fn auto_commit(&self, request: &AutoSnapshotRequest) -> Result<(), String> {
        let policy = &request.policy;
        if policy.min_interval_seconds > 0 {
            if let Some(last) = *self.last_auto_snapshot.lock() {
                if last.elapsed().as_secs() < policy.min_interval_seconds as u64 {
                    return Ok(());
                }
            }
        }
        let result = self.commit_if_changed_for_root(
            &request.root,
            request.trigger,
            &request.message,
            &policy.retention,
        )?;
        if result.is_some() {
            *self.last_auto_snapshot.lock() = Some(Instant::now());
        }
        Ok(())
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
        let fs = LocalWorkingTreeFs;
        store::read_head(&fs, &root)
    }

    /// Return the snapshot history of the workspace, newest first.
    pub fn list_history(&self, limit: Option<usize>) -> Result<Vec<RestorePoint>, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        let fs = LocalWorkingTreeFs;
        history::list_history(&root, &fs, limit)
    }

    /// The file map of a snapshot: workspace-relative (forward-slash) path →
    /// blob hash. Deliberately *without* the blob bytes: a historical compile
    /// only reads the handful of files the document actually imports, so
    /// materializing the whole tree up front would be wasted work on any
    /// workspace with sizeable assets. Pair it with [`Self::read_object`].
    pub fn snapshot_files(&self, commit_id: &str) -> Result<SnapshotFiles, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        let fs = LocalWorkingTreeFs;
        Ok(store::find_snapshot_by_id(&fs, &root, commit_id)?.files)
    }

    /// Read one content-addressed blob out of the object store.
    pub fn read_object(&self, hash: &str) -> Result<Vec<u8>, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        let fs = LocalWorkingTreeFs;
        store::read_blob(&fs, &root, hash)
    }

    /// Diff a snapshot against the current working tree.
    pub fn diff_vs_current(&self, commit_id: &str) -> Result<WorkspaceDiff, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        let fs = LocalWorkingTreeFs;
        diff::diff_vs_current(&root, &fs, commit_id)
    }

    /// Diff two snapshots against each other.
    pub fn diff_between(&self, from_id: &str, to_id: &str) -> Result<WorkspaceDiff, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        let fs = LocalWorkingTreeFs;
        diff::diff_between(&root, &fs, from_id, to_id)
    }

    /// Restore the entire workspace to a given snapshot.
    pub fn restore_workspace(&self, commit_id: &str) -> Result<(), String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        // Under the commit lock, so a queued auto-snapshot can't walk the
        // tree while it is half restored.
        self.with_index(&root, |index| {
            restore::restore_workspace(&root, &LocalWorkingTreeFs, index, commit_id)
        })
    }

    /// Restore a single file from a snapshot, leaving the rest of the
    /// workspace alone.
    pub fn restore_file(&self, commit_id: &str, path: &str) -> Result<(), String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        self.with_index(&root, |index| {
            restore::restore_file(&root, &LocalWorkingTreeFs, index, commit_id, path)
        })
    }
}
