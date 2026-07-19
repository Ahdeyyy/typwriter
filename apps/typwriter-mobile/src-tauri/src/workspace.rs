// Managed-storage workspaces (v1): each workspace is a direct subdirectory of
// `<documents>/Typwriter/`, reachable with plain `std::fs`. SAF-picked external
// folders are a later phase (08-saf-and-polish.md). All file IO is funnelled
// through this module so phase 8 can swap in a `WorkspaceFs` trait in one place.

use std::path::{Component, Path, PathBuf};

use parking_lot::RwLock;
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
}

const META_DIR: &str = ".typwriter";
const META_FILE: &str = "mobile.json";

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
            Component::ParentDir => {
                return Err(format!("path traversal is not allowed: {rel}"))
            }
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

pub fn write_meta(workspace_root: &Path, meta: &WorkspaceMetaFile) -> Result<(), String> {
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
    use super::resolve_in_root;
    use std::path::Path;

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
