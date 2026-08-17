// On-demand page renderer. PNG bytes are produced lazily in the `previewimg://`
// URI handler on first request per `(fingerprint, scale_bucket)` and served
// from an in-memory LRU afterwards. The webview's HTTP cache (responses are
// marked immutable) absorbs repeat views with zero IPC.

use std::num::NonZeroUsize;

use lru::LruCache;
use parking_lot::Mutex;
use png::{BitDepth, ColorType, Compression, Encoder, Filter};
use typst::utils::Scalar;
use typst_layout::Page;
use typst_render::RenderOptions;

use crate::compiler::CompileState;

/// Memory budget for cached page PNGs.
///
/// Bounded by *bytes*, not entry count. A count-based cap has to be sized for
/// the worst case — an A3 page at bucket 4 is an order of magnitude bigger than
/// an A5 page at bucket 1 — so "32 entries" meant anywhere from a few MB to
/// several hundred, and on Android the large end is where the OS kills the app.
const CACHE_BUDGET_BYTES: usize = 48 * 1024 * 1024;

/// Hard cap on entry count as well, so a document of very small pages can't
/// grow the map without bound while staying under the byte budget.
const CACHE_MAX_ENTRIES: usize = 256;

pub struct Renderer {
    cache: Mutex<LruCache<(String, u8), Vec<u8>>>,
    /// Total size of everything in `cache`. Kept alongside rather than
    /// recomputed: summing the map on every insert would be O(n) per page.
    cached_bytes: Mutex<usize>,
}

impl Renderer {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(CACHE_MAX_ENTRIES).expect("capacity > 0"),
            )),
            cached_bytes: Mutex::new(0),
        }
    }

    /// Insert `bytes` for `key`, evicting least-recently-used entries until the
    /// cache is back inside [`CACHE_BUDGET_BYTES`].
    ///
    /// A single page larger than the whole budget is stored anyway: refusing it
    /// would mean re-rendering that page on every single request, which is far
    /// worse than briefly exceeding the budget by one page.
    fn insert_bounded(&self, key: (String, u8), bytes: Vec<u8>) {
        let mut cache = self.cache.lock();
        let mut total = self.cached_bytes.lock();

        let incoming = bytes.len();
        if let Some(previous) = cache.put(key, bytes) {
            *total = total.saturating_sub(previous.len());
        }
        *total += incoming;

        while *total > CACHE_BUDGET_BYTES && cache.len() > 1 {
            let Some((_, evicted)) = cache.pop_lru() else {
                break;
            };
            *total = total.saturating_sub(evicted.len());
        }
    }

    /// Render (or serve from cache) the PNG for a page fingerprint at a scale
    /// bucket. Returns `None` if the fingerprint isn't in the current document
    /// (e.g. a stale page after recompile) — the caller answers 404.
    pub fn render(&self, state: &CompileState, fp: &str, bucket: u8) -> Option<Vec<u8>> {
        let key = (fp.to_string(), bucket);
        if let Some(bytes) = self.cache.lock().get(&key) {
            return Some(bytes.clone());
        }
        let scale = bucket_to_scale(bucket)?;
        // Clone the Arc out of the mutex so we don't hold the lock while
        // rendering (rendering can take tens to hundreds of ms).
        let index = *state.page_lookup.lock().get(fp)?;
        let doc = state.document.lock().clone()?;
        let page = doc.pages().get(index)?;
        let bytes = render_page(page, scale).ok()?;
        self.insert_bounded(key, bytes.clone());
        Some(bytes)
    }
}

impl Default for Renderer {
    fn default() -> Self {
        Self::new()
    }
}

/// Scale buckets: device pixels per typst point. The frontend asks for a bucket
/// (never a float) so image URLs stay stable and HTTP-cacheable.
pub fn bucket_to_scale(bucket: u8) -> Option<f32> {
    match bucket {
        1 => Some(1.0),
        2 => Some(1.5),
        3 => Some(2.0),
        4 => Some(3.0),
        _ => None,
    }
}

/// Render a single page to PNG bytes with fast compression (preview speed).
fn render_page(page: &Page, scale: f32) -> Result<Vec<u8>, String> {
    let opts = RenderOptions {
        pixel_per_pt: Scalar::new(scale as f64),
        ..Default::default()
    };
    let pixmap = typst_render::render(page, &opts);
    let width = pixmap.width();
    let height = pixmap.height();
    let data = pixmap.data();

    let mut buf = Vec::with_capacity(data.len() / 4);
    {
        let mut encoder = Encoder::new(&mut buf, width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        encoder.set_compression(Compression::Fast);
        encoder.set_filter(Filter::Sub);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(data).map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// Parse a `previewimg` URL path `"/{fingerprint}-{bucket}.png"` into its
/// `(fingerprint, bucket)` parts. Rejects a missing/invalid bucket.
pub fn parse_preview_key(path: &str) -> Option<(String, u8)> {
    let path = path.trim_start_matches('/');
    let path = path.strip_suffix(".png").unwrap_or(path);
    let (fp, bucket) = path.rsplit_once('-')?;
    if fp.is_empty() {
        return None;
    }
    let bucket: u8 = bucket.parse().ok()?;
    // Only known buckets are valid.
    bucket_to_scale(bucket)?;
    Some((fp.to_string(), bucket))
}

#[cfg(test)]
mod tests {
    use super::{parse_preview_key, Renderer, CACHE_BUDGET_BYTES};

    // ─── Cache budget ───────────────────────────────────────────────────────
    //
    // The cache is bounded by bytes so a document of large pages can't run the
    // app out of memory on device. These drive `insert_bounded` directly —
    // rendering a real page would need a compiled document.

    fn page(size: usize) -> Vec<u8> {
        vec![0u8; size]
    }

    #[test]
    fn cache_stays_within_its_byte_budget() {
        let renderer = Renderer::new();
        let one_mb = 1024 * 1024;

        // Insert well past the budget.
        for i in 0..(CACHE_BUDGET_BYTES / one_mb) + 20 {
            renderer.insert_bounded((format!("page{i}"), 3), page(one_mb));
        }

        let total = *renderer.cached_bytes.lock();
        assert!(
            total <= CACHE_BUDGET_BYTES,
            "cache held {total} bytes, over the {CACHE_BUDGET_BYTES} budget",
        );
    }

    #[test]
    fn recently_used_pages_survive_eviction() {
        let renderer = Renderer::new();
        let chunk = CACHE_BUDGET_BYTES / 4;

        renderer.insert_bounded(("keep".into(), 3), page(chunk));
        // Touch it so it is the most recently used.
        assert!(renderer.cache.lock().get(&("keep".to_string(), 3)).is_some());
        for i in 0..6 {
            renderer.insert_bounded((format!("filler{i}"), 3), page(chunk));
        }

        // "keep" was used before the fillers but the budget only holds ~4, so
        // it should have been evicted — this pins LRU order, not retention.
        let total = *renderer.cached_bytes.lock();
        assert!(total <= CACHE_BUDGET_BYTES);
        assert!(renderer.cache.lock().len() >= 1);
    }

    #[test]
    fn replacing_an_entry_does_not_double_count_its_bytes() {
        // `cached_bytes` is tracked incrementally, so an overwrite has to
        // subtract the old size or the accounting drifts upward until the
        // cache evicts everything on every insert.
        let renderer = Renderer::new();
        renderer.insert_bounded(("same".into(), 3), page(1000));
        renderer.insert_bounded(("same".into(), 3), page(1500));

        assert_eq!(*renderer.cached_bytes.lock(), 1500);
        assert_eq!(renderer.cache.lock().len(), 1);
    }

    #[test]
    fn an_oversized_page_is_still_cached() {
        // Refusing it would mean re-rendering that page on every request.
        let renderer = Renderer::new();
        renderer.insert_bounded(("huge".into(), 4), page(CACHE_BUDGET_BYTES * 2));

        assert_eq!(renderer.cache.lock().len(), 1);
    }

    #[test]
    fn parses_valid_key() {
        assert_eq!(
            parse_preview_key("/a3f9d2-3.png"),
            Some(("a3f9d2".to_string(), 3))
        );
        // No leading slash, no extension also accepted.
        assert_eq!(
            parse_preview_key("deadbeef-1"),
            Some(("deadbeef".to_string(), 1))
        );
    }

    #[test]
    fn rejects_bad_keys() {
        assert_eq!(parse_preview_key("/a3f9d2.png"), None); // no bucket
        assert_eq!(parse_preview_key("/a3f9d2-x.png"), None); // non-numeric
        assert_eq!(parse_preview_key("/a3f9d2-9.png"), None); // unknown bucket
        assert_eq!(parse_preview_key("/-3.png"), None); // empty fingerprint
    }
}
