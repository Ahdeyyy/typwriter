// vcs/history.rs
//
// Walk commits from HEAD backwards. Each commit's "changed files" are computed
// against its parent tree so the timeline can color points by which files
// were touched.

use std::path::{Path, PathBuf};

use gix::ObjectId;
use serde::Serialize;

use super::commit::CommitTrigger;
use super::repo::open_or_init;

/// A single tree entry, copied out of gix's borrowed `TreeRef` so we can hand
/// it across recursive boundaries without lifetime contortions. gix 0.66's
/// `TreeRef::to_owned()` resolves to the `Clone` blanket impl (returns
/// `TreeRef` again), so we eagerly project to this owned shape.
struct OwnedEntry {
    filename: String,
    oid: ObjectId,
    is_tree: bool,
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
        });
    }
    Ok(out)
}

/// Single entry in the restore-point timeline.
#[derive(Serialize, Clone, Debug)]
pub struct RestorePoint {
    /// Full hex commit id (40 chars).
    pub id: String,
    /// Parent commit id, if any.
    pub parent_id: Option<String>,
    /// Plain message with the `[trigger:_]` prefix stripped.
    pub message: String,
    /// Trigger parsed from the message, drives default coloring + iconography.
    pub trigger: CommitTrigger,
    /// Seconds since the Unix epoch.
    pub timestamp_seconds: i64,
    /// Workspace-relative paths whose tree entry differs from the parent's.
    /// For the initial commit, every file is listed.
    pub changed_files: Vec<String>,
}

/// Return commits in reverse chronological order, walking from HEAD.
/// `limit` caps the number of entries (None = unlimited).
pub fn list_history(
    workspace_root: &Path,
    limit: Option<usize>,
) -> Result<Vec<RestorePoint>, String> {
    let repo = open_or_init(workspace_root)?;

    let Some(head_id) = repo.head_id().ok().map(|id| id.detach()) else {
        return Ok(Vec::new());
    };

    let mut out: Vec<RestorePoint> = Vec::new();
    let mut cursor: Option<ObjectId> = Some(head_id);

    while let Some(commit_id) = cursor {
        if let Some(cap) = limit {
            if out.len() >= cap {
                break;
            }
        }

        let object = match repo.find_object(commit_id) {
            Ok(o) => o,
            Err(_) => break,
        };
        let commit = match object.try_into_commit() {
            Ok(c) => c,
            Err(_) => break,
        };

        let tree_id = commit.tree_id().map_err(|e| e.to_string())?.detach();
        let raw_message = commit
            .message_raw()
            .map(|b| b.to_string())
            .unwrap_or_default();
        let trigger = CommitTrigger::parse_from_message(&raw_message);
        let message = strip_trigger_prefix(&raw_message);
        let time = commit.time().map_err(|e| e.to_string())?;

        let parent_id: Option<ObjectId> = commit.parent_ids().next().map(|id| id.detach());

        let changed_files = match parent_id {
            Some(pid) => match commit_tree_id(&repo, pid) {
                Ok(parent_tree) => diff_trees(&repo, parent_tree, tree_id).unwrap_or_default(),
                Err(_) => Vec::new(),
            },
            None => list_tree_paths(&repo, tree_id).unwrap_or_default(),
        };

        out.push(RestorePoint {
            id: commit_id.to_hex().to_string(),
            parent_id: parent_id.map(|id| id.to_hex().to_string()),
            message,
            trigger,
            timestamp_seconds: time.seconds,
            changed_files,
        });

        cursor = parent_id;
    }

    Ok(out)
}

fn strip_trigger_prefix(msg: &str) -> String {
    // Strip the leading `[trigger:<tag>] ` if present; leave the rest verbatim.
    let trimmed = msg.trim_start();
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let inside = &rest[..end];
            if inside.starts_with("trigger:") {
                let after = &rest[end + 1..];
                return after.trim_start().to_string();
            }
        }
    }
    msg.to_string()
}

fn commit_tree_id(repo: &gix::Repository, commit_id: ObjectId) -> Result<ObjectId, String> {
    let object = repo
        .find_object(commit_id)
        .map_err(|e| format!("find_object(commit) failed: {e}"))?;
    let commit = object
        .try_into_commit()
        .map_err(|e| format!("not a commit: {e}"))?;
    Ok(commit.tree_id().map_err(|e| e.to_string())?.detach())
}

/// Naive recursive tree diff. We compare entries by filename: missing on
/// either side, or differing oid, both count as "changed". Returns paths
/// using forward slashes regardless of platform.
fn diff_trees(repo: &gix::Repository, a: ObjectId, b: ObjectId) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    diff_trees_inner(repo, a, b, &PathBuf::new(), &mut out)?;
    Ok(out)
}

fn diff_trees_inner(
    repo: &gix::Repository,
    a: ObjectId,
    b: ObjectId,
    prefix: &Path,
    out: &mut Vec<String>,
) -> Result<(), String> {
    let entries_a = read_tree_entries(repo, a)?;
    let entries_b = read_tree_entries(repo, b)?;

    use std::collections::BTreeMap;
    let map_a: BTreeMap<String, &OwnedEntry> =
        entries_a.iter().map(|e| (e.filename.clone(), e)).collect();
    let map_b: BTreeMap<String, &OwnedEntry> =
        entries_b.iter().map(|e| (e.filename.clone(), e)).collect();

    let mut all_keys: Vec<&String> = map_a.keys().chain(map_b.keys()).collect();
    all_keys.sort();
    all_keys.dedup();

    for name in all_keys {
        let path = prefix.join(name);
        match (map_a.get(name), map_b.get(name)) {
            (Some(ea), Some(eb)) => {
                if ea.oid == eb.oid && ea.is_tree == eb.is_tree {
                    continue;
                }
                if ea.is_tree && eb.is_tree {
                    diff_trees_inner(repo, ea.oid, eb.oid, &path, out)?;
                } else {
                    push_path(out, &path);
                }
            }
            (Some(ea), None) => {
                if ea.is_tree {
                    list_tree_paths_into(repo, ea.oid, &path, out)?;
                } else {
                    push_path(out, &path);
                }
            }
            (None, Some(eb)) => {
                if eb.is_tree {
                    list_tree_paths_into(repo, eb.oid, &path, out)?;
                } else {
                    push_path(out, &path);
                }
            }
            (None, None) => unreachable!(),
        }
    }
    Ok(())
}

fn push_path(out: &mut Vec<String>, p: &Path) {
    out.push(p.to_string_lossy().replace('\\', "/"));
}

/// List every file path in a tree (recursive). Used for "initial commit" where
/// there's no parent to diff against — we report all files as added.
fn list_tree_paths(repo: &gix::Repository, root: ObjectId) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    list_tree_paths_into(repo, root, &PathBuf::new(), &mut out)?;
    Ok(out)
}

fn list_tree_paths_into(
    repo: &gix::Repository,
    root: ObjectId,
    prefix: &Path,
    out: &mut Vec<String>,
) -> Result<(), String> {
    let entries = read_tree_entries(repo, root)?;
    for entry in &entries {
        let path = prefix.join(&entry.filename);
        if entry.is_tree {
            list_tree_paths_into(repo, entry.oid, &path, out)?;
        } else {
            push_path(out, &path);
        }
    }
    Ok(())
}
