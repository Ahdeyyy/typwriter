// Stat cache for the snapshot walk. Building a snapshot needs the content hash
// of every file in the workspace; without this, each save and each successful
// compile re-read and re-hashed the whole tree (hundreds of MB on a workspace
// with PDFs or images), which is what made saving take tens of seconds.
//
// Same idea as git's index: remember `(size, mtime) → hash` per path and only
// re-read a file whose stat changed. Persisted next to the history so the
// first walk of a session is cheap too. It is purely a cache — deleting it
// costs one full re-hash and nothing else.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::fs::{FileStat, WorkingTreeFs};
use super::paths::index_file;

/// A file modified this recently is hashed but not cached: a second write
/// landing inside the filesystem's timestamp granularity (2s on FAT) could
/// leave size and mtime unchanged, and we would serve the old hash forever.
const RACY_WINDOW: Duration = Duration::from_secs(2);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
struct IndexEntry {
    len: u64,
    mtime_secs: u64,
    mtime_nanos: u32,
    hash: String,
}

#[derive(Serialize, Deserialize, Default)]
struct IndexFile {
    version: u32,
    entries: HashMap<String, IndexEntry>,
}

const INDEX_VERSION: u32 = 1;

/// Workspace-relative path (forward slashes) → last known stat + blob hash.
pub struct TreeIndex {
    root: PathBuf,
    entries: HashMap<String, IndexEntry>,
    dirty: bool,
}

impl TreeIndex {
    /// Load the persisted index for `root`. A missing, unreadable, or
    /// outdated file just means an empty cache.
    pub fn load(fs: &impl WorkingTreeFs, root: &Path) -> Self {
        let path = index_file(root);
        let entries = if fs.exists(&path) {
            fs.read_file(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<IndexFile>(&bytes).ok())
                .filter(|file| file.version == INDEX_VERSION)
                .map(|file| file.entries)
                .unwrap_or_default()
        } else {
            HashMap::new()
        };
        Self {
            root: root.to_path_buf(),
            entries,
            dirty: false,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The cached hash for `rel`, if the file's stat still matches.
    pub fn lookup(&self, rel: &str, stat: &FileStat) -> Option<&str> {
        let entry = self.entries.get(rel)?;
        let (secs, nanos) = split_mtime(stat.modified)?;
        (entry.len == stat.len && entry.mtime_secs == secs && entry.mtime_nanos == nanos)
            .then_some(entry.hash.as_str())
    }

    /// Record a freshly computed hash. `stat` must have been taken *before*
    /// the file was read, so a write racing the read invalidates the entry
    /// rather than hiding behind it.
    pub fn record(&mut self, rel: &str, stat: Option<&FileStat>, hash: &str) {
        let entry = stat.and_then(|stat| {
            let settled = SystemTime::now()
                .duration_since(stat.modified)
                .is_ok_and(|age| age > RACY_WINDOW);
            let (mtime_secs, mtime_nanos) = split_mtime(stat.modified)?;
            settled.then(|| IndexEntry {
                len: stat.len,
                mtime_secs,
                mtime_nanos,
                hash: hash.to_string(),
            })
        });
        match entry {
            Some(entry) => {
                if self.entries.get(rel) != Some(&entry) {
                    self.entries.insert(rel.to_string(), entry);
                    self.dirty = true;
                }
            }
            None => {
                if self.entries.remove(rel).is_some() {
                    self.dirty = true;
                }
            }
        }
    }

    /// Drop entries for files the walk no longer saw, so the index can't grow
    /// without bound across renames and deletions.
    pub fn retain_seen(&mut self, seen: &HashSet<String>) {
        let before = self.entries.len();
        self.entries.retain(|rel, _| seen.contains(rel));
        if self.entries.len() != before {
            self.dirty = true;
        }
    }

    /// Persist if anything changed since the last save. Best effort.
    pub fn save(&mut self, fs: &impl WorkingTreeFs) {
        if !self.dirty {
            return;
        }
        let path = index_file(&self.root);
        let file = IndexFile {
            version: INDEX_VERSION,
            entries: std::mem::take(&mut self.entries),
        };
        let written = serde_json::to_vec(&file)
            .map_err(|e| e.to_string())
            .and_then(|bytes| {
                if let Some(parent) = path.parent() {
                    fs.create_dir_all(parent)?;
                }
                fs.write_file(&path, &bytes)
            });
        self.entries = file.entries;
        match written {
            Ok(()) => self.dirty = false,
            Err(err) => log::warn!("vcs::index: save failed: {err}"),
        }
    }
}

fn split_mtime(modified: SystemTime) -> Option<(u64, u32)> {
    let since_epoch = modified.duration_since(UNIX_EPOCH).ok()?;
    Some((since_epoch.as_secs(), since_epoch.subsec_nanos()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(len: u64, age: Duration) -> FileStat {
        FileStat {
            len,
            modified: SystemTime::now() - age,
        }
    }

    fn empty() -> TreeIndex {
        TreeIndex {
            root: PathBuf::from("ws"),
            entries: HashMap::new(),
            dirty: false,
        }
    }

    #[test]
    fn lookup_hits_only_while_stat_is_unchanged() {
        let mut index = empty();
        let original = stat(10, Duration::from_secs(60));
        index.record("a.typ", Some(&original), "h1");
        assert_eq!(index.lookup("a.typ", &original), Some("h1"));

        let resized = FileStat { len: 11, ..original };
        assert_eq!(index.lookup("a.typ", &resized), None);

        let touched = FileStat {
            modified: original.modified + Duration::from_secs(1),
            ..original
        };
        assert_eq!(index.lookup("a.typ", &touched), None);
    }

    #[test]
    fn recently_modified_files_are_not_cached() {
        let mut index = empty();
        let settled = stat(10, Duration::from_secs(60));
        index.record("a.typ", Some(&settled), "h1");

        // The file is rewritten: the stale entry must go, and the fresh hash
        // must not be trusted until the mtime is out of the racy window.
        let fresh = stat(10, Duration::ZERO);
        index.record("a.typ", Some(&fresh), "h2");
        assert_eq!(index.lookup("a.typ", &fresh), None);
        assert_eq!(index.lookup("a.typ", &settled), None);
    }

    #[test]
    fn retain_seen_drops_vanished_paths() {
        let mut index = empty();
        let s = stat(1, Duration::from_secs(60));
        index.record("keep.typ", Some(&s), "h1");
        index.record("gone.typ", Some(&s), "h2");
        index.retain_seen(&HashSet::from(["keep.typ".to_string()]));
        assert_eq!(index.lookup("keep.typ", &s), Some("h1"));
        assert_eq!(index.lookup("gone.typ", &s), None);
    }
}
