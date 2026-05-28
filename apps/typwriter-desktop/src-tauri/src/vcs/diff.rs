// vcs/diff.rs
//
// Resolve a commit (or pair of commits) into a list of per-file diffs that
// the frontend can render with @pierre/diff. Each file entry carries both
// before/after blob contents; the actual line-diff is computed in JS.
//
// Files larger than `MAX_TEXT_BYTES` or containing NUL bytes are flagged
// as binary so the renderer can show a stub instead of dumping bytes.

use std::path::{Path, PathBuf};

use gix::ObjectId;
use serde::Serialize;

use super::{
    fs::WorkingTreeFs,
    repo::{open_or_init, IGNORED_TOP_LEVEL},
};

/// Anything bigger than this we treat as "too large to diff inline". Keeps
/// the IPC payload reasonable and avoids choking the renderer on huge logs.
const MAX_TEXT_BYTES: usize = 256 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FileDiffStatus {
    Added,
    Removed,
    Modified,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileDiff {
    /// Workspace-relative, forward-slash path.
    pub path: String,
    pub status: FileDiffStatus,
    /// `true` when either side is non-UTF-8 or above the size cap.
    pub binary: bool,
    /// UTF-8 content at the "from" side, or `None` if the file was added.
    pub before: Option<String>,
    /// UTF-8 content at the "to" side, or `None` if the file was removed.
    pub after: Option<String>,
    pub before_bytes: usize,
    pub after_bytes: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct WorkspaceDiff {
    pub files: Vec<FileDiff>,
}

/// Diff between a commit and the current working tree. The commit is the
/// `before`; the working tree (what the user sees right now) is the `after`.
pub fn diff_vs_current(
    repo_root: &Path,
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    commit_id: &str,
) -> Result<WorkspaceDiff, String> {
    let repo = open_or_init(repo_root)?;
    let from_oid = parse_commit_id(commit_id)?;
    let from_tree = commit_tree(&repo, from_oid)?;
    let from_files = collect_tree_files(&repo, from_tree)?;
    let cur_files = collect_working_files(workspace_root, fs)?;

    let mut files: Vec<FileDiff> = Vec::new();
    let names: Vec<String> = merged_names(&from_files, &cur_files);
    for name in names {
        let before = from_files.iter().find(|f| f.path == name).cloned();
        let after = cur_files.iter().find(|f| f.path == name).cloned();
        if let Some(d) = build_diff(&name, before, after) {
            files.push(d);
        }
    }
    Ok(WorkspaceDiff { files })
}

/// Diff between two commits. `from` is the `before` side, `to` is the `after`.
pub fn diff_between(repo_root: &Path, from_id: &str, to_id: &str) -> Result<WorkspaceDiff, String> {
    let repo = open_or_init(repo_root)?;
    let from_oid = parse_commit_id(from_id)?;
    let to_oid = parse_commit_id(to_id)?;
    let from_tree = commit_tree(&repo, from_oid)?;
    let to_tree = commit_tree(&repo, to_oid)?;
    let from_files = collect_tree_files(&repo, from_tree)?;
    let to_files = collect_tree_files(&repo, to_tree)?;

    let mut files: Vec<FileDiff> = Vec::new();
    let names = merged_names(&from_files, &to_files);
    for name in names {
        let before = from_files.iter().find(|f| f.path == name).cloned();
        let after = to_files.iter().find(|f| f.path == name).cloned();
        if let Some(d) = build_diff(&name, before, after) {
            files.push(d);
        }
    }
    Ok(WorkspaceDiff { files })
}

// ─── Internal types ──────────────────────────────────────────────────────────

#[derive(Clone)]
struct FileBytes {
    path: String,
    bytes: Vec<u8>,
}

fn merged_names(a: &[FileBytes], b: &[FileBytes]) -> Vec<String> {
    use std::collections::BTreeSet;
    let mut set: BTreeSet<String> = BTreeSet::new();
    for f in a {
        set.insert(f.path.clone());
    }
    for f in b {
        set.insert(f.path.clone());
    }
    set.into_iter().collect()
}

fn build_diff(name: &str, before: Option<FileBytes>, after: Option<FileBytes>) -> Option<FileDiff> {
    let (status, before_bytes, after_bytes) = match (&before, &after) {
        (Some(a), Some(b)) => {
            if a.bytes == b.bytes {
                return None;
            }
            (FileDiffStatus::Modified, a.bytes.len(), b.bytes.len())
        }
        (Some(a), None) => (FileDiffStatus::Removed, a.bytes.len(), 0),
        (None, Some(b)) => (FileDiffStatus::Added, 0, b.bytes.len()),
        (None, None) => return None,
    };

    let (before_str, before_binary) = before
        .as_ref()
        .map(|f| decode(&f.bytes))
        .map(|(s, b)| (Some(s), b))
        .unwrap_or((None, false));
    let (after_str, after_binary) = after
        .as_ref()
        .map(|f| decode(&f.bytes))
        .map(|(s, b)| (Some(s), b))
        .unwrap_or((None, false));

    let binary = before_binary || after_binary;
    Some(FileDiff {
        path: name.to_string(),
        status,
        binary,
        before: if binary { None } else { before_str },
        after: if binary { None } else { after_str },
        before_bytes,
        after_bytes,
    })
}

/// Heuristic: treat content as binary if it's too large to send back over
/// IPC or contains a NUL byte in the first 8 KB. Returns the decoded UTF-8
/// representation when it's safe to display.
fn decode(bytes: &[u8]) -> (String, bool) {
    if bytes.len() > MAX_TEXT_BYTES {
        return (String::new(), true);
    }
    let probe_end = bytes.len().min(8 * 1024);
    if bytes[..probe_end].contains(&0) {
        return (String::new(), true);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), false),
        Err(_) => (String::new(), true),
    }
}

// ─── Tree → files ───────────────────────────────────────────────────────────

fn parse_commit_id(s: &str) -> Result<ObjectId, String> {
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

fn collect_tree_files(repo: &gix::Repository, root: ObjectId) -> Result<Vec<FileBytes>, String> {
    let mut out = Vec::new();
    collect_tree_into(repo, root, &PathBuf::new(), &mut out)?;
    Ok(out)
}

/// Owned projection of a tree entry. See `history.rs` for context on why
/// gix's `TreeRef::to_owned()` doesn't give us what we'd want here.
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

fn collect_tree_into(
    repo: &gix::Repository,
    tree_id: ObjectId,
    prefix: &Path,
    out: &mut Vec<FileBytes>,
) -> Result<(), String> {
    let entries = read_tree_entries(repo, tree_id)?;
    for entry in entries {
        let path = prefix.join(&entry.filename);
        if entry.is_tree {
            collect_tree_into(repo, entry.oid, &path, out)?;
        } else if entry.is_blob {
            let blob = repo
                .find_object(entry.oid)
                .map_err(|e| format!("find_object(blob) failed: {e}"))?;
            let bytes = blob
                .try_into_blob()
                .map_err(|e| format!("not a blob: {e}"))?
                .data
                .clone();
            out.push(FileBytes {
                path: path.to_string_lossy().replace('\\', "/"),
                bytes,
            });
        }
    }
    Ok(())
}

fn collect_working_files(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
) -> Result<Vec<FileBytes>, String> {
    let mut out = Vec::new();
    collect_working_into(workspace_root, workspace_root, fs, &mut out)?;
    Ok(out)
}

fn collect_working_into(
    workspace_root: &Path,
    dir: &Path,
    fs: &impl WorkingTreeFs,
    out: &mut Vec<FileBytes>,
) -> Result<(), String> {
    let read = fs.read_dir(dir)?;
    for entry in read {
        let name_str = entry.name;
        if dir == workspace_root && IGNORED_TOP_LEVEL.contains(&name_str.as_str()) {
            continue;
        }
        if entry.is_dir {
            collect_working_into(workspace_root, &entry.path, fs, out)?;
        } else if entry.is_file {
            let bytes = fs.read_file(&entry.path)?;
            let rel = entry
                .path
                .strip_prefix(workspace_root)
                .map_err(|_| format!("path outside root: {:?}", entry.path))?;
            out.push(FileBytes {
                path: rel.to_string_lossy().replace('\\', "/"),
                bytes,
            });
        }
    }
    Ok(())
}
