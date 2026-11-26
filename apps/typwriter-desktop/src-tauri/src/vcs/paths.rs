// All snapshot data lives under `<workspace>/.typwriter/history/`. Keeping
// everything inside the workspace folder means snapshots travel with the
// folder when the user syncs / backs up / moves it — no "orphan on rename"
// problem like the previous gix-in-app-storage layout had.

use std::path::{Path, PathBuf};

/// Entries ignored when walking the workspace tree to build a snapshot. `.git`
/// is preserved in case the user runs git externally on desktop; `.typwriter`
/// is *our* metadata (preview cache + history itself) and must never recurse
/// into a commit.
///
/// Ignored at *any* depth, not just the top level: a subfolder that has been
/// opened as a workspace of its own carries its own `.typwriter`, and
/// snapshotting that copied megabytes of rendered previews — and another
/// history — into the parent's history on every change.
const IGNORED_NAMES: &[&str] = &[".git", ".typwriter"];

/// Whether a directory entry with this name is excluded from snapshots.
pub fn is_ignored_name(name: &str) -> bool {
    IGNORED_NAMES.contains(&name)
}

/// Whether a workspace-relative (forward-slash) path lies inside an ignored
/// directory. Snapshots written before the any-depth rule can still list such
/// paths; restore and diff use this to leave them alone.
pub fn is_ignored_rel(rel: &str) -> bool {
    rel.split('/').any(is_ignored_name)
}

/// `<root>/.typwriter/history/`
pub fn history_root(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".typwriter").join("history")
}

/// `<root>/.typwriter/history/HEAD` — single-line text file holding the hex
/// id of the latest snapshot, or absent when the history is empty.
pub fn head_file(workspace_root: &Path) -> PathBuf {
    history_root(workspace_root).join("HEAD")
}

/// `<root>/.typwriter/history/index.json` — the stat cache the snapshot walk
/// uses to skip re-hashing unchanged files. See [`super::index`].
pub fn index_file(workspace_root: &Path) -> PathBuf {
    history_root(workspace_root).join("index.json")
}

/// `<root>/.typwriter/history/snapshots/`
pub fn snapshots_dir(workspace_root: &Path) -> PathBuf {
    history_root(workspace_root).join("snapshots")
}

/// `<root>/.typwriter/history/objects/`
pub fn objects_dir(workspace_root: &Path) -> PathBuf {
    history_root(workspace_root).join("objects")
}

/// Object on disk: `objects/<aa>/<bb...rest>`. The 2-char fanout keeps any
/// single directory from blowing up — filesystems get slow when a directory
/// holds tens of thousands of entries.
pub fn object_path(workspace_root: &Path, hash: &str) -> PathBuf {
    let (prefix, rest) = hash.split_at(2);
    objects_dir(workspace_root).join(prefix).join(rest)
}

/// Snapshot manifest filename: `<13-digit-ms>_<8char-id>.json`. The leading
/// timestamp gives us a free chronological sort from the filesystem listing,
/// so `list_history` doesn't have to open every file just to order them.
pub fn snapshot_filename(created_at_ms: i64, id: &str) -> String {
    let ts = created_at_ms.max(0) as u64;
    let id_short = &id[..id.len().min(8)];
    format!("{ts:013}_{id_short}.json")
}
