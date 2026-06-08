// compiler/disk_cache.rs
//
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
// Eviction: a bounded in-memory `LruCache<PageCacheKey, ()>` tracks recency.
// On startup we walk the directory and seed the LRU in mtime order so the
// oldest file evicts first. Inserts that overflow the LRU delete the evicted
// file from disk.
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

/// Cap on cached files. Each PNG is on the order of tens to hundreds of KB,
/// so 500 entries is roughly 50–200 MB worst case — generous, but bounded.
const DEFAULT_CAPACITY: usize = 500;

/// Subdirectory inside `.typwriter` where preview PNGs live.
const SUBDIR: &str = "cache/previews";

pub struct DiskCache {
    dir: PathBuf,
    /// Recency order. Value is `()` — disk is the source of truth for bytes.
    order: LruCache<PageCacheKey, ()>,
}

impl DiskCache {
    /// Initialize a cache rooted at `<workspace_root>/.typwriter/cache/previews/`.
    /// Creates the directory if missing and seeds the LRU from any pre-existing
    /// files (oldest mtime first, so they evict first).
    pub fn open(workspace_root: &Path, capacity: usize) -> Self {
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
        let mut order: LruCache<PageCacheKey, ()> = LruCache::new(cap);

        // Walk existing files. Pair each with mtime so we can insert oldest
        // first — that way the LRU's natural eviction order matches disk age.
        let mut entries: Vec<(PageCacheKey, SystemTime, PathBuf)> = Vec::new();
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
                let mtime = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                entries.push((key, mtime, path));
            }
        }
        entries.sort_by_key(|(_, mtime, _)| *mtime);

        // Insert oldest first. If the directory holds more than `capacity`
        // files, the LRU will report evictions for the oldest, which we delete.
        let mut evicted_paths: Vec<PathBuf> = Vec::new();
        for (key, _, path) in entries {
            if let Some((old_key, _)) = order.push(key, ()) {
                if old_key != key {
                    evicted_paths.push(file_path(&dir, old_key));
                    let _ = path; // suppress unused warning for the kept path
                }
            }
        }
        for path in evicted_paths {
            let _ = fs::remove_file(path);
        }

        info!(
            "DiskCache::open: dir={dir:?} loaded {} preview(s)",
            order.len()
        );

        Self { dir, order }
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
            self.order.pop(&key);
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
                self.order.pop(&key);
                None
            }
        }
    }

    /// Persist `bytes` under `key`. Existing files for the same key are
    /// overwritten via atomic rename to avoid leaving torn writes if the
    /// process crashes mid-write. Returns the (possibly empty) list of paths
    /// the caller should sweep, in case the LRU evicted older entries to make
    /// room.
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

        // Update LRU order; evict overflow.
        if let Some((evicted_key, _)) = self.order.push(key, ()) {
            if evicted_key != key {
                let _ = fs::remove_file(file_path(&self.dir, evicted_key));
            }
        }
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
        }
    }
}

/// Convenience for callers that just want the standard capacity.
pub fn open_default(workspace_root: &Path) -> DiskCache {
    DiskCache::open(workspace_root, DEFAULT_CAPACITY)
}
