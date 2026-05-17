// compiler/cache.rs
//
// A bounded LRU cache for already-rendered pages. Keys are `PageFingerprint`
// (128-bit hash of the frame content), values are raw PNG bytes ready to be
// served over the `previewimg` URI scheme.
//
// Because pages are keyed by *content hash* rather than by index, a page that
// moves to a different position in the document is still a cache hit.

use lru::LruCache;
use std::num::NonZeroUsize;

use super::diff::PageFingerprint;

/// Default number of rendered pages to keep in the LRU cache. Sized
/// generously so the URI-scheme handler almost never sees an evicted
/// fingerprint while a webview is still trying to fetch it.
const DEFAULT_CAPACITY: usize = 256;

pub struct PageCache(LruCache<PageFingerprint, Vec<u8>>);

impl PageCache {
    pub fn new(capacity: usize) -> Self {
        const ONE: NonZeroUsize = NonZeroUsize::new(1).expect("1 is non-zero");
        let cap = NonZeroUsize::new(capacity).unwrap_or(ONE);
        Self(LruCache::new(cap))
    }

    /// Retrieve cached PNG bytes (promotes entry to most-recent).
    pub fn get(&mut self, fp: PageFingerprint) -> Option<&Vec<u8>> {
        self.0.get(&fp)
    }

    /// Look up cached PNG bytes without touching LRU ordering.
    pub fn peek(&self, fp: PageFingerprint) -> Option<&Vec<u8>> {
        self.0.peek(&fp)
    }

    /// Store PNG bytes in the cache.
    pub fn insert(&mut self, fp: PageFingerprint, png: Vec<u8>) {
        self.0.put(fp, png);
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

/// Encode a `PageFingerprint` (128-bit) into a lowercase hex string used as
/// the path component of a `previewimg://` URL.
pub fn fingerprint_to_hex(fp: PageFingerprint) -> String {
    format!("{fp:032x}")
}

/// Parse a hex string back into a `PageFingerprint`. Returns `None` on any
/// malformed input. The handler accepts the bare hex or `<hex>.png`.
pub fn parse_fingerprint(s: &str) -> Option<PageFingerprint> {
    let hex = s.strip_suffix(".png").unwrap_or(s);
    u128::from_str_radix(hex, 16).ok()
}
