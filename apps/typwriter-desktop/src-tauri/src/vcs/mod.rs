// vcs/mod.rs
//
// Local-only versioning system for a workspace. Every workspace gets a real
// `.git` repository in its root; "restore points" are just commits. We do not
// expose remotes — backup is the user's job (sync the folder yourself).
//
// Design choices worth keeping in mind:
//
//   * `gix` (gitoxide) is pure-Rust, so this works on Android without any
//     libgit2/system-git dependency.
//
//   * Commits are triggered by `save` and by successful compile. Both routes
//     funnel into [`VcsState::commit_if_changed`], which compares the working
//     tree's hash against HEAD and short-circuits when nothing changed. That
//     dedupe is what keeps the history clean despite two triggers firing
//     within the same edit.
//
//   * `.typwriter/` and `.git/` are ignored when staging — the preview cache
//     and git's own metadata don't belong in history.
//
//   * "Changed files" for the timeline coloring comes from comparing each
//     commit's tree against its parent. The frontend hashes paths → colors;
//     the backend just lists names.
//
//   * Diffing returns raw before/after blob text per file. `@pierre/diff` on
//     the frontend renders the actual side-by-side / inline view.

mod commit;
mod diff;
mod history;
mod repo;
mod restore;

pub use commit::CommitTrigger;
#[allow(unused_imports)]
pub use diff::{FileDiff, FileDiffStatus, WorkspaceDiff};
pub use history::RestorePoint;

use std::path::{Path, PathBuf};

use log::{info, warn};
use parking_lot::RwLock;

/// Process-wide VCS coordinator. Holds the path of the open workspace so the
/// gix repo can be (re-)opened on demand without keeping a `Repository` handle
/// live across threads — gix repos are `!Send + !Sync` and we'd rather not
/// pay an `Arc<Mutex<_>>` wrapper on every read.
///
/// Lookups are cheap: `gix::open` is a header-read, not a full scan.
pub struct VcsState {
    root: RwLock<Option<PathBuf>>,
}

impl Default for VcsState {
    fn default() -> Self {
        Self::new()
    }
}

impl VcsState {
    pub fn new() -> Self {
        Self {
            root: RwLock::new(None),
        }
    }

    /// Bind the VCS to a workspace root. Initializes the repo if missing and
    /// records an initial restore point so the history view is never empty
    /// (better UX than "no commits yet"). Errors are logged and swallowed —
    /// versioning failing must never block opening a workspace.
    pub fn attach(&self, workspace_root: &Path) {
        *self.root.write() = Some(workspace_root.to_path_buf());

        match repo::open_or_init(workspace_root) {
            Ok(_repo) => {
                info!("vcs::attach: repo ok root={workspace_root:?}");
                // Seed the timeline with an initial commit if HEAD is unborn.
                // Either succeeds or we just live without one; not fatal.
                if let Err(err) =
                    self.commit_if_changed(CommitTrigger::Initial, "Initial restore point")
                {
                    warn!("vcs::attach: initial commit skipped err=\"{err}\"");
                }
            }
            Err(err) => {
                warn!("vcs::attach: open_or_init failed root={workspace_root:?} err=\"{err}\"");
            }
        }
    }

    /// Current workspace root, if attached.
    fn workspace_root(&self) -> Option<PathBuf> {
        self.root.read().clone()
    }

    /// Create a commit iff the working tree differs from HEAD. Returns the
    /// new commit's hex id, or `None` when there was nothing to commit.
    ///
    /// Used by the auto-commit hooks (save, compile-success). Quiet when
    /// no workspace is attached — versioning is opt-in by workspace.
    pub fn commit_if_changed(
        &self,
        trigger: CommitTrigger,
        message: &str,
    ) -> Result<Option<String>, String> {
        let Some(root) = self.workspace_root() else {
            return Ok(None);
        };
        commit::commit_if_changed(&root, trigger, message)
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

    /// Return the commit history of the workspace, newest first.
    pub fn list_history(&self, limit: Option<usize>) -> Result<Vec<RestorePoint>, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        history::list_history(&root, limit)
    }

    /// Diff a restore point against the current working tree.
    pub fn diff_vs_current(&self, commit_id: &str) -> Result<WorkspaceDiff, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        diff::diff_vs_current(&root, commit_id)
    }

    /// Diff two restore points against each other.
    pub fn diff_between(&self, from_id: &str, to_id: &str) -> Result<WorkspaceDiff, String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        diff::diff_between(&root, from_id, to_id)
    }

    /// Restore the entire workspace to a given commit. Records a safety
    /// commit of the current state first so the action is reversible.
    pub fn restore_workspace(&self, commit_id: &str) -> Result<(), String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        restore::restore_workspace(&root, commit_id)
    }

    /// Restore a single file from a commit, leaving the rest of the workspace
    /// alone.
    pub fn restore_file(&self, commit_id: &str, path: &str) -> Result<(), String> {
        let root = self.workspace_root().ok_or("No workspace open")?;
        restore::restore_file(&root, commit_id, path)
    }
}
