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

use std::sync::Arc;

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
}

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct PngExportConfig {
    pub dir: String,
    /// Pixels per point.  1.0 → 72 dpi, 2.0 → 144 dpi (retina).
    pub scale: Option<f32>,
    pub prefix: Option<String>,
}

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct SvgExportConfig {
    pub dir: String,
    pub prefix: Option<String>,
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

    // ─── Main pipeline ─────────────────────────────────────────────────────

    /// Run the full compile→diff→render pipeline and emit Tauri events for
    /// anything that changed.
    pub fn trigger_compile_and_emit(&self) {
        let CompileOutput {
            document,
            errors,
            warnings,
        } = compile_document(&*self.world);

        // Always emit diagnostics so the frontend can clear/show them.
        let _ = self.app_handle.emit(
            "compile:diagnostics",
            DiagnosticsPayload { errors, warnings },
        );

        let doc = match document {
            Some(d) => d,
            None => return,
        };

        let new_fps = fingerprint_pages(&doc);
        let old_fps = self.last_fingerprints.lock().clone();

        let (changed_indices, removed_count) = diff_pages(&old_fps, &new_fps);

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

        // Parallel pass: render only cache misses.
        let rendered: Vec<(usize, PageFingerprint, Vec<u8>)> = cache_misses
            .par_iter()
            .filter_map(|&idx| {
                let fp = new_fps[idx];
                let page = &doc.pages[idx];
                let png = render_page(page, zoom).ok()?;
                Some((idx, fp, png))
            })
            .collect();

        // Emit cache hits.
        for (idx, b64) in cache_hits {
            let _ = self.app_handle.emit(
                "preview:page-updated",
                PageUpdatedPayload {
                    index: idx,
                    data: b64,
                },
            );
        }

        // Store rendered results in cache and emit.
        {
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

        // Update stored state.
        *self.last_fingerprints.lock() = new_fps;
        *self.last_document.lock() = Some(Arc::new(doc));
    }

    // ─── Export ────────────────────────────────────────────────────────────

    pub fn export_pdf(&self, config: PdfExportConfig) -> Result<(), String> {
        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or("No compiled document available")?
            .clone();

        let options = typst_pdf::PdfOptions {
            ident: typst::foundations::Smart::Auto,
            timestamp: None,
            standards: typst_pdf::PdfStandards::default(),
            page_ranges: None,
            tagged: true,
        };

        let bytes = typst_pdf::pdf(&doc, &options).map_err(|e| {
            e.iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("; ")
        })?;
        std::fs::write(&config.path, bytes).map_err(|e| e.to_string())
    }

    pub fn export_png(&self, config: PngExportConfig) -> Result<(), String> {
        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or("No compiled document available")?
            .clone();

        let scale = config.scale.unwrap_or(2.0);
        let prefix = config.prefix.as_deref().unwrap_or("page");
        let dir = std::path::Path::new(&config.dir);
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

        for (i, page) in doc.pages.iter().enumerate() {
            let png = render_page(page, scale)?;
            let filename = format!("{}-{}.png", prefix, i + 1);
            std::fs::write(dir.join(filename), png).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn export_svg(&self, config: SvgExportConfig) -> Result<(), String> {
        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or("No compiled document available")?
            .clone();

        let prefix = config.prefix.as_deref().unwrap_or("page");
        let dir = std::path::Path::new(&config.dir);
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

        for (i, page) in doc.pages.iter().enumerate() {
            let svg = typst_svg::svg(page);
            let filename = format!("{}-{}.svg", prefix, i + 1);
            std::fs::write(dir.join(filename), svg.as_str()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
