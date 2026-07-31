// Two operations: restore the whole workspace to a snapshot, or restore a
// single file. Both record a safety `PreRestore` snapshot of the current
// state first so the user can step back if they restored the wrong point.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use log::{error, info};

use super::commit::{commit_if_changed, CommitTrigger};
use super::fs::WorkingTreeFs;
use super::paths::IGNORED_TOP_LEVEL;
use super::retention::RetentionPolicy;
use super::store::{find_snapshot_by_id, read_blob};

/// Restore the working tree to match `commit_id`.
///
/// Safety: snapshot the current state as a `PreRestore` first (so the prior
/// state is still reachable in history), then write each blob to disk and
/// remove any path that exists locally but isn't in the target.
///
/// `.git/` and `.typwriter/` are skipped on both sides — restoring must
/// never wipe our own metadata.
pub fn restore_workspace(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    commit_id: &str,
) -> Result<(), String> {
    // Safety snapshot. If it skips because nothing changed since HEAD,
    // that's still fine — HEAD itself is the rollback target. Real failures
    // must abort before we touch the working tree.
    commit_if_changed(
        workspace_root,
        fs,
        CommitTrigger::PreRestore,
        "Pre-restore snapshot",
        &RetentionPolicy::unlimited(),
    )?;

    let target = find_snapshot_by_id(fs, workspace_root, commit_id)?;

    // Enumerate current working files so we know what to delete after the
    // target's files are written.
    let mut current_files: Vec<PathBuf> = Vec::new();
    walk_working(workspace_root, workspace_root, fs, &mut current_files)?;

    // Write target files. Directories are created on demand; existing files
    // are overwritten in place.
    for (rel, hash) in &target.files {
        let bytes = read_blob(fs, workspace_root, hash)?;
        let abs = workspace_root.join(rel);
        if let Some(parent) = abs.parent() {
            fs.create_dir_all(parent)?;
        }
        fs.write_file(&abs, &bytes)?;
    }

    let target_set: BTreeSet<String> = target.files.keys().cloned().collect();

    let mut delete_failures: Vec<(PathBuf, String)> = Vec::new();
    for cur in current_files {
        let rel = cur.to_string_lossy().replace('\\', "/");
        if !target_set.contains(&rel) {
            let abs = workspace_root.join(&cur);
            if let Err(e) = fs.remove_file(&abs) {
                error!("vcs::restore_workspace: failed to remove {abs:?}: {e}");
                delete_failures.push((abs, e));
                continue;
            }
            prune_empty_parents(fs, workspace_root, &workspace_root.join(&cur));
        }
    }

    if !delete_failures.is_empty() {
        let (first_path, first_err) = &delete_failures[0];
        return Err(format!(
            "restore to {} incomplete: {} file(s) could not be removed (first: {:?}: {})",
            commit_id,
            delete_failures.len(),
            first_path,
            first_err
        ));
    }

    // Advance HEAD to the restored snapshot, so subsequent diffs and the
    // timeline cursor reflect "you are now at this point".
    super::store::write_head(fs, workspace_root, &target.id)?;

    info!(
        "vcs::restore_workspace: restored to {} ({} file(s))",
        commit_id,
        target.files.len()
    );
    Ok(())
}

/// Restore a single file. The rest of the workspace is left alone. If the
/// file didn't exist in the target snapshot, this becomes a delete.
pub fn restore_file(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    commit_id: &str,
    rel_path: &str,
) -> Result<(), String> {
    let target_path = normalize_restore_path(rel_path)?;
    let abs = workspace_child_path(workspace_root, &target_path)?;

    commit_if_changed(
        workspace_root,
        fs,
        CommitTrigger::PreRestore,
        &format!("Pre-restore (single file): {rel_path}"),
        &RetentionPolicy::unlimited(),
    )?;

    let target = find_snapshot_by_id(fs, workspace_root, commit_id)?;
    let path_key = target_path.to_string_lossy().replace('\\', "/");

    match target.files.get(&path_key) {
        Some(hash) => {
            let bytes = read_blob(fs, workspace_root, hash)?;
            if let Some(parent) = abs.parent() {
                ensure_existing_ancestor_within_workspace(fs, workspace_root, parent)?;
                fs.create_dir_all(parent)?;
            }
            fs.write_file(&abs, &bytes)?;
            info!("vcs::restore_file: restored {rel_path} from {commit_id}");
        }
        None => {
            // File didn't exist at that point → restore = delete locally. If
            // it's already absent we're done; otherwise a failed remove must
            // be reported so the caller knows on-disk state still diverges.
            if fs.exists(&abs) {
                fs.remove_file(&abs).map_err(|e| {
                    error!("vcs::restore_file: failed to remove {abs:?}: {e}");
                    e
                })?;
            }
            info!("vcs::restore_file: deleted {rel_path} (absent in {commit_id})");
        }
    }
    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn normalize_restore_path(rel_path: &str) -> Result<PathBuf, String> {
    let normalized = rel_path.trim_start_matches(['/', '\\']).replace('\\', "/");
    if normalized.is_empty() {
        return Err("invalid restore path: empty path".into());
    }

    // `Path::components()` silently skips interior `.` segments, so it can't
    // be the only check: a `.` or `..` (or empty) segment must be rejected
    // outright — otherwise the un-normalized string leaks into snapshot keys
    // and never matches the stored `docs/main.typ` form.
    let segments_ok = normalized
        .split('/')
        .all(|segment| !segment.is_empty() && segment != "." && segment != "..");

    let path = PathBuf::from(&normalized);
    if segments_ok
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        Ok(path)
    } else {
        Err(format!(
            "invalid restore path {rel_path:?}: path must stay within the workspace"
        ))
    }
}

fn workspace_child_path(workspace_root: &Path, rel_path: &Path) -> Result<PathBuf, String> {
    let abs = workspace_root.join(rel_path);
    if abs.starts_with(workspace_root) {
        Ok(abs)
    } else {
        Err(format!(
            "restore path {rel_path:?} resolves outside workspace {workspace_root:?}"
        ))
    }
}

fn ensure_existing_ancestor_within_workspace(
    fs: &impl WorkingTreeFs,
    workspace_root: &Path,
    parent: &Path,
) -> Result<(), String> {
    let mut ancestor = parent;
    while !fs.exists(ancestor) {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| format!("restore parent {parent:?} has no existing ancestor"))?;
    }

    if ancestor.starts_with(workspace_root) {
        Ok(())
    } else {
        Err(format!(
            "restore parent {parent:?} resolves outside workspace {workspace_root:?}"
        ))
    }
}

fn walk_working(
    workspace_root: &Path,
    dir: &Path,
    fs: &impl WorkingTreeFs,
    out: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = fs.read_dir(dir)?;
    for entry in entries {
        if dir == workspace_root && IGNORED_TOP_LEVEL.contains(&entry.name.as_str()) {
            continue;
        }
        if entry.is_dir {
            walk_working(workspace_root, &entry.path, fs, out)?;
        } else if entry.is_file {
            if let Ok(rel) = entry.path.strip_prefix(workspace_root) {
                out.push(rel.to_path_buf());
            }
        }
    }
    Ok(())
}

fn prune_empty_parents(fs: &impl WorkingTreeFs, workspace_root: &Path, file: &Path) {
    let mut cur = file.parent();
    while let Some(dir) = cur {
        if dir == workspace_root {
            break;
        }
        match fs.read_dir(dir) {
            Ok(entries) if entries.is_empty() => {}
            Ok(_) => break,
            Err(_) => break,
        }
        if fs.remove_dir(dir).is_err() {
            break;
        }
        cur = dir.parent();
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_restore_path;
    use std::path::PathBuf;

    #[test]
    fn normalize_restore_path_allows_workspace_relative_paths() {
        assert_eq!(
            normalize_restore_path("docs/main.typ"),
            Ok(PathBuf::from("docs/main.typ"))
        );
        assert_eq!(
            normalize_restore_path("/docs\\main.typ"),
            Ok(PathBuf::from("docs/main.typ"))
        );
    }

    #[test]
    fn normalize_restore_path_rejects_traversal() {
        assert!(normalize_restore_path("../important_file").is_err());
        assert!(normalize_restore_path("docs/../../important_file").is_err());
    }

    #[test]
    fn normalize_restore_path_rejects_empty_and_current_dir_paths() {
        assert!(normalize_restore_path("").is_err());
        assert!(normalize_restore_path(".").is_err());
        assert!(normalize_restore_path("docs/./main.typ").is_err());
    }
}
