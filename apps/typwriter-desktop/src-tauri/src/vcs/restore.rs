// vcs/restore.rs
//
// Two operations: restore the whole workspace to a commit, or restore a
// single file. Both record a safety commit of the current state first so the
// user can step back if they restored the wrong point.

use std::path::{Component, Path, PathBuf};

use gix::ObjectId;
use log::info;

use super::{
    commit::{commit_if_changed, CommitTrigger},
    fs::WorkingTreeFs,
    repo::{open_or_init, IGNORED_TOP_LEVEL},
};

/// Restore the working tree to match the tree of `commit_id`.
///
/// Safety: we first snapshot the current state (regardless of whether
/// anything had changed since HEAD) as a `pre-restore` commit, so the
/// previous state is still reachable in history. Then we walk the target
/// tree, write each blob to disk, and delete any path that exists locally
/// but isn't in the target.
///
/// `.git/` and `.typwriter/` are skipped on both the read and write sides.
pub fn restore_workspace(
    repo_root: &Path,
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    commit_id: &str,
) -> Result<(), String> {
    // If it skips because there's nothing to commit, that's still fine — the
    // user can already step back via HEAD. Real snapshot failures must abort
    // before we overwrite the working tree.
    commit_if_changed(
        repo_root,
        workspace_root,
        fs,
        CommitTrigger::PreRestore,
        "Pre-restore snapshot",
    )?;

    let repo = open_or_init(repo_root)?;
    let target_commit = parse_oid(commit_id)?;
    let target_tree = commit_tree(&repo, target_commit)?;

    // First pass: collect every path in the target. This is also what we'll
    // use to detect deletions (anything on disk not in `targets` gets
    // removed).
    let mut target_files: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    walk_tree(&repo, target_tree, &PathBuf::new(), &mut target_files)?;

    // Second pass: enumerate current working files (minus ignored dirs).
    let mut current_files: Vec<PathBuf> = Vec::new();
    walk_dir(fs, workspace_root, workspace_root, &mut current_files)?;

    use std::collections::BTreeSet;
    let target_set: BTreeSet<&PathBuf> = target_files.iter().map(|(p, _)| p).collect();

    // Write target files. Directories are created on demand. Existing files
    // are overwritten in place; new ones are created.
    for (rel, bytes) in &target_files {
        let abs = workspace_root.join(rel);
        if let Some(parent) = abs.parent() {
            fs.create_dir_all(parent)?;
        }
        fs.write_file(&abs, bytes)?;
    }

    // Remove anything that exists on disk but not in the target.
    for cur in current_files {
        if !target_set.contains(&cur) {
            let abs = workspace_root.join(&cur);
            let _ = fs.remove_file(&abs);
            // Best-effort cleanup of now-empty parent dirs. Stops at the
            // workspace root so we don't wipe sibling content.
            prune_empty_parents(fs, workspace_root, &abs);
        }
    }

    info!(
        "vcs::restore_workspace: restored to {} ({} file(s))",
        commit_id,
        target_files.len()
    );
    Ok(())
}

/// Restore a single file from a commit. The rest of the workspace is left
/// alone. If the file doesn't exist in the target, restore turns into a
/// delete — the caller can disambiguate via [`crate::vcs::diff_vs_current`]
/// before invoking this.
pub fn restore_file(
    repo_root: &Path,
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    commit_id: &str,
    rel_path: &str,
) -> Result<(), String> {
    let target_path = normalize_restore_path(rel_path)?;
    let abs = workspace_child_path(workspace_root, &target_path)?;

    commit_if_changed(
        repo_root,
        workspace_root,
        fs,
        CommitTrigger::PreRestore,
        &format!("Pre-restore (single file): {rel_path}"),
    )?;

    let repo = open_or_init(repo_root)?;
    let target_commit = parse_oid(commit_id)?;
    let target_tree = commit_tree(&repo, target_commit)?;

    match find_blob_at(&repo, target_tree, &target_path)? {
        Some(bytes) => {
            if let Some(parent) = abs.parent() {
                ensure_existing_ancestor_within_workspace(fs, workspace_root, parent)?;
                fs.create_dir_all(parent)?;
            }
            fs.write_file(&abs, &bytes)?;
            info!("vcs::restore_file: restored {rel_path} from {commit_id}");
        }
        None => {
            // File didn't exist at that point — restore = delete locally.
            let _ = fs.remove_file(&abs);
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

    let path = PathBuf::from(&normalized);
    if path
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

fn parse_oid(s: &str) -> Result<ObjectId, String> {
    ObjectId::from_hex(s.as_bytes()).map_err(|e| format!("invalid commit id {s:?}: {e}"))
}

fn commit_tree(repo: &gix::Repository, commit_id: ObjectId) -> Result<ObjectId, String> {
    let obj = repo
        .find_object(commit_id)
        .map_err(|e| format!("find_object(commit) failed: {e}"))?;
    let commit = obj
        .try_into_commit()
        .map_err(|e| format!("not a commit: {e}"))?;
    Ok(commit.tree_id().map_err(|e| e.to_string())?.detach())
}

/// Owned projection of a tree entry — see `history.rs` for why we don't
/// keep the borrowed `TreeRef` form around.
struct OwnedEntry {
    filename: String,
    oid: ObjectId,
    is_tree: bool,
    is_blob: bool,
}

fn read_tree_entries(repo: &gix::Repository, id: ObjectId) -> Result<Vec<OwnedEntry>, String> {
    let obj = repo
        .find_object(id)
        .map_err(|e| format!("find_object(tree) failed: {e}"))?;
    let tree = obj
        .try_into_tree()
        .map_err(|e| format!("not a tree: {e}"))?;
    let tree_ref = tree.decode().map_err(|e| format!("decode tree: {e}"))?;
    let mut out = Vec::new();
    for entry in tree_ref.entries.iter() {
        let Ok(name) = std::str::from_utf8(entry.filename.as_ref()) else {
            continue;
        };
        out.push(OwnedEntry {
            filename: name.to_string(),
            oid: entry.oid.to_owned(),
            is_tree: entry.mode.is_tree(),
            is_blob: entry.mode.is_blob(),
        });
    }
    Ok(out)
}

fn walk_tree(
    repo: &gix::Repository,
    tree_id: ObjectId,
    prefix: &Path,
    out: &mut Vec<(PathBuf, Vec<u8>)>,
) -> Result<(), String> {
    let entries = read_tree_entries(repo, tree_id)?;
    for entry in entries {
        let path = prefix.join(&entry.filename);
        if entry.is_tree {
            walk_tree(repo, entry.oid, &path, out)?;
        } else if entry.is_blob {
            let blob = repo
                .find_object(entry.oid)
                .map_err(|e| format!("find_object(blob) failed: {e}"))?;
            let bytes = blob
                .try_into_blob()
                .map_err(|e| format!("not a blob: {e}"))?
                .data
                .clone();
            out.push((path, bytes));
        }
    }
    Ok(())
}

fn walk_dir(
    fs: &impl WorkingTreeFs,
    workspace_root: &Path,
    dir: &Path,
    out: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let read = fs.read_dir(dir)?;
    for entry in read {
        let name_str = entry.name;
        if dir == workspace_root && IGNORED_TOP_LEVEL.contains(&name_str.as_str()) {
            continue;
        }
        if entry.is_dir {
            walk_dir(fs, workspace_root, &entry.path, out)?;
        } else if entry.is_file {
            if let Ok(rel) = entry.path.strip_prefix(workspace_root) {
                out.push(rel.to_path_buf());
            }
        }
    }
    Ok(())
}

fn find_blob_at(
    repo: &gix::Repository,
    root: ObjectId,
    rel: &Path,
) -> Result<Option<Vec<u8>>, String> {
    let mut current = root;
    let components: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => s.to_str().map(String::from),
            _ => None,
        })
        .collect();
    if components.is_empty() {
        return Ok(None);
    }
    let last_idx = components.len() - 1;

    for (i, name) in components.iter().enumerate() {
        let entries = read_tree_entries(repo, current)?;
        let Some(entry) = entries.into_iter().find(|e| e.filename == *name) else {
            return Ok(None);
        };

        if i == last_idx {
            if !entry.is_blob {
                return Ok(None);
            }
            let blob = repo
                .find_object(entry.oid)
                .map_err(|e| format!("find_object(blob) failed: {e}"))?;
            let bytes = blob
                .try_into_blob()
                .map_err(|e| format!("not a blob: {e}"))?
                .data
                .clone();
            return Ok(Some(bytes));
        } else if entry.is_tree {
            current = entry.oid;
        } else {
            return Ok(None);
        }
    }
    Ok(None)
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
