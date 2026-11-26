// Where a folder workspace's files really live: a SAF document tree the user
// picked on Android, or a plain directory (the desktop dev loop and tests).
//
// Everything above this seam speaks workspace-relative, `/`-separated paths and
// never learns which of the two it is talking to. Every call is blocking — on
// Android each one is a round trip to the document provider — so callers run
// on `spawn_blocking` or a worker thread, never on the main thread.

use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_android_fs::{AndroidFsExt, Entry, FsUri};

use crate::workspace::resolve_in_root;

/// A file's size and modification time as its own provider reports them. Only
/// ever compared with earlier stamps from the same remote, so the clock's
/// origin and precision don't matter — only that a change moves it.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStamp {
    pub len: u64,
    pub modified_ms: i64,
}

impl RemoteStamp {
    fn new(len: u64, modified: SystemTime) -> Self {
        let modified_ms = modified
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Self { len, modified_ms }
    }
}

/// One entry of a recursive listing.
#[derive(Clone, Debug)]
pub struct RemoteEntry {
    /// Relative to the remote's root, `/`-separated.
    pub rel: String,
    /// `None` for directories.
    pub stamp: Option<RemoteStamp>,
}

impl RemoteEntry {
    pub fn is_dir(&self) -> bool {
        self.stamp.is_none()
    }
}

/// How to reach a folder again after a restart. Persisted in the workspace
/// registry, so the variants and their fields are a storage format.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RemoteSpec {
    /// A SAF tree (or a directory inside one) with a persisted permission.
    Tree { uri: FsUri },
    /// A directory `std::fs` can reach.
    Path { path: PathBuf },
}

impl RemoteSpec {
    /// The URI whose persisted permission grants access to this folder. Two
    /// specs sharing one key share one grant.
    pub fn grant_key(&self) -> Option<String> {
        match self {
            RemoteSpec::Tree { uri } => Some(
                uri.document_top_tree_uri
                    .clone()
                    .unwrap_or_else(|| uri.uri.clone()),
            ),
            RemoteSpec::Path { .. } => None,
        }
    }

    /// A readable location, e.g. `Sync/Thesis` for a folder on internal
    /// storage. Display only — never parsed back.
    pub fn display(&self) -> String {
        match self {
            RemoteSpec::Path { path } => path.to_string_lossy().into_owned(),
            RemoteSpec::Tree { uri } => tree_label(&uri.uri),
        }
    }
}

/// Turn a SAF tree/document URI into a readable path:
/// `content://com.android.externalstorage.documents/tree/primary%3ASync/document/primary%3ASync%2FThesis`
/// becomes `Sync/Thesis`.
pub fn tree_label(uri: &str) -> String {
    let encoded = uri
        .rsplit_once("/document/")
        .or_else(|| uri.rsplit_once("/tree/"))
        .map(|(_, id)| id)
        .unwrap_or(uri);
    let id = percent_decode(encoded);
    match id.split_once(':') {
        Some(("primary", "")) => "Internal storage".to_string(),
        Some(("primary", path)) => path.to_string(),
        Some((volume, "")) => volume.to_string(),
        Some((volume, path)) => format!("{volume}/{path}"),
        None => id,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit()
        {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("0");
            out.push(u8::from_str_radix(hex, 16).unwrap_or(b'?'));
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Join a relative directory and a child name; an empty parent is the root.
pub fn join_rel(parent: &str, name: &str) -> String {
    let parent = parent.trim_end_matches('/');
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn last_segment(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

fn parent_of(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("")
}

/// The operations a folder workspace needs from wherever its files live.
pub trait Remote: Send + Sync {
    /// Every entry below `under` (`""` = the root), parents before children,
    /// paths relative to the *root*. Dot-prefixed names and everything inside
    /// them are skipped unless `hidden` — that keeps `.git`, `.stfolder` and
    /// `.stversions` out of every poll.
    fn list(&self, under: &str, hidden: bool) -> Result<Vec<RemoteEntry>, String>;
    /// The stamp of a file, `Ok(None)` when there is definitely no file at
    /// `rel`, and an error when the folder can't be asked. The difference
    /// matters: a folder that is briefly unreachable must never look like a
    /// file that was deleted.
    fn stat(&self, rel: &str) -> Result<Option<RemoteStamp>, String>;
    /// Whether anything (file or directory) exists at `rel`.
    fn exists(&self, rel: &str) -> bool;
    fn read(&self, rel: &str) -> Result<Vec<u8>, String>;
    /// Replace the file's contents, creating it and its parents as needed.
    fn write(&self, rel: &str, bytes: &[u8]) -> Result<(), String>;
    /// Create a directory and its parents. Fine if it already exists.
    fn create_dir(&self, rel: &str) -> Result<(), String>;
    /// Rename in place. Never overwrites.
    fn rename(&self, rel: &str, new_name: &str) -> Result<(), String>;
    /// Delete a file or a whole directory. Fine if nothing is there.
    fn remove(&self, rel: &str) -> Result<(), String>;
    /// How to reach the directory at `rel` directly, e.g. to register a
    /// workspace created inside a picked parent folder.
    fn child_spec(&self, rel: &str) -> Result<RemoteSpec, String>;

    /// Move `rel` into `new_parent` (`""` = the root), keeping its name.
    ///
    /// SAF has no portable move, so the default copies and then deletes. The
    /// listing includes hidden entries: a move must take everything with it.
    fn move_into(&self, rel: &str, new_parent: &str) -> Result<(), String> {
        let dest = join_rel(new_parent, last_segment(rel));
        if self.exists(&dest) {
            return Err("Target already exists in destination folder".into());
        }
        if self.stat(rel)?.is_some() {
            let bytes = self.read(rel)?;
            self.write(&dest, &bytes)?;
        } else {
            self.create_dir(&dest)?;
            let prefix = format!("{rel}/");
            for entry in self.list(rel, true)? {
                let Some(tail) = entry.rel.strip_prefix(&prefix) else {
                    continue;
                };
                let target = join_rel(&dest, tail);
                if entry.is_dir() {
                    self.create_dir(&target)?;
                } else {
                    let bytes = self.read(&entry.rel)?;
                    self.write(&target, &bytes)?;
                }
            }
        }
        self.remove(rel)
    }
}

/// Open the remote a spec describes.
pub fn open_remote(app: &AppHandle, spec: &RemoteSpec) -> Box<dyn Remote> {
    match spec {
        RemoteSpec::Tree { uri } => Box::new(SafRemote {
            app: app.clone(),
            root: uri.clone(),
        }),
        RemoteSpec::Path { path } => Box::new(PathRemote::new(path.clone())),
    }
}

// ─── Plain directories ───────────────────────────────────────────────────────

pub struct PathRemote {
    root: PathBuf,
}

impl PathRemote {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn abs(&self, rel: &str) -> Result<PathBuf, String> {
        if rel.is_empty() {
            return Ok(self.root.clone());
        }
        resolve_in_root(&self.root, rel)
    }
}

fn file_stamp(path: &Path) -> Option<RemoteStamp> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some(RemoteStamp::new(
        meta.len(),
        meta.modified().unwrap_or(UNIX_EPOCH),
    ))
}

impl Remote for PathRemote {
    fn list(&self, under: &str, hidden: bool) -> Result<Vec<RemoteEntry>, String> {
        let start = self.abs(under)?;
        let mut out = Vec::new();
        let mut stack = vec![(start, under.to_string())];
        while let Some((dir, rel)) = stack.pop() {
            let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
            let mut children: Vec<_> = entries.flatten().collect();
            children.sort_by_key(|entry| entry.file_name());
            for entry in children {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !hidden && name.starts_with('.') {
                    continue;
                }
                let child_rel = join_rel(&rel, &name);
                let path = entry.path();
                if path.is_dir() {
                    out.push(RemoteEntry {
                        rel: child_rel.clone(),
                        stamp: None,
                    });
                    stack.push((path, child_rel));
                } else if let Some(stamp) = file_stamp(&path) {
                    out.push(RemoteEntry {
                        rel: child_rel,
                        stamp: Some(stamp),
                    });
                }
            }
        }
        Ok(out)
    }

    fn stat(&self, rel: &str) -> Result<Option<RemoteStamp>, String> {
        // A missing root is an unreachable folder, not a deleted file.
        if !self.root.is_dir() {
            return Err(format!("{} is not available", self.root.display()));
        }
        let path = self.abs(rel)?;
        match std::fs::metadata(&path) {
            Ok(meta) if meta.is_file() => Ok(file_stamp(&path)),
            Ok(_) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn exists(&self, rel: &str) -> bool {
        self.abs(rel).map(|p| p.exists()).unwrap_or(false)
    }

    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        std::fs::read(self.abs(rel)?).map_err(|e| e.to_string())
    }

    fn write(&self, rel: &str, bytes: &[u8]) -> Result<(), String> {
        let abs = self.abs(rel)?;
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(abs, bytes).map_err(|e| e.to_string())
    }

    fn create_dir(&self, rel: &str) -> Result<(), String> {
        std::fs::create_dir_all(self.abs(rel)?).map_err(|e| e.to_string())
    }

    fn rename(&self, rel: &str, new_name: &str) -> Result<(), String> {
        let abs = self.abs(rel)?;
        let dest = self.abs(&join_rel(parent_of(rel), new_name))?;
        if dest.exists() {
            return Err(format!("Already exists: {new_name}"));
        }
        std::fs::rename(abs, dest).map_err(|e| e.to_string())
    }

    fn remove(&self, rel: &str) -> Result<(), String> {
        let abs = self.abs(rel)?;
        if abs.is_dir() {
            std::fs::remove_dir_all(abs).map_err(|e| e.to_string())
        } else if abs.exists() {
            std::fs::remove_file(abs).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }

    fn child_spec(&self, rel: &str) -> Result<RemoteSpec, String> {
        let path = self.abs(rel)?;
        if !path.is_dir() {
            return Err(format!("Not a folder: {rel}"));
        }
        Ok(RemoteSpec::Path { path })
    }

    fn move_into(&self, rel: &str, new_parent: &str) -> Result<(), String> {
        let abs = self.abs(rel)?;
        let dest = self.abs(&join_rel(new_parent, last_segment(rel)))?;
        if dest.exists() {
            return Err("Target already exists in destination folder".into());
        }
        std::fs::rename(abs, dest).map_err(|e| e.to_string())
    }
}

// ─── SAF document trees ──────────────────────────────────────────────────────

/// A folder reached through the Storage Access Framework. Every method is a
/// blocking provider round trip; none may run on the main thread.
pub struct SafRemote {
    app: AppHandle,
    root: FsUri,
}

impl SafRemote {
    fn file_uri(&self, rel: &str) -> Result<FsUri, String> {
        self.app
            .android_fs()
            .resolve_file_uri(&self.root, rel)
            .map_err(|e| e.to_string())
    }

    fn dir_uri(&self, rel: &str) -> Result<FsUri, String> {
        if rel.is_empty() {
            return Ok(self.root.clone());
        }
        self.app
            .android_fs()
            .resolve_dir_uri(&self.root, rel)
            .map_err(|e| e.to_string())
    }
}

fn same_rel(a: &Path, b: &str) -> bool {
    a.to_string_lossy().replace('\\', "/").trim_matches('/') == b.trim_matches('/')
}

impl Remote for SafRemote {
    fn list(&self, under: &str, hidden: bool) -> Result<Vec<RemoteEntry>, String> {
        let api = self.app.android_fs();
        let mut out = Vec::new();
        let mut stack = vec![(self.dir_uri(under)?, under.to_string())];
        while let Some((uri, rel)) = stack.pop() {
            let entries = api.read_dir(&uri).map_err(|e| e.to_string())?;
            for entry in entries {
                let name = entry.name().to_string();
                if !hidden && name.starts_with('.') {
                    continue;
                }
                let child_rel = join_rel(&rel, &name);
                match entry {
                    Entry::File {
                        last_modified, len, ..
                    } => out.push(RemoteEntry {
                        rel: child_rel,
                        stamp: Some(RemoteStamp::new(len, last_modified)),
                    }),
                    Entry::Dir { uri, .. } => {
                        out.push(RemoteEntry {
                            rel: child_rel.clone(),
                            stamp: None,
                        });
                        stack.push((uri, child_rel));
                    }
                }
            }
        }
        Ok(out)
    }

    fn stat(&self, rel: &str) -> Result<Option<RemoteStamp>, String> {
        let api = self.app.android_fs();
        if let Ok(uri) = self.file_uri(rel) {
            if let Ok(entry) = api.get_metadata(&uri) {
                return Ok(match entry {
                    Entry::File {
                        last_modified, len, ..
                    } => Some(RemoteStamp::new(len, last_modified)),
                    Entry::Dir { .. } => None,
                });
            }
        }
        // SAF reports "no such file" and "can't ask right now" the same way.
        // Only on this failure path, ask the parent directory: if it lists
        // fine and the name isn't in it, the file is really gone.
        let parent = self.dir_uri(parent_of(rel))?;
        let siblings = api.read_dir(&parent).map_err(|e| e.to_string())?;
        if siblings
            .iter()
            .any(|entry| entry.name() == last_segment(rel))
        {
            return Err(format!("Can't read \"{rel}\" in the folder"));
        }
        Ok(None)
    }

    fn exists(&self, rel: &str) -> bool {
        self.file_uri(rel).is_ok() || self.dir_uri(rel).is_ok()
    }

    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        let uri = self.file_uri(rel)?;
        self.app.android_fs().read(&uri).map_err(|e| e.to_string())
    }

    fn write(&self, rel: &str, bytes: &[u8]) -> Result<(), String> {
        let api = self.app.android_fs();
        let uri = match self.file_uri(rel) {
            Ok(uri) => uri,
            Err(_) => {
                let parent = parent_of(rel);
                if !parent.is_empty() {
                    api.create_dir_all(&self.root, parent)
                        .map_err(|e| e.to_string())?;
                }
                let (uri, actual) = api
                    .create_new_file_and_return_relative_path(&self.root, rel, None)
                    .map_err(|e| e.to_string())?;
                // Providers may sanitize a name or add " (1)". A file under
                // another name would leave the mirror and the folder disagreeing
                // about where it lives, so undo it and say so.
                if !same_rel(&actual, rel) {
                    let _ = api.remove_file(&uri);
                    return Err(format!(
                        "The folder's storage provider would not create \"{rel}\" under that name"
                    ));
                }
                uri
            }
        };
        api.write(&uri, bytes).map_err(|e| e.to_string())
    }

    fn create_dir(&self, rel: &str) -> Result<(), String> {
        if self.dir_uri(rel).is_ok() {
            return Ok(());
        }
        let (_, actual) = self
            .app
            .android_fs()
            .create_dir_all_and_return_relative_path(&self.root, rel)
            .map_err(|e| e.to_string())?;
        if !same_rel(&actual, rel) {
            return Err(format!(
                "The folder's storage provider would not create \"{rel}\" under that name"
            ));
        }
        Ok(())
    }

    fn rename(&self, rel: &str, new_name: &str) -> Result<(), String> {
        let api = self.app.android_fs();
        let dest = join_rel(parent_of(rel), new_name);
        if self.exists(&dest) {
            return Err(format!("Already exists: {new_name}"));
        }
        let uri = self.file_uri(rel).or_else(|_| self.dir_uri(rel))?;
        let renamed = api.rename(&uri, new_name).map_err(|e| e.to_string())?;
        let actual = api.get_name(&renamed).map_err(|e| e.to_string())?;
        if actual != new_name {
            let _ = api.rename(&renamed, last_segment(rel));
            return Err(format!(
                "The folder's storage provider would not use the name \"{new_name}\""
            ));
        }
        Ok(())
    }

    fn remove(&self, rel: &str) -> Result<(), String> {
        let api = self.app.android_fs();
        if let Ok(uri) = self.file_uri(rel) {
            return api.remove_file(&uri).map_err(|e| e.to_string());
        }
        if let Ok(uri) = self.dir_uri(rel) {
            return api.remove_dir_all(&uri).map_err(|e| e.to_string());
        }
        Ok(())
    }

    fn child_spec(&self, rel: &str) -> Result<RemoteSpec, String> {
        Ok(RemoteSpec::Tree {
            uri: self.dir_uri(rel)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_tree_uris_as_readable_paths() {
        assert_eq!(
            tree_label(
                "content://com.android.externalstorage.documents/tree/primary%3ASync%2FThesis"
            ),
            "Sync/Thesis"
        );
        assert_eq!(
            tree_label("content://com.android.externalstorage.documents/tree/primary%3ASync/document/primary%3ASync%2FNotes"),
            "Sync/Notes"
        );
        assert_eq!(
            tree_label("content://com.android.externalstorage.documents/tree/primary%3A"),
            "Internal storage"
        );
        assert_eq!(
            tree_label("content://com.android.externalstorage.documents/tree/1A2B-3C4D%3ADocs"),
            "1A2B-3C4D/Docs"
        );
    }

    #[test]
    fn decodes_multibyte_names() {
        assert_eq!(percent_decode("%E6%97%A5%E6%9C%AC"), "日本");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%2"), "a%2");
    }
}
