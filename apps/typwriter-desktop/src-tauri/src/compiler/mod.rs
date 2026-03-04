// compiler/mod.rs
//
// PreviewPipeline orchestrates the full compile → diff → render → emit cycle.
//
// Only pages whose frame content actually changed between two consecutive
// compilations are re-rendered.  All other pages are either served from the
// PageCache (keyed by content hash, not index) or do nothing.

mod cache;
mod compile;
mod diff;
mod render;

pub use compile::{compile_document, CompileOutput, SerializedDiagnostic};
pub use diff::{diff_pages, fingerprint_pages, PageFingerprint};
pub use render::render_page;

use std::{sync::Arc, time::Instant};

use log::{error, info, warn};
use parking_lot::Mutex;

use base64::Engine;
use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::world::EditorWorld;
use cache::PageCache;
use typst::layout::PagedDocument;

// ─── IPC event payloads ───────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct DiagnosticsPayload {
    errors: Vec<SerializedDiagnostic>,
    warnings: Vec<SerializedDiagnostic>,
}

#[derive(Serialize, Clone)]
struct TotalPagesPayload {
    count: usize,
}

#[derive(Serialize, Clone)]
struct PageUpdatedPayload {
    index: usize,
    /// Base64-encoded PNG
    data: String,
}

#[derive(Serialize, Clone)]
struct PageRemovedPayload {
    index: usize,
}

// ─── Export config types ──────────────────────────────────────────────────────

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct PdfExportConfig {
    pub path: String,
    pub title: Option<String>,
    pub author: Option<String>,
    /// PDF standard identifier: "1.7", "a-2b", etc. None means default (1.7).
    pub pdf_standard: Option<String>,
}

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct PngExportConfig {
    pub dir: String,
    /// Pixels per point.  1.0 → 72 dpi, 2.0 → 144 dpi (retina).
    pub scale: Option<f32>,
    pub prefix: Option<String>,
    /// Page range string like "1-3, 5, 7-9". None means all pages.
    pub page_range: Option<String>,
}

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct SvgExportConfig {
    pub dir: String,
    pub prefix: Option<String>,
    /// Page range string like "1-3, 5, 7-9". None means all pages.
    pub page_range: Option<String>,
}

// ─── Export helpers ──────────────────────────────────────────────────────────

/// Parse a page range string like "1-3, 5, 7-9" into sorted, deduplicated
/// zero-indexed page indices, validated against the total page count.
fn parse_page_indices(range_str: &str, total_pages: usize) -> Result<Vec<usize>, String> {
    let mut indices = Vec::new();
    for part in range_str.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let start: usize = a
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page number: '{}'", a.trim()))?;
            let end: usize = b
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page number: '{}'", b.trim()))?;
            if start == 0 || end == 0 {
                return Err("Page numbers must be 1 or greater".into());
            }
            if start > end {
                return Err(format!("Invalid range: {start}-{end}"));
            }
            if end > total_pages {
                return Err(format!(
                    "Page {end} exceeds document length ({total_pages})"
                ));
            }
            for p in start..=end {
                indices.push(p - 1);
            }
        } else {
            let p: usize = part
                .parse()
                .map_err(|_| format!("Invalid page number: '{part}'"))?;
            if p == 0 {
                return Err("Page numbers must be 1 or greater".into());
            }
            if p > total_pages {
                return Err(format!(
                    "Page {p} exceeds document length ({total_pages})"
                ));
            }
            indices.push(p - 1);
        }
    }
    if indices.is_empty() {
        return Err("No pages specified".into());
    }
    indices.sort();
    indices.dedup();
    Ok(indices)
}

/// Parse a PDF standard identifier string into PdfStandards.
fn parse_pdf_standard(s: &str) -> Result<typst_pdf::PdfStandards, String> {
    let standard = match s.trim().to_lowercase().as_str() {
        "1.4" => typst_pdf::PdfStandard::V_1_4,
        "1.5" => typst_pdf::PdfStandard::V_1_5,
        "1.6" => typst_pdf::PdfStandard::V_1_6,
        "1.7" => typst_pdf::PdfStandard::V_1_7,
        "2.0" => typst_pdf::PdfStandard::V_2_0,
        "a-1b" => typst_pdf::PdfStandard::A_1b,
        "a-2b" => typst_pdf::PdfStandard::A_2b,
        "a-3b" => typst_pdf::PdfStandard::A_3b,
        "a-4" => typst_pdf::PdfStandard::A_4,
        other => return Err(format!("Unknown PDF standard: '{other}'")),
    };
    typst_pdf::PdfStandards::new(&[standard])
        .map_err(|e| format!("Invalid PDF standard: {e}"))
}

// ─── PreviewPipeline ──────────────────────────────────────────────────────────

pub struct PreviewPipeline {
    world: Arc<EditorWorld>,
    last_fingerprints: Mutex<Vec<PageFingerprint>>,
    page_cache: Mutex<PageCache>,
    /// The most recently successfully compiled document.
    /// Held so IDE features (hover, go-to-def, jump-from-click) can use it.
    pub last_document: Mutex<Option<Arc<PagedDocument>>>,
    app_handle: AppHandle,
    /// Preview zoom: pixels per typst point.  Default 2.0 (retina).
    pub zoom: Mutex<f32>,
    /// The page index currently visible in the frontend preview pane.
    /// Used to prioritise rendering so the user sees instant updates.
    visible_page: Mutex<usize>,
}

impl PreviewPipeline {
    pub fn new(world: Arc<EditorWorld>, app_handle: AppHandle) -> Self {
        Self {
            world,
            last_fingerprints: Mutex::new(Vec::new()),
            page_cache: Mutex::new(PageCache::default()),
            last_document: Mutex::new(None),
            app_handle,
            zoom: Mutex::new(2.0),
            visible_page: Mutex::new(0),
        }
    }

    /// Clear the page cache (e.g. when the main file is changed).
    pub fn invalidate_cache(&self) {
        self.page_cache.lock().clear();
        *self.last_fingerprints.lock() = Vec::new();
    }

    /// Set the preview zoom level and force a full re-render of all pages.
    pub fn set_zoom(&self, zoom: f32) {
        *self.zoom.lock() = zoom;
        self.invalidate_cache();
    }

    /// Update which page the frontend is currently showing.
    pub fn set_visible_page(&self, page: usize) {
        *self.visible_page.lock() = page;
    }

    // ─── Main pipeline ─────────────────────────────────────────────────────

    /// Run the full compile→diff→render pipeline and emit Tauri events for
    /// anything that changed.
    pub fn trigger_compile_and_emit(&self) {
        let t = Instant::now();
        info!("trigger_compile_and_emit: starting compile");

        let CompileOutput {
            document,
            errors,
            warnings,
        } = compile_document(&*self.world);

        let compile_ms = t.elapsed().as_secs_f64() * 1000.0;

        if !errors.is_empty() {
            warn!(
                "trigger_compile_and_emit: compile finished with {} error(s), {} warning(s) ({:.1}ms)",
                errors.len(), warnings.len(), compile_ms
            );
            for e in &errors {
                warn!("  compile error: [{}] {}", e.file_path.as_deref().unwrap_or("?"), e.message);
            }
        } else {
            info!(
                "trigger_compile_and_emit: compile ok — {} warning(s) ({:.1}ms)",
                warnings.len(), compile_ms
            );
        }

        // Always emit diagnostics so the frontend can clear/show them.
        if let Err(e) = self.app_handle.emit(
            "compile:diagnostics",
            DiagnosticsPayload { errors, warnings },
        ) {
            error!("trigger_compile_and_emit: failed to emit compile:diagnostics err=\"{e}\"");
        }

        let doc = match document {
            Some(d) => d,
            None => {
                info!("trigger_compile_and_emit: no document produced, skipping render");
                return;
            }
        };

        let new_fps = fingerprint_pages(&doc);
        let old_fps = self.last_fingerprints.lock().clone();

        let (changed_indices, removed_count) = diff_pages(&old_fps, &new_fps);
        info!(
            "trigger_compile_and_emit: diff — {} page(s) changed, {} removed, {} total",
            changed_indices.len(), removed_count, new_fps.len()
        );

        // Emit total page count.
        let _ = self.app_handle.emit(
            "preview:total-pages",
            TotalPagesPayload {
                count: new_fps.len(),
            },
        );

        // Emit removals (high index first so frontend can splice cleanly).
        for i in (new_fps.len()..new_fps.len() + removed_count).rev() {
            let _ = self
                .app_handle
                .emit("preview:page-removed", PageRemovedPayload { index: i });
        }

        // Render dirty pages, using cache where possible.
        let zoom = *self.zoom.lock();
        let vis = *self.visible_page.lock();

        // Sequential pass: check cache for hits.
        let mut cache_hits: Vec<(usize, String)> = Vec::new();
        let mut cache_misses: Vec<usize> = Vec::new();
        {
            let mut cache = self.page_cache.lock();
            for &idx in &changed_indices {
                let fp = new_fps[idx];
                if let Some(b64) = cache.get(fp) {
                    cache_hits.push((idx, b64.clone()));
                } else {
                    cache_misses.push(idx);
                }
            }
        }

        info!(
            "trigger_compile_and_emit: render — {} cache hit(s), {} cache miss(es) zoom={zoom}",
            cache_hits.len(), cache_misses.len()
        );

        // Emit cache hits (visible page first).
        // Sort so visible page cache hit is emitted first.
        cache_hits.sort_by_key(|(idx, _)| if *idx == vis { 0 } else { 1 });
        for (idx, b64) in cache_hits {
            let _ = self.app_handle.emit(
                "preview:page-updated",
                PageUpdatedPayload {
                    index: idx,
                    data: b64,
                },
            );
        }

        let render_t = Instant::now();

        // Priority pass: render the visible page first (if it's a cache miss).
        let (priority_misses, rest_misses): (Vec<usize>, Vec<usize>) = cache_misses
            .into_iter()
            .partition(|&idx| idx == vis);

        for idx in &priority_misses {
            let fp = new_fps[*idx];
            let page = &doc.pages[*idx];
            match render_page(page, zoom) {
                Ok(png) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                    self.page_cache.lock().insert(fp, b64.clone());
                    let _ = self.app_handle.emit(
                        "preview:page-updated",
                        PageUpdatedPayload { index: *idx, data: b64 },
                    );
                    info!(
                        "trigger_compile_and_emit: priority page {} emitted ({:.1}ms)",
                        idx, render_t.elapsed().as_secs_f64() * 1000.0
                    );
                }
                Err(e) => {
                    error!("trigger_compile_and_emit: render error page={idx} err=\"{e}\"");
                }
            }
        }

        // Eagerly commit the new fingerprints after the priority render so that
        // any concurrent pipeline run that starts while the rayon batch below is
        // executing will read up-to-date fingerprints.  Without this, a second
        // run would find the priority page in the cache (we just inserted it)
        // and re-emit it as a cache hit, causing a double render on the frontend.
        if !priority_misses.is_empty() {
            *self.last_fingerprints.lock() = new_fps.clone();
        }

        // Remaining pages: render in parallel via rayon.
        if !rest_misses.is_empty() {
            let rendered: Vec<(usize, PageFingerprint, Vec<u8>)> = rest_misses
                .par_iter()
                .filter_map(|&idx| {
                    let fp = new_fps[idx];
                    let page = &doc.pages[idx];
                    match render_page(page, zoom) {
                        Ok(png) => Some((idx, fp, png)),
                        Err(e) => {
                            error!("trigger_compile_and_emit: render error page={idx} err=\"{e}\"");
                            None
                        }
                    }
                })
                .collect();

            let mut cache = self.page_cache.lock();
            for (idx, fp, png) in rendered {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                cache.insert(fp, b64.clone());
                let _ = self.app_handle.emit(
                    "preview:page-updated",
                    PageUpdatedPayload {
                        index: idx,
                        data: b64,
                    },
                );
            }
        }

        let total_misses = priority_misses.len() + rest_misses.len();
        if total_misses > 0 {
            info!(
                "trigger_compile_and_emit: rendered {} page(s) ({:.1}ms)",
                total_misses, render_t.elapsed().as_secs_f64() * 1000.0
            );
        }

        // Update stored state.
        *self.last_fingerprints.lock() = new_fps;
        *self.last_document.lock() = Some(Arc::new(doc));

        info!(
            "trigger_compile_and_emit: done — total {:.1}ms",
            t.elapsed().as_secs_f64() * 1000.0
        );
    }

    // ─── Export ────────────────────────────────────────────────────────────

    pub fn export_pdf(&self, config: PdfExportConfig) -> Result<(), String> {
        let t = Instant::now();
        info!("export_pdf: path={:?}", config.path);

        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or_else(|| {
                let e = "No compiled document available";
                error!("export_pdf: err=\"{e}\"");
                e.to_string()
            })?
            .clone();

        let standards = match &config.pdf_standard {
            Some(s) if !s.trim().is_empty() => parse_pdf_standard(s)?,
            _ => typst_pdf::PdfStandards::default(),
        };

        let options = typst_pdf::PdfOptions {
            ident: typst::foundations::Smart::Auto,
            timestamp: None,
            standards,
            page_ranges: None,
            tagged: true,
        };

        let bytes = typst_pdf::pdf(&doc, &options).map_err(|e| {
            let msg = e.iter().map(|d| d.message.to_string()).collect::<Vec<_>>().join("; ");
            error!("export_pdf: pdf generation failed err=\"{msg}\" ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            msg
        })?;

        std::fs::write(&config.path, &bytes).map_err(|e| {
            error!("export_pdf: write failed path={:?} err=\"{e}\" ({:.1}ms)", config.path, t.elapsed().as_secs_f64() * 1000.0);
            e.to_string()
        })?;

        info!("export_pdf: ok — {} bytes ({:.1}ms)", bytes.len(), t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    pub fn export_png(&self, config: PngExportConfig) -> Result<(), String> {
        let t = Instant::now();
        info!("export_png: dir={:?} scale={:?} prefix={:?}", config.dir, config.scale, config.prefix);

        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or_else(|| {
                let e = "No compiled document available";
                error!("export_png: err=\"{e}\"");
                e.to_string()
            })?
            .clone();

        let scale = config.scale.unwrap_or(2.0);
        let prefix = config.prefix.as_deref().unwrap_or("page");
        let dir = std::path::Path::new(&config.dir);
        std::fs::create_dir_all(dir).map_err(|e| {
            error!("export_png: create_dir_all failed dir={:?} err=\"{e}\"", config.dir);
            e.to_string()
        })?;

        let indices: Vec<usize> = match &config.page_range {
            Some(s) if !s.trim().is_empty() => parse_page_indices(s, doc.pages.len())?,
            _ => (0..doc.pages.len()).collect(),
        };

        for &i in &indices {
            let page = &doc.pages[i];
            let png = render_page(page, scale).map_err(|e| {
                error!("export_png: render failed page={i} err=\"{e}\"");
                e
            })?;
            let filename = format!("{}-{}.png", prefix, i + 1);
            std::fs::write(dir.join(&filename), png).map_err(|e| {
                error!("export_png: write failed file={filename:?} err=\"{e}\"");
                e.to_string()
            })?;
        }

        info!("export_png: ok — {} page(s) ({:.1}ms)", indices.len(), t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }

    pub fn export_svg(&self, config: SvgExportConfig) -> Result<(), String> {
        let t = Instant::now();
        info!("export_svg: dir={:?} prefix={:?}", config.dir, config.prefix);

        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or_else(|| {
                let e = "No compiled document available";
                error!("export_svg: err=\"{e}\"");
                e.to_string()
            })?
            .clone();

        let prefix = config.prefix.as_deref().unwrap_or("page");
        let dir = std::path::Path::new(&config.dir);
        std::fs::create_dir_all(dir).map_err(|e| {
            error!("export_svg: create_dir_all failed dir={:?} err=\"{e}\"", config.dir);
            e.to_string()
        })?;

        let indices: Vec<usize> = match &config.page_range {
            Some(s) if !s.trim().is_empty() => parse_page_indices(s, doc.pages.len())?,
            _ => (0..doc.pages.len()).collect(),
        };

        for &i in &indices {
            let page = &doc.pages[i];
            let svg = typst_svg::svg(page);
            let filename = format!("{}-{}.svg", prefix, i + 1);
            std::fs::write(dir.join(&filename), svg.as_str()).map_err(|e| {
                error!("export_svg: write failed file={filename:?} err=\"{e}\"");
                e.to_string()
            })?;
        }

        info!("export_svg: ok — {} page(s) ({:.1}ms)", indices.len(), t.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    }
}
