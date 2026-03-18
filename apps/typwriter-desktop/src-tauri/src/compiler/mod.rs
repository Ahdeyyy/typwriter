// compiler/mod.rs
//
// PreviewPipeline orchestrates the full compile -> diff -> render -> emit cycle.
//
// Only pages whose frame content actually changed between two consecutive
// compilations are re-rendered. All other pages are either served from the
// PageCache (keyed by content hash, not index) or do nothing.

mod cache;
mod compile;
mod diff;
mod render;

pub use compile::{compile_document, collect_workspace_diagnostics, dedup_merge, CompileOutput, SerializedDiagnostic};
pub use diff::{diff_pages, fingerprint_pages, PageFingerprint};
pub use render::render_page;

use std::{sync::Arc, thread, time::Instant};

use log::{error, info, warn};
use parking_lot::Mutex;

use base64::Engine;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::world::EditorWorld;
use cache::PageCache;
use typst::layout::PagedDocument;

// IPC payloads

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
    // Base64-encoded PNG
    data: String,
}

#[derive(Serialize, Clone)]
struct PageRemovedPayload {
    index: usize,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompileReason {
    Typing,
    Save,
    Watcher,
    Explicit,
    MainFile,
    Zoom,
}

impl Default for CompileReason {
    fn default() -> Self {
        Self::Explicit
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "snake_case")]
enum CompileStatus {
    Started,
    Idle,
}

#[derive(Serialize, Clone, Copy, Debug)]
struct CompileStatePayload {
    status: CompileStatus,
    revision: u64,
    reason: CompileReason,
}

// Export config types

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct PdfExportConfig {
    pub path: String,
    pub title: Option<String>,
    pub author: Option<String>,
    // PDF standard identifier: "1.7", "a-2b", etc. None means default (1.7).
    pub pdf_standard: Option<String>,
}

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct PngExportConfig {
    pub dir: String,
    // Pixels per point. 1.0 -> 72 dpi, 2.0 -> 144 dpi (retina).
    pub scale: Option<f32>,
    pub prefix: Option<String>,
    // Page range string like "1-3, 5, 7-9". None means all pages.
    pub page_range: Option<String>,
}

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
pub struct SvgExportConfig {
    pub dir: String,
    pub prefix: Option<String>,
    // Page range string like "1-3, 5, 7-9". None means all pages.
    pub page_range: Option<String>,
}

// Export helpers

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

#[derive(Default)]
struct CompileQueueState {
    is_compiling: bool,
    pending_reason: Option<CompileReason>,
    next_revision: u64,
}

pub struct PreviewPipeline {
    world: Arc<EditorWorld>,
    last_fingerprints: Mutex<Vec<PageFingerprint>>,
    page_cache: Mutex<PageCache>,
    // The most recently successfully compiled document.
    // Held so IDE features (hover, go-to-def, jump-from-click) can use it.
    pub last_document: Mutex<Option<Arc<PagedDocument>>>,
    app_handle: AppHandle,
    // Preview zoom: pixels per typst point. Default 2.0 (retina).
    pub zoom: Mutex<f32>,
    // The page index currently visible in the frontend preview pane.
    // Used to prioritise rendering so the user sees instant updates.
    visible_page: Mutex<usize>,
    compile_queue: Mutex<CompileQueueState>,
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
            compile_queue: Mutex::new(CompileQueueState::default()),
        }
    }

    pub fn invalidate_cache(&self) {
        self.page_cache.lock().clear();
        *self.last_fingerprints.lock() = Vec::new();
    }

    pub fn set_zoom(&self, zoom: f32) {
        *self.zoom.lock() = zoom;
        self.invalidate_cache();
    }

    pub fn set_visible_page(&self, page: usize) {
        *self.visible_page.lock() = page;
    }

    pub fn request_compile(self: &Arc<Self>, reason: CompileReason) {
        let start_request = {
            let mut queue = self.compile_queue.lock();
            if queue.is_compiling {
                queue.pending_reason = Some(reason);
                None
            } else {
                queue.is_compiling = true;
                queue.next_revision += 1;
                Some((queue.next_revision, reason))
            }
        };

        let Some((revision, reason)) = start_request else {
            return;
        };

        let pipeline = Arc::clone(self);
        thread::spawn(move || {
            pipeline.run_compile_loop(revision, reason);
        });
    }

    fn run_compile_loop(self: Arc<Self>, mut revision: u64, mut reason: CompileReason) {
        loop {
            self.emit_compile_state(CompileStatus::Started, revision, reason);
            self.compile_and_emit(revision, reason);

            let next = {
                let mut queue = self.compile_queue.lock();
                if let Some(next_reason) = queue.pending_reason.take() {
                    queue.next_revision += 1;
                    Some((queue.next_revision, next_reason))
                } else {
                    queue.is_compiling = false;
                    None
                }
            };

            match next {
                Some((next_revision, next_reason)) => {
                    revision = next_revision;
                    reason = next_reason;
                }
                None => {
                    self.emit_compile_state(CompileStatus::Idle, revision, reason);
                    break;
                }
            }
        }
    }

    fn emit_compile_state(&self, status: CompileStatus, revision: u64, reason: CompileReason) {
        if let Err(err) = self.app_handle.emit(
            "preview:compile-state",
            CompileStatePayload {
                status,
                revision,
                reason,
            },
        ) {
            error!("emit preview:compile-state failed err=\"{err}\"");
        }
    }

    fn clear_preview(&self, old_page_count: usize) {
        let _ = self
            .app_handle
            .emit("preview:total-pages", TotalPagesPayload { count: 0 });
        for i in (0..old_page_count).rev() {
            let _ = self
                .app_handle
                .emit("preview:page-removed", PageRemovedPayload { index: i });
        }
        *self.last_fingerprints.lock() = Vec::new();
        *self.last_document.lock() = None;
    }

    fn compile_and_emit(&self, revision: u64, reason: CompileReason) {
        let t = Instant::now();
        info!("request_compile: starting revision={revision} reason={reason:?}");

        let CompileOutput {
            document,
            mut errors,
            mut warnings,
        } = compile_document(&*self.world);

        let compile_ms = t.elapsed().as_secs_f64() * 1000.0;

        if !errors.is_empty() {
            warn!(
                "compile revision={revision} reason={reason:?} finished with {} error(s), {} warning(s) ({compile_ms:.1}ms)",
                errors.len(),
                warnings.len(),
            );
        } else {
            info!(
                "compile revision={revision} reason={reason:?} ok with {} warning(s) ({compile_ms:.1}ms)",
                warnings.len(),
            );
        }

        // Collect diagnostics from other .typ files not reachable from the main file
        let (extra_errors, extra_warnings) = collect_workspace_diagnostics(&*self.world);
        dedup_merge(&mut errors, &mut warnings, extra_errors, extra_warnings);

        if let Err(err) = self.app_handle.emit(
            "compile:diagnostics",
            DiagnosticsPayload { errors, warnings },
        ) {
            error!("failed to emit compile:diagnostics err=\"{err}\"");
        }

        let doc = match document {
            Some(doc) => doc,
            None => {
                let old_count = self.last_fingerprints.lock().len();
                self.clear_preview(old_count);
                info!(
                    "compile revision={revision} reason={reason:?} produced no document ({:.1}ms)",
                    t.elapsed().as_secs_f64() * 1000.0
                );
                return;
            }
        };

        let new_fps = fingerprint_pages(&doc);
        let old_fps = self.last_fingerprints.lock().clone();
        let (changed_indices, removed_count) = diff_pages(&old_fps, &new_fps);

        let _ = self.app_handle.emit(
            "preview:total-pages",
            TotalPagesPayload {
                count: new_fps.len(),
            },
        );

        for i in (new_fps.len()..new_fps.len() + removed_count).rev() {
            let _ = self
                .app_handle
                .emit("preview:page-removed", PageRemovedPayload { index: i });
        }

        let zoom = *self.zoom.lock();
        let visible_page = *self.visible_page.lock();

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

        cache_hits.sort_by_key(|(idx, _)| if *idx == visible_page { 0 } else { 1 });
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
        let (priority_misses, rest_misses): (Vec<usize>, Vec<usize>) = cache_misses
            .into_iter()
            .partition(|&idx| idx == visible_page);

        for idx in &priority_misses {
            let fp = new_fps[*idx];
            let page = &doc.pages[*idx];
            match render_page(page, zoom) {
                Ok(png) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                    self.page_cache.lock().insert(fp, b64.clone());
                    let _ = self.app_handle.emit(
                        "preview:page-updated",
                        PageUpdatedPayload {
                            index: *idx,
                            data: b64,
                        },
                    );
                }
                Err(err) => error!("render error page={idx} err=\"{err}\""),
            }
        }

        if !priority_misses.is_empty() {
            *self.last_fingerprints.lock() = new_fps.clone();
        }

        if !rest_misses.is_empty() {
            let rendered: Vec<(usize, PageFingerprint, Vec<u8>)> = rest_misses
                .par_iter()
                .filter_map(|&idx| {
                    let fp = new_fps[idx];
                    let page = &doc.pages[idx];
                    match render_page(page, zoom) {
                        Ok(png) => Some((idx, fp, png)),
                        Err(err) => {
                            error!("render error page={idx} err=\"{err}\"");
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

        *self.last_fingerprints.lock() = new_fps;
        *self.last_document.lock() = Some(Arc::new(doc));

        info!(
            "compile revision={revision} reason={reason:?} done ({:.1}ms render, {:.1}ms total)",
            render_t.elapsed().as_secs_f64() * 1000.0,
            t.elapsed().as_secs_f64() * 1000.0
        );
    }

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
            let msg = e
                .iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("; ");
            error!(
                "export_pdf: pdf generation failed err=\"{msg}\" ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            msg
        })?;

        std::fs::write(&config.path, &bytes).map_err(|e| {
            error!(
                "export_pdf: write failed path={:?} err=\"{e}\" ({:.1}ms)",
                config.path,
                t.elapsed().as_secs_f64() * 1000.0
            );
            e.to_string()
        })?;

        info!(
            "export_pdf: ok - {} bytes ({:.1}ms)",
            bytes.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    pub fn export_png(&self, config: PngExportConfig) -> Result<(), String> {
        let t = Instant::now();
        info!(
            "export_png: dir={:?} scale={:?} prefix={:?}",
            config.dir, config.scale, config.prefix
        );

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

        info!(
            "export_png: ok - {} page(s) ({:.1}ms)",
            indices.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
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

        info!(
            "export_svg: ok - {} page(s) ({:.1}ms)",
            indices.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }
}
