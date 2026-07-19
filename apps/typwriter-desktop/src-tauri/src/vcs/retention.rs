// Pruning policy applied after every successful commit. Manual / Initial /
// PreRestore snapshots are always preserved; auto-snapshots (Save / Compile)
// are subject to the user's configured caps.

use std::collections::HashSet;
use std::path::Path;

use super::fs::WorkingTreeFs;
use super::store::{delete_snapshot_file, read_all_snapshots, sweep_unreferenced_objects};

/// User-configurable bounds on history size. A `0` for either field means
/// "no cap" — matches the previous gix behaviour of keeping everything.
#[derive(Clone, Copy, Debug)]
pub struct RetentionPolicy {
    /// Maximum number of *auto* snapshots to keep. Manual / Initial /
    /// PreRestore don't count against this.
    pub max_auto_count: u32,
    /// Maximum age of *auto* snapshots, in days. Older auto-snapshots get
    /// pruned even if they're under the count cap.
    pub max_auto_age_days: u32,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            max_auto_count: 0,
            max_auto_age_days: 0,
        }
    }
}

impl RetentionPolicy {
    pub fn unlimited() -> Self {
        Self::default()
    }

    fn caps_anything(self) -> bool {
        self.max_auto_count > 0 || self.max_auto_age_days > 0
    }
}

/// Apply the retention policy: drop auto-snapshots that exceed the count or
/// age caps, then GC orphaned blob objects. HEAD is never pruned (the user
/// would be left looking at history that says "you have no current point").
pub fn prune_snapshots(
    fs: &impl WorkingTreeFs,
    workspace_root: &Path,
    policy: &RetentionPolicy,
) -> Result<(), String> {
    if !policy.caps_anything() {
        return Ok(());
    }

    let head = super::store::read_head(fs, workspace_root)?;
    let all = read_all_snapshots(fs, workspace_root)?;
    if all.is_empty() {
        return Ok(());
    }

    // Index by id so we can decide what to keep without re-reading anything.
    let mut auto: Vec<(std::path::PathBuf, super::store::SnapshotManifest)> = Vec::new();
    let mut keep_ids: HashSet<String> = HashSet::new();
    for (path, manifest) in &all {
        if manifest.trigger.is_preserved() || Some(&manifest.id) == head.as_ref() {
            keep_ids.insert(manifest.id.clone());
        } else {
            auto.push((path.clone(), manifest.clone()));
        }
    }

    // Oldest first (read_all_snapshots already sorts by filename, which is
    // chronological).
    let cutoff_ms = if policy.max_auto_age_days > 0 {
        let now_ms = super::commit::now_ms();
        Some(now_ms - (policy.max_auto_age_days as i64) * 86_400_000)
    } else {
        None
    };

    // First pass: mark age-pruned candidates. Then enforce the count cap on
    // whatever remains.
    let mut survivors: Vec<(std::path::PathBuf, super::store::SnapshotManifest)> = Vec::new();
    let mut to_delete: Vec<std::path::PathBuf> = Vec::new();
    for (path, manifest) in auto {
        if let Some(cutoff) = cutoff_ms {
            if manifest.created_at_ms < cutoff {
                to_delete.push(path);
                continue;
            }
        }
        survivors.push((path, manifest));
    }

    if policy.max_auto_count > 0 {
        let cap = policy.max_auto_count as usize;
        if survivors.len() > cap {
            let extra = survivors.len() - cap;
            for (path, _) in survivors.drain(..extra) {
                to_delete.push(path);
            }
        }
    }

    for (_, manifest) in &survivors {
        keep_ids.insert(manifest.id.clone());
    }

    for path in &to_delete {
        if let Err(err) = delete_snapshot_file(fs, path) {
            log::warn!("vcs::prune: delete {path:?}: {err}");
        }
    }

    // After dropping manifests, sweep orphaned objects.
    let referenced_blobs = collect_referenced_blobs(fs, workspace_root, &keep_ids)?;
    let removed = sweep_unreferenced_objects(fs, workspace_root, &referenced_blobs)?;
    if !to_delete.is_empty() || removed > 0 {
        log::info!(
            "vcs::prune: {} snapshot(s) and {} object(s) removed",
            to_delete.len(),
            removed
        );
    }
    Ok(())
}

fn collect_referenced_blobs(
    fs: &impl WorkingTreeFs,
    workspace_root: &Path,
    keep_ids: &HashSet<String>,
) -> Result<HashSet<String>, String> {
    let mut out = HashSet::new();
    for (_, manifest) in read_all_snapshots(fs, workspace_root)? {
        if !keep_ids.contains(&manifest.id) {
            continue;
        }
        for hash in manifest.files.values() {
            out.insert(hash.clone());
        }
    }
    Ok(out)
}
