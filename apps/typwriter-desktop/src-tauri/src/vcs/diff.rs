// vcs/diff.rs
//
// Diff a snapshot against the working tree, or against another snapshot.
// Each file entry carries both before/after blob contents; the actual
// line-diff is computed in JS by `@pierre/diff` on the frontend.
//
// Files larger than `MAX_TEXT_BYTES` or containing NUL bytes are flagged as
// binary so the renderer can show a stub instead of dumping bytes.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use super::fs::WorkingTreeFs;
use super::paths::IGNORED_TOP_LEVEL;
use super::store::{find_snapshot_by_id, read_blob};

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

/// Diff a snapshot against the current working tree. The snapshot is the
/// `before`; the working tree (what the user sees now) is the `after`.
pub fn diff_vs_current(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    commit_id: &str,
) -> Result<WorkspaceDiff, String> {
    let manifest = find_snapshot_by_id(fs, workspace_root, commit_id)?;
    let from_files = load_snapshot_bytes(fs, workspace_root, &manifest.files)?;
    let cur_files = collect_working_files(workspace_root, fs)?;
    Ok(build_diff(from_files, cur_files))
}

/// Diff two snapshots.
pub fn diff_between(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
    from_id: &str,
    to_id: &str,
) -> Result<WorkspaceDiff, String> {
    let from = find_snapshot_by_id(fs, workspace_root, from_id)?;
    let to = find_snapshot_by_id(fs, workspace_root, to_id)?;
    let from_files = load_snapshot_bytes(fs, workspace_root, &from.files)?;
    let to_files = load_snapshot_bytes(fs, workspace_root, &to.files)?;
    Ok(build_diff(from_files, to_files))
}

// ─── Internal ───────────────────────────────────────────────────────────────

fn load_snapshot_bytes(
    fs: &impl WorkingTreeFs,
    workspace_root: &Path,
    files: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut out = BTreeMap::new();
    for (path, hash) in files {
        let bytes = read_blob(fs, workspace_root, hash)?;
        out.insert(path.clone(), bytes);
    }
    Ok(out)
}

fn build_diff(
    from: BTreeMap<String, Vec<u8>>,
    to: BTreeMap<String, Vec<u8>>,
) -> WorkspaceDiff {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut names: Vec<&String> = from.keys().chain(to.keys()).collect();
    names.sort();
    names.dedup();

    for name in names {
        let before = from.get(name);
        let after = to.get(name);
        if let Some(d) = file_diff(name, before, after) {
            files.push(d);
        }
    }
    WorkspaceDiff { files }
}

fn file_diff(name: &str, before: Option<&Vec<u8>>, after: Option<&Vec<u8>>) -> Option<FileDiff> {
    let (status, before_bytes, after_bytes) = match (before, after) {
        (Some(a), Some(b)) => {
            if a == b {
                return None;
            }
            (FileDiffStatus::Modified, a.len(), b.len())
        }
        (Some(a), None) => (FileDiffStatus::Removed, a.len(), 0),
        (None, Some(b)) => (FileDiffStatus::Added, 0, b.len()),
        (None, None) => return None,
    };

    let (before_str, before_binary) = before
        .map(|f| decode(f))
        .map(|(s, b)| (Some(s), b))
        .unwrap_or((None, false));
    let (after_str, after_binary) = after
        .map(|f| decode(f))
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

/// Heuristic: treat content as binary if it's too large to send over IPC or
/// contains a NUL byte in the first 8 KB.
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

fn collect_working_files(
    workspace_root: &Path,
    fs: &impl WorkingTreeFs,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut out = BTreeMap::new();
    collect_into(workspace_root, workspace_root, fs, &mut out)?;
    Ok(out)
}

fn collect_into(
    workspace_root: &Path,
    dir: &Path,
    fs: &impl WorkingTreeFs,
    out: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    let entries = fs.read_dir(dir)?;
    for entry in entries {
        if dir == workspace_root && IGNORED_TOP_LEVEL.contains(&entry.name.as_str()) {
            continue;
        }
        if entry.is_dir {
            collect_into(workspace_root, &entry.path, fs, out)?;
        } else if entry.is_file {
            let bytes = fs.read_file(&entry.path)?;
            let rel = match entry.path.strip_prefix(workspace_root) {
                Ok(p) => p.to_path_buf(),
                Err(_) => continue,
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            out.insert(rel_str, bytes);
        }
    }
    Ok(())
}
