// compiler/cache.rs
//
// A bounded LRU cache for already-rendered pages. Keys are
// `(PageFingerprint, ZoomBucket)`: a 128-bit hash of the frame content paired
// with the rasterization scale (zoom * 1000, rounded). Two requirements drive
// the composite key:
//
//   * Bytes at a given URL must be immutable for the lifetime of the cache
//     entry — we promise that via `Cache-Control: immutable` to the webview.
//     A page rendered at 2x and 4x produces different bytes, so the URLs
//     (and therefore the keys) must differ.
//
//   * Zooming back to a previously-rendered scale should be instant. Keeping
//     entries for multiple zoom levels lets the LRU naturally serve those hits.

use lru::LruCache;
use std::num::NonZeroUsize;

use super::diff::PageFingerprint;

/// Composite key: (page content hash, zoom bucket).
///
/// `ZoomBucket = round(zoom * 1000)`. Quantizing avoids floating-point key
/// pathology and makes URLs human-readable.
pub type ZoomBucket = u32;
pub type PageCacheKey = (PageFingerprint, ZoomBucket);

/// Convert a zoom scale (pixels per typst point) to the `ZoomBucket` used in
/// cache keys and URL paths.
pub fn zoom_to_bucket(zoom: f32) -> ZoomBucket {
    (zoom * 1000.0).round().max(0.0) as ZoomBucket
}

/// Default number of rendered pages to keep in the LRU cache. Sized
/// generously so the URI-scheme handler almost never sees an evicted
/// key while a webview is still trying to fetch it. With zoom now in the
/// key, the same page rendered at multiple scales occupies multiple slots,
/// so the capacity is bumped accordingly.
const DEFAULT_CAPACITY: usize = 512;

pub struct PageCache(LruCache<PageCacheKey, Vec<u8>>);

impl PageCache {
    pub fn new(capacity: usize) -> Self {
        const ONE: NonZeroUsize = NonZeroUsize::new(1).expect("1 is non-zero");
        let cap = NonZeroUsize::new(capacity).unwrap_or(ONE);
        Self(LruCache::new(cap))
    }

    /// Retrieve cached PNG bytes (promotes entry to most-recent).
    pub fn get(&mut self, key: PageCacheKey) -> Option<&Vec<u8>> {
        self.0.get(&key)
    }

    /// Look up cached PNG bytes without touching LRU ordering.
    pub fn peek(&self, key: PageCacheKey) -> Option<&Vec<u8>> {
        self.0.peek(&key)
    }

    /// Store PNG bytes in the cache.
    pub fn insert(&mut self, key: PageCacheKey, png: Vec<u8>) {
        self.0.put(key, png);
    }

    /// Remove all entries from the cache (e.g. when the workspace changes).
    pub fn clear(&mut self) {
        self.0.clear();
    }
}

impl Default for PageCache {
    fn default() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }
}

/// Encode a `PageCacheKey` as the URL path component used by the
/// `previewimg://` scheme. Format: `<128-bit-hex>-<zoom-bucket>`.
///
/// Pairing zoom with the fingerprint is what makes the URL change when the
/// user zooms — the webview's HTTP cache (which we marked `immutable`) only
/// re-fetches when the URL changes, so a content-only key produced stale
/// images after zoom changes.
pub fn key_to_path(key: PageCacheKey) -> String {
    let (fp, zoom) = key;
    format!("{fp:032x}-{zoom}")
}

/// Parse a URL path back into a `PageCacheKey`. Accepts a bare
/// `<hex>-<zoom>` or `<hex>-<zoom>.png`. Returns `None` on any malformed
/// input.
pub fn parse_key(s: &str) -> Option<PageCacheKey> {
    let body = s.strip_suffix(".png").unwrap_or(s);
    let (hex, zoom) = body.rsplit_once('-')?;
    let fp = u128::from_str_radix(hex, 16).ok()?;
    let zoom = zoom.parse::<ZoomBucket>().ok()?;
    Some((fp, zoom))
}
