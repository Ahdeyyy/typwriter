// compiler/render.rs
//
// Renders a single typst `Page` to raw PNG bytes at the given scale factor.
// The resulting bytes are then base64-encoded by the caller before being sent
// over Tauri IPC.
//
// Uses fast PNG compression (level 1 + Sub filter) for preview performance.

use png::{BitDepth, ColorType, Compression, Encoder, Filter};
use typst::layout::Page;

/// Render a single page to PNG bytes using fast compression.
///
/// `scale` is the number of device pixels per typst "point" (pt).
/// A scale of `1.0` gives 72 dpi; `2.0` gives 144 dpi (retina-equivalent).
pub fn render_page(page: &Page, scale: f32) -> Result<Vec<u8>, String> {
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
