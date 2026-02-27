// compiler/cache.rs
//
// A bounded LRU cache for already-rendered pages. Keys are `PageFingerprint`
// (128-bit hash of the frame content), values are base64-encoded PNG strings
// ready to be sent over Tauri IPC.
//
// Because pages are keyed by *content hash* rather than by index, a page that
// moves to a different position in the document is still a cache hit.

use lru::LruCache;
use std::num::NonZeroUsize;

use super::diff::PageFingerprint;

/// Default number of rendered pages to keep in the LRU cache.
const DEFAULT_CAPACITY: usize = 64;

pub struct PageCache(LruCache<PageFingerprint, String>);

impl PageCache {
    pub fn new(capacity: usize) -> Self {
        let cap = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(1).unwrap());
        Self(LruCache::new(cap))
    }

    /// Retrieve a cached base64-PNG string (promotes entry to most-recent).
    pub fn get(&mut self, fp: PageFingerprint) -> Option<&String> {
        self.0.get(&fp)
    }

    /// Store a base64-PNG string in the cache.
    pub fn insert(&mut self, fp: PageFingerprint, b64_png: String) {
        self.0.put(fp, b64_png);
    }

    /// Remove all entries from the cache (e.g. after the main file changes).
    pub fn clear(&mut self) {
        self.0.clear();
    }
}

impl Default for PageCache {
    fn default() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }
}
