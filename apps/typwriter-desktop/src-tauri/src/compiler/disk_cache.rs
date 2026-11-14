// A persistent, on-disk mirror of `PageCache`. Rendered PNGs are written to
// `<workspace_root>/.typwriter/cache/previews/<fp_hex>-<zoom>.png` so that:
//
//   * Re-opening a workspace serves the preview immediately, without
//     recompiling and re-rendering every page.
//   * Pages evicted from the in-memory LRU still resolve when the webview
//     refetches them — the URI scheme handler falls through to disk.
//   * Zooming back to a previously-rendered scale stays instant across app
//     restarts.
//
// Layout note: the on-disk filename is exactly `key_to_path(key) + ".png"` —
// the same string the `previewimg://` URL uses — so debugging is just `ls`.
//
// Eviction: a bounded in-memory `LruCache<PageCacheKey, u64>` tracks recency
// and each file's size. On startup we walk the directory and seed the LRU in
// mtime order so the oldest file evicts first. The cache is bounded twice —
// by entry count and by total bytes — and whichever limit is hit first
// deletes least-recently-used files from disk.
//
// We intentionally do NOT hold the disk lock during file I/O; callers lock
// only long enough to mutate metadata. The hot path is read-mostly.

use std::{
    fs,
    num::NonZeroUsize,
    path::{Path, PathBuf},
    time::SystemTime,
};

use log::{info, warn};
use lru::LruCache;
use serde::{Deserialize, Serialize};

use super::cache::{key_to_path, parse_key, PageCacheKey};

/// Cap on cached files.
const DEFAULT_CAPACITY: usize = 500;

/// Cap on the cache's total size. The count alone doesn't bound it: a page
/// rendered at 2x is routinely 0.5–1 MB and a figure-heavy one several, so
/// 500 entries reached 400 MB in practice. This comfortably holds every page
/// of a few-hundred-page document at one zoom level, which is all that
/// restoring the preview on the next open needs.
const DEFAULT_MAX_BYTES: u64 = 160 * 1024 * 1024;

/// Subdirectory inside `.typwriter` where preview PNGs live.
const SUBDIR: &str = "cache/previews";

pub struct DiskCache {
    dir: PathBuf,
    /// Recency order. Value is the file's size — disk is the source of truth
    /// for the bytes themselves.
    order: LruCache<PageCacheKey, u64>,
    /// Sum of the sizes in `order`.
    total_bytes: u64,
    max_bytes: u64,
}

impl DiskCache {
    /// Initialize a cache rooted at `<workspace_root>/.typwriter/cache/previews/`.
    /// Creates the directory if missing and seeds the LRU from any pre-existing
    /// files (oldest mtime first, so they evict first).
    pub fn open(workspace_root: &Path, capacity: usize, max_bytes: u64) -> Self {
        let dir = workspace_root.join(".typwriter").join(SUBDIR);
        if let Err(err) = fs::create_dir_all(&dir) {
            warn!(
                "DiskCache::open: create_dir_all failed dir={dir:?} err=\"{err}\" — disk cache disabled"
            );
        }

        const ONE: NonZeroUsize = match NonZeroUsize::new(1) {
            Some(n) => n,
            None => unreachable!(),
        };
        let cap = NonZeroUsize::new(capacity).unwrap_or(ONE);
        let mut cache = Self {
            dir: dir.clone(),
            order: LruCache::new(cap),
            total_bytes: 0,
            max_bytes,
        };

        // Walk existing files. Pair each with mtime so we can insert oldest
        // first — that way the LRU's natural eviction order matches disk age.
        let mut entries: Vec<(PageCacheKey, SystemTime, u64)> = Vec::new();
        if let Ok(read) = fs::read_dir(&dir) {
            for entry in read.flatten() {
                let path = entry.path();
                let Some(stem) = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
                else {
                    continue;
                };
                let Some(key) = parse_key(&stem) else {
                    continue;
                };
                let meta = entry.metadata().ok();
                let mtime = meta
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                let len = meta.map(|m| m.len()).unwrap_or(0);
                entries.push((key, mtime, len));
            }
        }
        // Pages of the preview that will be restored count as newest whatever
        // their mtime: a page that hasn't changed in weeks is still on screen,
        // and reads never touch the file's timestamp.
        let current: std::collections::HashSet<PageCacheKey> = read_manifest(workspace_root)
            .map(|(_, pages)| pages.into_iter().flatten().collect())
            .unwrap_or_default();
        entries.sort_by_key(|(key, mtime, _)| (current.contains(key), *mtime));

        // Insert oldest first. If the directory holds more than the cache
        // allows, the oldest files are the ones evicted and deleted.
        for (key, _, len) in entries {
            cache.track(key, len);
        }

        info!(
            "DiskCache::open: dir={dir:?} loaded {} preview(s), {:.1} MB",
            cache.order.len(),
            cache.total_bytes as f64 / (1024.0 * 1024.0)
        );

        cache
    }

    /// Record `key` as the most recently used entry with the given size, then
    /// delete least-recently-used files until both limits hold again. The
    /// entry just recorded is never evicted, even if it alone is over budget.
    fn track(&mut self, key: PageCacheKey, len: u64) {
        if let Some((old_key, old_len)) = self.order.push(key, len) {
            self.total_bytes = self.total_bytes.saturating_sub(old_len);
            // `push` hands back the previous value when the key was already
            // present; only a *different* key is an eviction.
            if old_key != key {
                let _ = fs::remove_file(file_path(&self.dir, old_key));
            }
        }
        self.total_bytes += len;

        while self.total_bytes > self.max_bytes && self.order.len() > 1 {
            let Some((old_key, old_len)) = self.order.pop_lru() else {
                break;
            };
            self.total_bytes = self.total_bytes.saturating_sub(old_len);
            let _ = fs::remove_file(file_path(&self.dir, old_key));
        }
    }

    fn forget(&mut self, key: PageCacheKey) {
        if let Some(len) = self.order.pop(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(len);
        }
    }

    /// Return true if `key` exists on disk (without reading it).
    pub fn contains(&mut self, key: PageCacheKey) -> bool {
        // Touching the LRU promotes the entry — good, since "checked" implies
        // "likely about to be served".
        if self.order.get(&key).is_some() {
            // Defensive: an external delete could have removed the file. If
            // the file is gone, drop the LRU entry to stay consistent.
            if file_path(&self.dir, key).is_file() {
                return true;
            }
            self.forget(key);
        }
        false
    }

    /// Read the PNG bytes for `key`, promoting LRU recency. Returns `None`
    /// if either the LRU does not list the key or the file is missing.
    pub fn get(&mut self, key: PageCacheKey) -> Option<Vec<u8>> {
        if self.order.get(&key).is_none() {
            return None;
        }
        let path = file_path(&self.dir, key);
        match fs::read(&path) {
            Ok(bytes) => Some(bytes),
            Err(err) => {
                warn!("DiskCache::get: read failed path={path:?} err=\"{err}\"");
                self.forget(key);
                None
            }
        }
    }

    /// Persist `bytes` under `key`. Existing files for the same key are
    /// overwritten via atomic rename to avoid leaving torn writes if the
    /// process crashes mid-write. Older entries are evicted (and their files
    /// deleted) if this pushes the cache over either limit.
    pub fn insert(&mut self, key: PageCacheKey, bytes: &[u8]) {
        let final_path = file_path(&self.dir, key);
        let tmp_path = self.dir.join(format!("{}.png.tmp", key_to_path(key)));

        if let Err(err) = fs::write(&tmp_path, bytes) {
            warn!("DiskCache::insert: write tmp failed path={tmp_path:?} err=\"{err}\"");
            return;
        }
        if let Err(err) = fs::rename(&tmp_path, &final_path) {
            warn!(
                "DiskCache::insert: rename failed tmp={tmp_path:?} final={final_path:?} err=\"{err}\""
            );
            // Best-effort cleanup of the orphaned tmp file.
            let _ = fs::remove_file(&tmp_path);
            return;
        }

        self.track(key, bytes.len() as u64);
    }
}

fn file_path(dir: &Path, key: PageCacheKey) -> PathBuf {
    dir.join(format!("{}.png", key_to_path(key)))
}

// ─── Preview manifest ──────────────────────────────────────────────────────
//
// The disk cache stores PNG bytes keyed by `(fingerprint, zoom)`, but nothing
// records which fingerprints, in what order, made up the last preview — and
// you can't know that without compiling first. The manifest closes that gap: a
// tiny JSON file listing the page keys (in page order) of the last successful
// compile, tagged with the main file it belongs to. On open we can paint those
// cached pages immediately, before the (font-blocked) compile produces fresh
// fingerprints, then let the normal diff reconcile.

/// Ordered page keys of the last successful preview. `pages[i]` is the cache
/// key for page `i` (`None` if that page failed to render), encoded as the same
/// `<hex>-<zoom>` string used by the `previewimg://` URL.
#[derive(Serialize, Deserialize)]
struct PreviewManifest {
    main: String,
    pages: Vec<Option<String>>,
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join(".typwriter")
        .join("cache")
        .join("preview-manifest.json")
}

/// Persist the ordered page keys of the current preview, tagged with `main`
/// (the workspace-relative main file path). Best-effort: failures are logged
/// and otherwise ignored.
pub fn write_manifest(root: &Path, main: &str, pages: &[Option<PageCacheKey>]) {
    let manifest = PreviewManifest {
        main: main.to_string(),
        pages: pages
            .iter()
            .map(|slot| slot.map(key_to_path))
            .collect(),
    };
    let path = manifest_path(root);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_vec(&manifest) {
        Ok(bytes) => {
            if let Err(err) = fs::write(&path, bytes) {
                warn!("write_manifest: write failed path={path:?} err=\"{err}\"");
            }
        }
        Err(err) => warn!("write_manifest: serialize failed err=\"{err}\""),
    }
}

/// Read the persisted preview manifest. Returns `(main, pages)` where `pages[i]`
/// is the cache key for page `i` (or `None`). `None` when no manifest exists or
/// it can't be parsed.
pub fn read_manifest(root: &Path) -> Option<(String, Vec<Option<PageCacheKey>>)> {
    let bytes = fs::read(manifest_path(root)).ok()?;
    let manifest: PreviewManifest = serde_json::from_slice(&bytes).ok()?;
    let pages = manifest
        .pages
        .iter()
        .map(|slot| slot.as_deref().and_then(parse_key))
        .collect();
    Some((manifest.main, pages))
}

impl Default for DiskCache {
    fn default() -> Self {
        // Anchored at the current directory if nobody calls `open`. Useful
        // only as a safe placeholder before a workspace is attached.
        Self {
            dir: PathBuf::from("."),
            order: LruCache::new(NonZeroUsize::new(DEFAULT_CAPACITY).expect("constant > 0")),
            total_bytes: 0,
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

/// Convenience for callers that just want the standard limits.
pub fn open_default(workspace_root: &Path) -> DiskCache {
    DiskCache::open(workspace_root, DEFAULT_CAPACITY, DEFAULT_MAX_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("typwriter-diskcache-{tag}-{nanos}"))
    }

    #[test]
    fn byte_budget_evicts_least_recently_used_files() {
        let root = temp_root("bytes");
        let mut cache = DiskCache::open(&root, 100, 250);
        let (a, b, c): (PageCacheKey, PageCacheKey, PageCacheKey) =
            ((1, 2000), (2, 2000), (3, 2000));

        cache.insert(a, &[0u8; 100]);
        cache.insert(b, &[0u8; 100]);
        // Touch `a` so `b` is the least recently used when `c` overflows.
        assert!(cache.contains(a));
        cache.insert(c, &[0u8; 100]);

        assert!(cache.contains(a));
        assert!(!cache.contains(b));
        assert!(cache.contains(c));
        assert!(!file_path(&cache.dir, b).exists());
        assert_eq!(cache.total_bytes, 200);

        // Re-inserting a key replaces its size instead of double counting.
        cache.insert(c, &[0u8; 40]);
        assert_eq!(cache.total_bytes, 140);
        assert!(file_path(&cache.dir, c).exists());

        // An existing directory over budget is trimmed on open.
        drop(cache);
        let reopened = DiskCache::open(&root, 100, 120);
        assert_eq!(reopened.order.len(), 1);
        assert!(reopened.total_bytes <= 120);

        let _ = fs::remove_dir_all(&root);
    }
}
