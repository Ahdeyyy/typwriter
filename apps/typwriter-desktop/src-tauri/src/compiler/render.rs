// compiler/render.rs
//
// Renders a single typst `Page` to raw PNG bytes at the given scale factor.
// The resulting bytes are then base64-encoded by the caller before being sent
// over Tauri IPC.

use typst::layout::Page;

/// Render a single page to PNG bytes.
///
/// `scale` is the number of device pixels per typst "point" (pt).
/// A scale of `1.0` gives 72 dpi; `2.0` gives 144 dpi (retina-equivalent).
pub fn render_page(page: &Page, scale: f32) -> Result<Vec<u8>, String> {
    let pixmap = typst_render::render(page, scale);
    pixmap.encode_png().map_err(|e| e.to_string())
}
