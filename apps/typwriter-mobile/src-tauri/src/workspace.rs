// Managed-storage workspaces (v1): each workspace is a direct subdirectory of
// `<documents>/Typwriter/`, reachable with plain `std::fs`. SAF-picked external
// folders are a later phase (08-saf-and-polish.md). All file IO is funnelled
// through this module so phase 8 can swap in a `WorkspaceFs` trait in one place.

use std::path::{Component, Path, PathBuf};

use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};

/// Tauri-managed: the currently open workspace root (absolute), or `None`.
#[derive(Default)]
pub struct WorkspaceState {
    pub root: RwLock<Option<PathBuf>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub name: String,
    pub path: String,
    pub last_opened_ms: Option<i64>,
    /// App-managed entry (the Typst package store), not a user workspace.
    pub system: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

/// The result of renaming, moving, or deleting an entry: the refreshed tree
/// plus the path change itself, so the frontend can carry its open tabs (and
/// the active buffer) across it instead of holding a path that no longer exists.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntryChange {
    pub tree: FileNode,
    /// The entry's workspace-relative path before the operation.
    pub from: String,
    /// Its path afterwards, or `None` when it was deleted.
    pub to: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub name: String,
    pub root: String,
    pub tree: FileNode,
    pub main_file: Option<String>,
    pub last_file: Option<String>,
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    /// Caret offset (UTF-16 code units) inside `active_tab`, when one survived.
    pub cursor: Option<usize>,
}

/// Per-workspace metadata persisted at `<workspace>/.typwriter/mobile.json`.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMetaFile {
    pub main_file: Option<String>,
    pub last_file: Option<String>,
    pub last_opened_ms: Option<i64>,
    #[serde(default)]
    pub open_tabs: Vec<String>,
    #[serde(default)]
    pub active_tab: Option<String>,
    /// Caret offset (UTF-16 code units, CodeMirror's coordinate space) inside
    /// `active_tab`. Absent in metadata written before caret restore landed,
    /// which simply means "open at the top".
    #[serde(default)]
    pub cursor: Option<usize>,
}

const META_DIR: &str = ".typwriter";
const META_FILE: &str = "mobile.json";

/// How a stored workspace-relative path is affected by an entry being renamed,
/// moved, or deleted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathRemap {
    /// Neither the entry itself nor inside it — the path still points at the
    /// same file.
    Unaffected,
    /// The entry (or a folder containing it) moved; this is its new path.
    Moved(String),
    /// The entry was deleted.
    Gone,
}

/// Remap `rel` after the entry at `from` became `to` (`None` when deleted).
///
/// Descendants travel with a folder, so a path *inside* `from` lands at the
/// same position under `to`. Matching is on whole path segments: renaming
/// `notes` must not touch `notes-old.typ`.
pub fn remap_rel(rel: &str, from: &str, to: Option<&str>) -> PathRemap {
    let tail = if rel == from {
        ""
    } else {
        match rel.strip_prefix(from).and_then(|r| r.strip_prefix('/')) {
            Some(tail) => tail,
            None => return PathRemap::Unaffected,
        }
    };
    match to {
        None => PathRemap::Gone,
        Some(to) if tail.is_empty() => PathRemap::Moved(to.to_string()),
        Some(to) => PathRemap::Moved(format!("{to}/{tail}")),
    }
}

/// Apply [`remap_rel`] to a stored optional path, dropping it when it's gone.
fn remap_opt(path: Option<String>, from: &str, to: Option<&str>) -> Option<String> {
    let path = path?;
    match remap_rel(&path, from, to) {
        PathRemap::Unaffected => Some(path),
        PathRemap::Moved(next) => Some(next),
        PathRemap::Gone => None,
    }
}

/// What [`remap_meta`] wrote, and whether the document's identity changed with
/// it — the caller has to drop the compiled document when it did.
pub struct MetaRemap {
    /// The metadata as persisted.
    pub meta: WorkspaceMetaFile,
    /// `true` when the main file was renamed, moved, or deleted. The cached
    /// `PagedDocument` then describes a file under an identity that no longer
    /// exists, and must not be served to the renderer or the PDF export.
    pub main_changed: bool,
}

/// Rewrite every path a workspace's metadata stores (main file, last file, open
/// tabs, active tab) after the entry at `from` became `to` — or was deleted,
/// with `to = None` — and persist the result.
///
/// Without this the metadata keeps naming files that no longer exist: the next
/// launch would find no main file, and every restored tab would be dropped.
pub fn remap_meta(root: &Path, from: &str, to: Option<&str>) -> Result<MetaRemap, String> {
    let mut main_changed = false;
    let meta = update_meta(root, |meta| {
        main_changed = meta
            .main_file
            .as_deref()
            .is_some_and(|rel| remap_rel(rel, from, to) != PathRemap::Unaffected);
        meta.main_file = remap_opt(meta.main_file.take(), from, to);
        meta.last_file = remap_opt(meta.last_file.take(), from, to);

        // A move can land on a path that is already open in another tab, so dedupe.
        let mut tabs: Vec<String> = Vec::with_capacity(meta.open_tabs.len());
        for tab in std::mem::take(&mut meta.open_tabs) {
            if let Some(next) = remap_opt(Some(tab), from, to) {
                if !tabs.contains(&next) {
                    tabs.push(next);
                }
            }
        }
        let active = remap_opt(meta.active_tab.take(), from, to).filter(|t| tabs.contains(t));
        // The caret only means anything against the tab it was recorded in.
        if active.is_none() {
            meta.cursor = None;
        }
        meta.open_tabs = tabs;
        meta.active_tab = active;
    })?;
    Ok(MetaRemap { meta, main_changed })
}

/// Resolve a workspace-relative path under `root`, rejecting traversal.
///
/// Rejects absolute paths and any `..` / root / prefix component, so
/// `../escape.typ`, `/etc/passwd`, and `a/../../escape.typ` all error while
/// normal nested paths pass. Works for not-yet-existing paths (create ops).
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("absolute paths are not allowed: {rel}"));
    }
    for component in rel_path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => return Err(format!("path traversal is not allowed: {rel}")),
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("absolute paths are not allowed: {rel}"))
            }
        }
    }
    Ok(root.join(rel_path))
}

/// The directory all managed workspaces live in. Created on first use.
pub fn workspaces_root(documents: Option<PathBuf>, app_data: PathBuf) -> PathBuf {
    let root = match documents {
        Some(d) => d.join("Typwriter"),
        None => app_data.join("workspaces"),
    };
    let _ = std::fs::create_dir_all(&root);
    root
}

fn meta_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(META_DIR).join(META_FILE)
}

pub fn read_meta(workspace_root: &Path) -> WorkspaceMetaFile {
    let path = meta_path(workspace_root);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Serialises the read-modify-write cycle on `mobile.json`.
///
/// Every writer is a read-modify-write, and they overlap: the tab persist is
/// debounced, so it can fire while a rename is mid-flight. Interleaved, the tab
/// write reads pre-remap metadata and puts the stale `mainFile` back over the
/// remap — the workspace then silently falls back to an auto-detected main file
/// on the next open. One global lock is enough: these writes are rare and the
/// critical section is a small file.
static META_LOCK: Mutex<()> = Mutex::new(());

/// Read a workspace's metadata, apply `edit`, and write it back as one
/// operation with respect to every other `update_meta` call. Returns the
/// metadata as persisted.
pub fn update_meta(
    workspace_root: &Path,
    edit: impl FnOnce(&mut WorkspaceMetaFile),
) -> Result<WorkspaceMetaFile, String> {
    let _guard = META_LOCK.lock();
    let mut meta = read_meta(workspace_root);
    edit(&mut meta);
    write_meta(workspace_root, &meta)?;
    Ok(meta)
}

fn write_meta(workspace_root: &Path, meta: &WorkspaceMetaFile) -> Result<(), String> {
    let dir = workspace_root.join(META_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(META_FILE), json).map_err(|e| e.to_string())
}

/// Build the file tree rooted at `root`. Directories first, then files, each
/// alphabetical; hidden entries (`.`-prefixed, incl. `.typwriter`) are skipped.
pub fn build_tree(root: &Path) -> FileNode {
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workspace")
        .to_string();
    FileNode {
        name,
        rel_path: String::new(),
        is_dir: true,
        children: read_children(root, root),
    }
}

fn read_children(dir: &Path, root: &Path) -> Vec<FileNode> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<FileNode> = Vec::new();
    let mut files: Vec<FileNode> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue; // hides dot-files and .typwriter
        }
        let rel_path = path
            .strip_prefix(root)
            .ok()
            .and_then(|p| p.to_str())
            .map(|s| s.replace('\\', "/"))
            .unwrap_or_default();
        let is_dir = path.is_dir();
        let node = FileNode {
            name: file_name.to_string(),
            rel_path,
            is_dir,
            children: if is_dir {
                read_children(&path, root)
            } else {
                Vec::new()
            },
        };
        if is_dir {
            dirs.push(node);
        } else {
            files.push(node);
        }
    }
    let by_name = |a: &FileNode, b: &FileNode| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.into_iter().chain(files).collect()
}

/// Detect the main file for a freshly opened workspace: persisted setting if it
/// still exists, else `main.typ`, else the first `*.typ` found, else none.
pub fn detect_main_file(root: &Path, persisted: Option<&str>) -> Option<String> {
    if let Some(rel) = persisted {
        if root.join(rel).is_file() {
            return Some(rel.to_string());
        }
    }
    if root.join("main.typ").is_file() {
        return Some("main.typ".to_string());
    }
    first_typ_file(root, root)
}

fn first_typ_file(dir: &Path, root: &Path) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut sorted: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| !n.starts_with('.'))
                .unwrap_or(false)
        })
        .collect();
    sorted.sort();
    for path in &sorted {
        if path.is_file() && path.extension().map_or(false, |e| e == "typ") {
            return path
                .strip_prefix(root)
                .ok()
                .and_then(|p| p.to_str())
                .map(|s| s.replace('\\', "/"));
        }
    }
    for path in &sorted {
        if path.is_dir() {
            if let Some(found) = first_typ_file(path, root) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{remap_rel, resolve_in_root, PathRemap};
    use std::path::Path;

    fn moved(path: &str) -> PathRemap {
        PathRemap::Moved(path.to_string())
    }

    #[test]
    fn remaps_the_renamed_file_itself() {
        assert_eq!(remap_rel("a.typ", "a.typ", Some("b.typ")), moved("b.typ"));
        assert_eq!(remap_rel("a.typ", "a.typ", None), PathRemap::Gone);
    }

    #[test]
    fn remaps_paths_inside_a_renamed_folder() {
        assert_eq!(
            remap_rel("notes/ch1.typ", "notes", Some("archive/notes")),
            moved("archive/notes/ch1.typ")
        );
        assert_eq!(
            remap_rel("notes/sub/deep.typ", "notes", Some("book")),
            moved("book/sub/deep.typ")
        );
        assert_eq!(remap_rel("notes/ch1.typ", "notes", None), PathRemap::Gone);
    }

    #[test]
    fn leaves_unrelated_and_prefix_lookalike_paths_alone() {
        assert_eq!(
            remap_rel("other.typ", "a.typ", Some("b.typ")),
            PathRemap::Unaffected
        );
        // Segment-wise matching: "notes-old.typ" is not inside "notes".
        assert_eq!(
            remap_rel("notes-old.typ", "notes", Some("book")),
            PathRemap::Unaffected
        );
        assert_eq!(
            remap_rel("notesy/x.typ", "notes", None),
            PathRemap::Unaffected
        );
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        let root = Path::new("/ws");
        assert!(resolve_in_root(root, "../escape.typ").is_err());
        assert!(resolve_in_root(root, "a/../../escape.typ").is_err());
        assert!(resolve_in_root(root, "/etc/passwd").is_err());
    }

    #[test]
    fn accepts_nested() {
        let root = Path::new("/ws");
        assert!(resolve_in_root(root, "main.typ").is_ok());
        assert!(resolve_in_root(root, "chapters/intro.typ").is_ok());
        assert!(resolve_in_root(root, "./main.typ").is_ok());
    }
}
