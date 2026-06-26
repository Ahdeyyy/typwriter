// renderer.rs
//
// On-demand page renderer. PNG bytes are produced lazily in the `previewimg://`
// URI handler on first request per `(fingerprint, scale_bucket)` and served
// from an in-memory LRU afterwards. The webview's HTTP cache (responses are
// marked immutable) absorbs repeat views with zero IPC.

use std::num::NonZeroUsize;

use lru::LruCache;
use parking_lot::Mutex;
use png::{BitDepth, ColorType, Compression, Encoder, Filter};
use typst::layout::Page;

use crate::compiler::CompileState;

/// LRU capacity. A 2.0x A4 page is ~1–2 MB PNG; 32 entries bounds worst case
/// to roughly 64 MB. Easy to change.
const CACHE_CAPACITY: usize = 32;

pub struct Renderer {
    cache: Mutex<LruCache<(String, u8), Vec<u8>>>,
}

impl Renderer {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(CACHE_CAPACITY).expect("capacity > 0"),
            )),
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
        let page = doc.pages.get(index)?;
        let bytes = render_page(page, scale).ok()?;
        self.cache.lock().put(key, bytes.clone());
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
    let pixmap = typst_render::render(page, scale);
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
    use super::parse_preview_key;

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
