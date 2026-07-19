// Build a snapshot from the working tree, dedupe against HEAD, persist
// manifest + new blobs, advance HEAD, then prune. Every read/write goes
// through `WorkingTreeFs`.

use std::collections::BTreeMap;
use std::path::Path;

use log::{debug, info};
use serde::{Deserialize, Serialize};

use super::fs::WorkingTreeFs;
use super::paths::IGNORED_TOP_LEVEL;
use super::retention::{prune_snapshots, RetentionPolicy};
use super::store::{
    build_manifest, find_snapshot_by_id, read_head, write_blob_if_missing,
    write_head, write_snapshot, SnapshotManifest,
};

/// What caused this snapshot. Stored as an enum field on the manifest (not
/// parsed out of a free-form commit message like the previous gix-based
/// system did) so the timeline UI doesn't depend on string format.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommitTrigger {
    /// First commit when history is initialized.
    Initial,
    /// User explicitly created a restore point.
    Manual,
    /// Triggered by saving a file.
    Save,
    /// Triggered by a successful compile.
    Compile,
    /// Snapshot of working state captured before restoring (safety net).
    PreRestore,
    /// Triggered by a structural file operation (create / delete / rename /
    /// move / import) so the change can be undone from the timeline.
    FileOp,
}

impl CommitTrigger {
    pub(crate) fn tag(self) -> &'static str {
        match self {
            CommitTrigger::Initial => "initial",
            CommitTrigger::Manual => "manual",
            CommitTrigger::Save => "save",
            CommitTrigger::Compile => "compile",
            CommitTrigger::PreRestore => "pre-restore",
            CommitTrigger::FileOp => "file-op",
        }
    }

    /// Manual / Initial / PreRestore / FileOp snapshots are user-driven or
    /// safety-critical — they never get pruned by retention rules. FileOp
    /// points record structural changes (delete / rename / move) and are the
    /// recovery anchor for them, so they must survive aggressive retention.
    pub fn is_preserved(self) -> bool {
        matches!(
            self,
            CommitTrigger::Manual
                | CommitTrigger::Initial
                | CommitTrigger::PreRestore
                | CommitTrigger::FileOp
        )
    }
}

/// Walk the working tree, hash every file, write blobs that aren't already in
/// the object store, and compare the resulting (path → hash) map against
/// HEAD. If identical, no-op. Otherwise persist the manifest and update HEAD.
///
/// Returns the new snapshot id, or `None` when there was nothing to commit.
pub fn commit_if_changed(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    trigger: CommitTrigger,
    message: &str,
    retention: &RetentionPolicy,
) -> Result<Option<String>, String> {
    let files = build_tree(workspace_root, fs)?;

    // Stash blobs first. If we're going to dedupe against HEAD we still want
    // these on disk — but in the dedupe case they were already there from
    // the previous snapshot, so this is mostly a no-op via `exists()`.

    let parent_id = read_head(fs, workspace_root)?;
    if let Some(parent) = parent_id.as_deref() {
        if let Ok(parent_manifest) = find_snapshot_by_id(fs, workspace_root, parent) {
            if parent_manifest.files == files {
                debug!("vcs::commit: working tree matches HEAD, skipping");
                return Ok(None);
            }
        }
    }

    let created_at_ms = now_ms();
    let manifest = build_manifest(
        parent_id.clone(),
        created_at_ms,
        trigger,
        message,
        files,
    );

    write_snapshot(fs, workspace_root, &manifest)?;
    write_head(fs, workspace_root, &manifest.id)?;

    let short = &manifest.id[..manifest.id.len().min(8)];
    info!("vcs::commit: {} {} -> {}", trigger.tag(), short, message);

    // Pruning runs after each successful commit. Failures here are logged
    // but never bubble — losing one prune pass is harmless, the next commit
    // will catch up.
    if let Err(err) = prune_snapshots(fs, workspace_root, retention) {
        log::warn!("vcs::commit: prune failed: {err}");
    }

    Ok(Some(manifest.id))
}

/// Recursively walk `workspace_root`, skipping the ignored top-level dirs,
/// and build a flat path → blob-hash map. Blob bytes are stored as a
/// side-effect (zstd-compressed, deduped by content).
fn build_tree(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    walk(workspace_root, workspace_root, fs, &mut out)?;
    Ok(out)
}

fn walk(
    workspace_root: &Path,
    dir: &Path,
    fs: &impl WorkingTreeFs,
    out: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    let entries = fs.read_dir(dir)?;
    for entry in entries {
        if dir == workspace_root && IGNORED_TOP_LEVEL.contains(&entry.name.as_str()) {
            continue;
        }
        if entry.is_dir {
            walk(workspace_root, &entry.path, fs, out)?;
        } else if entry.is_file {
            let bytes = fs.read_file(&entry.path)?;
            let hash = write_blob_if_missing(fs, workspace_root, &bytes)?;
            let rel = match entry.path.strip_prefix(workspace_root) {
                Ok(p) => p.to_path_buf(),
                Err(_) => continue,
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            out.insert(rel_str, hash);
        }
        // Symlinks etc. silently dropped — not relevant for our use case.
    }
    Ok(())
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Convenience: take a manifest and return paths whose hashes differ from
/// (or are absent in) the given parent map. Returns all paths if `parent`
/// is `None` (initial snapshot).
pub fn changed_files(
    manifest: &SnapshotManifest,
    parent: Option<&SnapshotManifest>,
) -> Vec<String> {
    let Some(parent) = parent else {
        return manifest.files.keys().cloned().collect();
    };
    let mut out = Vec::new();
    for (path, hash) in &manifest.files {
        if parent.files.get(path) != Some(hash) {
            out.push(path.clone());
        }
    }
    for path in parent.files.keys() {
        if !manifest.files.contains_key(path) {
            out.push(path.clone());
        }
    }
    out.sort();
    out.dedup();
    out
}
