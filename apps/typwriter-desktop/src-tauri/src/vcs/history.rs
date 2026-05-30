// vcs/history.rs
//
// Walk the snapshot directory in reverse chronological order. "Changed files"
// for each entry is the per-path set-difference of its file map against its
// parent — the timeline UI uses this to color points by which files were
// touched.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use super::commit::{changed_files, CommitTrigger};
use super::fs::WorkingTreeFs;
use super::store::{read_all_snapshots, SnapshotManifest};

/// Single entry in the restore-point timeline.
#[derive(Serialize, Clone, Debug)]
pub struct RestorePoint {
    /// Hex snapshot id (sha-256, 64 chars).
    pub id: String,
    /// Parent snapshot id, if any.
    pub parent_id: Option<String>,
    /// Plain message (no trigger prefix — the trigger is its own field).
    pub message: String,
    /// Drives default coloring + iconography in the timeline.
    pub trigger: CommitTrigger,
    /// Seconds since the Unix epoch (matches the previous gix-based shape).
    pub timestamp_seconds: i64,
    /// Workspace-relative paths whose hash differs from the parent's. For the
    /// initial snapshot, every file is listed.
    pub changed_files: Vec<String>,
}

pub fn list_history(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    limit: Option<usize>,
) -> Result<Vec<RestorePoint>, String> {
    let all = read_all_snapshots(fs, workspace_root)?;
    if all.is_empty() {
        return Ok(Vec::new());
    }

    let by_id: HashMap<String, SnapshotManifest> = all
        .iter()
        .map(|(_, m)| (m.id.clone(), m.clone()))
        .collect();

    // `read_all_snapshots` returns oldest-first; the UI wants newest-first.
    let mut out = Vec::with_capacity(all.len());
    for (_, manifest) in all.into_iter().rev() {
        if let Some(cap) = limit {
            if out.len() >= cap {
                break;
            }
        }
        let parent = manifest.parent.as_deref().and_then(|p| by_id.get(p));
        let changed = changed_files(&manifest, parent);

        out.push(RestorePoint {
            id: manifest.id.clone(),
            parent_id: manifest.parent.clone(),
            message: manifest.message.clone(),
            trigger: manifest.trigger,
            timestamp_seconds: manifest.created_at_ms / 1000,
            changed_files: changed,
        });
    }
    Ok(out)
}
