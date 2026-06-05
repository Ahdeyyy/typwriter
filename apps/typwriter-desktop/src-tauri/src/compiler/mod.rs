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
mod disk_cache;
mod render;

pub use cache::{key_to_path, parse_key, zoom_to_bucket, PageCacheKey};
pub use compile::{
    collect_workspace_diagnostics, compile_document, dedup_merge, CompileOutput,
    SerializedDiagnostic,
};
pub use diff::fingerprint_pages;
pub use render::render_page;

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread,
    time::Instant,
};

use log::{error, info, warn};
use parking_lot::{Mutex, RwLock};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::vcs::{CommitTrigger, SnapshotPolicy, VcsState};
use crate::workspace::WorkspaceState;
use crate::world::EditorWorld;
use cache::PageCache;
use disk_cache::DiskCache;
use std::path::{Path, PathBuf};
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
    // URL path component (`{fp_hex}-{zoom_bucket}`). The webview fetches the
    // PNG bytes from `previewimg://localhost/{path}.png`, which keeps the IPC
    // event tiny and lets the browser cache by URL. The field name is
    // historical — preserved so the frontend payload type doesn't change.
    fingerprint: String,
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
    // When true, stamp the PDF with the current local date as the creation
    // timestamp (used only if the document's `set document(date: ..)` is auto).
    pub include_date: Option<bool>,
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
                return Err(format!("Page {p} exceeds document length ({total_pages})"));
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
    typst_pdf::PdfStandards::new(&[standard]).map_err(|e| format!("Invalid PDF standard: {e}"))
}

#[derive(Default)]
struct CompileQueueState {
    next_revision: u64,
}

/// Drain every pending request from `rx` and return the most recent reason,
/// falling back to `initial` if the channel was already empty.
fn drain_latest_reason(rx: &Receiver<CompileReason>, initial: CompileReason) -> CompileReason {
    let mut latest = initial;
    while let Ok(reason) = rx.try_recv() {
        latest = reason;
    }
    latest
}

pub struct PreviewPipeline {
    world: Arc<EditorWorld>,
    /// What the frontend has been told about, paired with the bytes that were
    /// in the cache at emit time. `Some((fp, zoom))` means "we emitted this
    /// `(fp, zoom)` key for the slot and the cache had bytes for it at that
    /// moment"; `None` means the slot exists but has never been emitted.
    ///
    /// Updated atomically — a single write at the end of (or each exit point
    /// from) `compile_and_emit`. The mid-flight write the old code did caused
    /// aborted compiles to leave the frontend pointing at fingerprints that
    /// had never been rendered.
    last_emitted: Mutex<Vec<Option<PageCacheKey>>>,
    page_cache: Mutex<PageCache>,
    /// Persistent on-disk mirror of `page_cache`, scoped to the open workspace.
    /// `None` until a workspace is attached via [`Self::attach_disk_cache`].
    /// Lookups fall through to disk on in-memory LRU misses, and renders write
    /// to both layers so subsequent app sessions skip re-rendering.
    disk_cache: Mutex<Option<DiskCache>>,
    /// Workspace root of the attached disk cache. Held so the preview manifest
    /// (which lives alongside the cached PNGs) can be read/written without
    /// threading the path through every call.
    workspace_root: Mutex<Option<PathBuf>>,
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
    compile_tx: Sender<CompileReason>,
    compile_rx: Mutex<Option<Receiver<CompileReason>>>,
    request_counter: AtomicU64,
    /// Version-control state. Used to auto-commit a restore point whenever
    /// a compile succeeds (the user's "good known state").
    vcs: Arc<VcsState>,
}

impl PreviewPipeline {
    pub fn new(world: Arc<EditorWorld>, app_handle: AppHandle, vcs: Arc<VcsState>) -> Self {
        let (compile_tx, compile_rx) = mpsc::channel();
        Self {
            world,
            last_emitted: Mutex::new(Vec::new()),
            page_cache: Mutex::new(PageCache::default()),
            disk_cache: Mutex::new(None),
            workspace_root: Mutex::new(None),
            last_document: Mutex::new(None),
            app_handle,
            zoom: Mutex::new(2.0),
            visible_page: Mutex::new(0),
            compile_queue: Mutex::new(CompileQueueState::default()),
            compile_tx,
            compile_rx: Mutex::new(Some(compile_rx)),
            request_counter: AtomicU64::new(0),
            vcs,
        }
    }

    pub fn start_worker(self: &Arc<Self>) {
        let Some(rx) = self.compile_rx.lock().take() else {
            return;
        };
        let pipeline = Arc::clone(self);
        thread::spawn(move || {
            pipeline.run_compile_worker(rx);
        });
    }

    pub fn invalidate_cache(&self) {
        // In-memory state only. The on-disk cache is intentionally preserved
        // across workspace open / main-file change / clear-main — it is the
        // persistent layer and its keys (content-hash + zoom) are immune to
        // accidental collision with stale state.
        self.page_cache.lock().clear();
        *self.last_emitted.lock() = Vec::new();
        *self.last_document.lock() = None;
    }

    /// Bind the persistent on-disk cache to a workspace root. Subsequent
    /// renders write PNGs into `<root>/.typwriter/cache/previews/`, and
    /// page-byte lookups fall through to disk on LRU misses. Existing files
    /// in that directory are picked up — that's what makes re-opening a
    /// workspace serve the preview without recompiling.
    pub fn attach_disk_cache(&self, workspace_root: &Path) {
        let cache = disk_cache::open_default(workspace_root);
        *self.disk_cache.lock() = Some(cache);
        *self.workspace_root.lock() = Some(workspace_root.to_path_buf());
    }

    /// Paint the previously-rendered preview from disk *before* the next compile
    /// runs. Reads the manifest written by the last successful compile; if it's
    /// for `main_rel` and its pages still have bytes on disk, emits them and
    /// seeds `last_emitted` so the subsequent (font-blocked) compile reconciles
    /// via the normal diff instead of re-emitting unchanged pages.
    ///
    /// This is what lets a re-opened workspace show its preview immediately
    /// while fonts load and the document recompiles in the background.
    pub fn restore_preview(&self, main_rel: &str) {
        let Some(root) = self.workspace_root.lock().clone() else {
            return;
        };
        let Some((manifest_main, pages)) = disk_cache::read_manifest(&root) else {
            return;
        };
        if manifest_main != main_rel || pages.is_empty() {
            return;
        }

        let count = pages.len();
        let mut emitted: Vec<Option<PageCacheKey>> = vec![None; count];
        let mut painted = 0usize;
        {
            let mut disk = self.disk_cache.lock();
            let Some(disk) = disk.as_mut() else {
                return;
            };
            let _ = self
                .app_handle
                .emit("preview:total-pages", TotalPagesPayload { count });
            for (idx, slot) in pages.iter().enumerate() {
                let Some(key) = slot else { continue };
                if !disk.contains(*key) {
                    continue;
                }
                let _ = self.app_handle.emit(
                    "preview:page-updated",
                    PageUpdatedPayload {
                        index: idx,
                        fingerprint: key_to_path(*key),
                    },
                );
                emitted[idx] = Some(*key);
                painted += 1;
            }
        }

        if painted == 0 {
            return;
        }
        *self.last_emitted.lock() = emitted;
        info!("restore_preview: painted {painted}/{count} cached page(s) for main={main_rel:?}");
    }

    /// Re-emit total-pages and every previously-emitted page key. Used when a
    /// new webview (e.g. the popped-out preview window) needs to populate its
    /// UI from the existing compiled state without forcing a recompile.
    pub fn emit_current_state(&self) {
        let emitted: Vec<Option<PageCacheKey>> = self.last_emitted.lock().clone();
        let count = emitted.len();

        let _ = self
            .app_handle
            .emit("preview:total-pages", TotalPagesPayload { count });
        for (idx, slot) in emitted.into_iter().enumerate() {
            if let Some(key) = slot {
                let _ = self.app_handle.emit(
                    "preview:page-updated",
                    PageUpdatedPayload {
                        index: idx,
                        fingerprint: key_to_path(key),
                    },
                );
            }
        }
    }

    /// Look up the PNG bytes for a cache key. Used by the `previewimg`
    /// URI scheme handler to serve images to the webview without going
    /// through the JS bridge.
    ///
    /// Lookup order: in-memory LRU → on-disk cache. A disk hit re-hydrates the
    /// LRU so a hot key stops hitting the filesystem after the first request.
    pub fn page_bytes(&self, key: PageCacheKey) -> Option<Vec<u8>> {
        if let Some(bytes) = self.page_cache.lock().get(key).cloned() {
            return Some(bytes);
        }
        let bytes = {
            let mut disk = self.disk_cache.lock();
            disk.as_mut()?.get(key)?
        };
        self.page_cache.lock().insert(key, bytes.clone());
        Some(bytes)
    }

    pub fn set_zoom(&self, zoom: f32) {
        *self.zoom.lock() = zoom;
        // No cache invalidation: zoom is part of the cache key, so renderings
        // at the previous scale remain valid (a zoom-out then zoom-in is a
        // pure cache hit). A subsequent `request_compile(Zoom)` will re-emit
        // every page with the new key, picking up cached bytes where they
        // exist and rendering only where they don't.
    }

    pub fn set_visible_page(&self, page: usize) {
        *self.visible_page.lock() = page;
    }

    pub fn request_compile(self: &Arc<Self>, reason: CompileReason) {
        self.request_counter.fetch_add(1, Ordering::Relaxed);
        if let Err(err) = self.compile_tx.send(reason) {
            error!("request_compile: worker queue send failed err=\"{err}\"");
        }
    }

    fn run_compile_worker(self: Arc<Self>, rx: Receiver<CompileReason>) {
        // Carry the next reason between iterations so we can distinguish
        // "already-queued work" (skip the Idle event) from "channel empty"
        // (announce Idle, then block for the next request).
        let mut pending: Option<CompileReason> = None;
        loop {
            let initial = match pending.take() {
                Some(r) => r,
                None => match rx.recv() {
                    Ok(r) => r,
                    Err(_) => return, // channel closed
                },
            };

            // Coalesce: drain any extra requests that piled up while we were
            // busy, keeping only the most recent reason.
            let reason = drain_latest_reason(&rx, initial);

            let request_mark = self.request_counter.load(Ordering::Acquire);
            let revision = {
                let mut queue = self.compile_queue.lock();
                queue.next_revision += 1;
                queue.next_revision
            };
            self.emit_compile_state(CompileStatus::Started, revision, reason);
            self.compile_and_emit(revision, reason, request_mark);

            match rx.try_recv() {
                Ok(next) => pending = Some(next),
                Err(mpsc::TryRecvError::Empty) => {
                    self.emit_compile_state(CompileStatus::Idle, revision, reason);
                }
                Err(mpsc::TryRecvError::Disconnected) => return,
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
        *self.last_emitted.lock() = Vec::new();
        *self.last_document.lock() = None;
    }

    fn compile_and_emit(&self, revision: u64, reason: CompileReason, request_mark: u64) {
        let t = Instant::now();
        info!("request_compile: starting revision={revision} reason={reason:?}");

        // With no main file set, typst would synthesise "cannot find main file"
        // errors on every cycle. Clear preview + diagnostics and bail.
        if !self.world.has_main() {
            info!("compile revision={revision} reason={reason:?} skipped — no main file");
            let old_count = self.last_emitted.lock().len();
            self.clear_preview(old_count);
            if let Err(err) = self.app_handle.emit(
                "compile:diagnostics",
                DiagnosticsPayload {
                    errors: Vec::new(),
                    warnings: Vec::new(),
                },
            ) {
                error!("failed to emit compile:diagnostics err=\"{err}\"");
            }
            return;
        }

        // Fonts load lazily (first workspace open). Make sure the search has
        // been kicked off and block until a font set is installed — compiling
        // against the empty fallback book would render fonts-less pages and
        // cache them to disk. The wait is usually already satisfied because the
        // search was started at workspace-open time and overlapped the rest of
        // the open path.
        self.world.ensure_fonts_loading();
        self.world.wait_until_fonts_loaded();

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
                let old_count = self.last_emitted.lock().len();
                self.clear_preview(old_count);
                info!(
                    "compile revision={revision} reason={reason:?} produced no document ({:.1}ms)",
                    t.elapsed().as_secs_f64() * 1000.0
                );
                return;
            }
        };

        if self.is_stale_request(request_mark) {
            info!("compile revision={revision} reason={reason:?} skipped stale render");
            *self.last_document.lock() = Some(Arc::new(doc));
            return;
        }

        let new_fps = fingerprint_pages(&doc);
        let zoom = *self.zoom.lock();
        let zoom_bucket = zoom_to_bucket(zoom);
        let visible_page = *self.visible_page.lock();

        // Snapshot the previous emit state (per slot). `new_emitted` is the
        // *working copy* we mutate as we successfully emit; it gets committed
        // to `self.last_emitted` exactly once, at the end of this function or
        // at any stale-request exit. This is what fixes the blank-pages bug:
        // an aborted compile no longer leaves the canonical state ahead of
        // what the frontend has actually been told.
        let prev_emitted: Vec<Option<PageCacheKey>> = self.last_emitted.lock().clone();
        let mut new_emitted: Vec<Option<PageCacheKey>> = Vec::with_capacity(new_fps.len());
        for i in 0..new_fps.len() {
            new_emitted.push(prev_emitted.get(i).copied().unwrap_or(None));
        }
        let removed_count = prev_emitted.len().saturating_sub(new_fps.len());

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

        // A slot needs (re-)emission if either:
        //   (a) the target key `(fp, zoom)` differs from what we last told
        //       the frontend, OR
        //   (b) the LRU has since evicted bytes for the previously-emitted
        //       key (the frontend would 404 on fetch) and the disk cache
        //       also doesn't have the bytes.
        //
        // The eviction case turns the otherwise quiet "nothing changed"
        // path into a real recovery: a zoom + idle period that evicted
        // cached pages will re-render them on the next compile cycle.
        //
        // "Bytes available" combines in-memory LRU and on-disk cache; a disk
        // hit counts as a cache hit (no re-render needed) because the URI
        // handler will lazily hydrate the LRU on the next fetch. This is
        // what makes re-opening a workspace serve the preview without
        // recompiling every page.
        let mut cache_hits: Vec<usize> = Vec::new();
        let mut cache_misses: Vec<usize> = Vec::new();
        {
            let cache = self.page_cache.lock();
            let mut disk = self.disk_cache.lock();
            for i in 0..new_fps.len() {
                let target: PageCacheKey = (new_fps[i], zoom_bucket);
                let in_lru = cache.peek(target).is_some();
                let on_disk = !in_lru && disk.as_mut().map(|d| d.contains(target)).unwrap_or(false);
                let has_bytes = in_lru || on_disk;
                let already_emitted = prev_emitted.get(i).copied().flatten() == Some(target);
                if already_emitted && has_bytes {
                    // Frontend already has this key and the bytes are still
                    // reachable (LRU or disk). Nothing to do; new_emitted[i]
                    // is already correct (copied from prev_emitted above).
                    continue;
                }
                if has_bytes {
                    cache_hits.push(i);
                } else {
                    cache_misses.push(i);
                }
            }
        }

        // Render the visible page first, then everything else.
        cache_hits.sort_by_key(|idx| if *idx == visible_page { 0 } else { 1 });

        for idx in cache_hits {
            if self.is_stale_request(request_mark) {
                info!("compile revision={revision} reason={reason:?} stopped stale cache emit");
                *self.last_emitted.lock() = new_emitted;
                return;
            }
            let key: PageCacheKey = (new_fps[idx], zoom_bucket);
            let _ = self.app_handle.emit(
                "preview:page-updated",
                PageUpdatedPayload {
                    index: idx,
                    fingerprint: key_to_path(key),
                },
            );
            new_emitted[idx] = Some(key);
        }

        let render_t = Instant::now();
        let (priority_misses, rest_misses): (Vec<usize>, Vec<usize>) = cache_misses
            .into_iter()
            .partition(|&idx| idx == visible_page);

        for idx in &priority_misses {
            if self.is_stale_request(request_mark) {
                info!(
                    "compile revision={revision} reason={reason:?} stopped stale priority render"
                );
                *self.last_emitted.lock() = new_emitted;
                return;
            }
            let key: PageCacheKey = (new_fps[*idx], zoom_bucket);
            let page = &doc.pages[*idx];
            match render_page(page, zoom) {
                Ok(png) => {
                    if let Some(disk) = self.disk_cache.lock().as_mut() {
                        disk.insert(key, &png);
                    }
                    self.page_cache.lock().insert(key, png);
                    let _ = self.app_handle.emit(
                        "preview:page-updated",
                        PageUpdatedPayload {
                            index: *idx,
                            fingerprint: key_to_path(key),
                        },
                    );
                    new_emitted[*idx] = Some(key);
                }
                Err(err) => error!("render error page={idx} err=\"{err}\""),
            }
        }

        if !rest_misses.is_empty() {
            if self.is_stale_request(request_mark) {
                info!(
                    "compile revision={revision} reason={reason:?} skipped stale background render"
                );
                *self.last_emitted.lock() = new_emitted;
                return;
            }
            let rendered: Vec<(usize, PageCacheKey, Vec<u8>)> = rest_misses
                .par_iter()
                .filter_map(|&idx| {
                    let key: PageCacheKey = (new_fps[idx], zoom_bucket);
                    let page = &doc.pages[idx];
                    match render_page(page, zoom) {
                        Ok(png) => Some((idx, key, png)),
                        Err(err) => {
                            error!("render error page={idx} err=\"{err}\"");
                            None
                        }
                    }
                })
                .collect();

            let mut cache = self.page_cache.lock();
            for (idx, key, png) in rendered {
                if self.is_stale_request(request_mark) {
                    info!("compile revision={revision} reason={reason:?} stopped stale page emit");
                    drop(cache);
                    *self.last_emitted.lock() = new_emitted;
                    return;
                }
                // Disk write first (with bytes still owned by us) so the LRU
                // insert can consume `png`. Order is functionally irrelevant
                // — both layers see the same key on success.
                if let Some(disk) = self.disk_cache.lock().as_mut() {
                    disk.insert(key, &png);
                }
                cache.insert(key, png);
                let _ = self.app_handle.emit(
                    "preview:page-updated",
                    PageUpdatedPayload {
                        index: idx,
                        fingerprint: key_to_path(key),
                    },
                );
                new_emitted[idx] = Some(key);
            }
        }

        // Persist the page manifest (best effort) so the next open can paint
        // this preview from disk before the font-blocked recompile finishes.
        if new_emitted.iter().any(Option::is_some) {
            if let (Some(root), Some(main_rel)) =
                (self.workspace_root.lock().clone(), self.world.main_rel())
            {
                disk_cache::write_manifest(&root, &main_rel, &new_emitted);
            }
        }

        *self.last_emitted.lock() = new_emitted;
        *self.last_document.lock() = Some(Arc::new(doc));

        // Generate thumbnail when the workspace is opened and the main file is compiled.
        if reason == CompileReason::MainFile {
            if let Some(ws) = self.app_handle.try_state::<Arc<WorkspaceState>>() {
                ws.generate_thumbnail();
            }
        }

        // Auto-commit a "compile succeeded" restore point. We deliberately
        // skip Zoom (purely a render change) and MainFile (just opened the
        // workspace, the initial-commit hook already covered it). The
        // dedupe inside `commit_if_changed` makes this a no-op when the
        // working tree hasn't changed since the last commit (e.g. when save
        // already committed a moment ago).
        let should_snapshot = matches!(
            reason,
            CompileReason::Typing
                | CompileReason::Save
                | CompileReason::Watcher
                | CompileReason::Explicit
        );
        if should_snapshot {
            let policy = self
                .app_handle
                .try_state::<Arc<RwLock<SnapshotPolicy>>>()
                .map(|s| s.read().clone())
                .unwrap_or_default();
            if let Err(err) = self.vcs.auto_commit_if_changed(
                CommitTrigger::Compile,
                "Auto-snapshot after compile",
                &policy,
            ) {
                warn!("compile auto-commit failed err=\"{err}\"");
            }
        }

        info!(
            "compile revision={revision} reason={reason:?} done ({:.1}ms render, {:.1}ms total)",
            render_t.elapsed().as_secs_f64() * 1000.0,
            t.elapsed().as_secs_f64() * 1000.0
        );
    }

    fn is_stale_request(&self, request_mark: u64) -> bool {
        self.request_counter.load(Ordering::Acquire) != request_mark
    }

    pub fn export_pdf(&self, config: PdfExportConfig) -> Result<(), String> {
        let t = Instant::now();
        info!("export_pdf: path={:?}", config.path);

        let path = config.path.clone();
        let bytes = self.export_pdf_bytes(config)?;

        std::fs::write(&path, &bytes).map_err(|e| {
            error!(
                "export_pdf: write failed path={:?} err=\"{e}\" ({:.1}ms)",
                path,
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

    /// Generate the PDF bytes for the last compiled document. The destination
    /// path inside `config` is ignored — callers handle the write themselves
    /// (e.g. android-fs on Android, std::fs::write on desktop).
    pub fn export_pdf_bytes(&self, config: PdfExportConfig) -> Result<Vec<u8>, String> {
        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or_else(|| {
                let e = "No compiled document available";
                error!("export_pdf_bytes: err=\"{e}\"");
                e.to_string()
            })?
            .clone();

        let standards = match &config.pdf_standard {
            Some(s) if !s.trim().is_empty() => parse_pdf_standard(s)?,
            _ => typst_pdf::PdfStandards::default(),
        };

        let timestamp = if config.include_date.unwrap_or(false) {
            use chrono::{Datelike, Timelike};
            let now = chrono::Local::now();
            typst::foundations::Datetime::from_ymd_hms(
                now.year(),
                now.month() as u8,
                now.day() as u8,
                now.hour() as u8,
                now.minute() as u8,
                now.second() as u8,
            )
            .map(typst_pdf::Timestamp::new_utc)
        } else {
            None
        };

        let options = typst_pdf::PdfOptions {
            ident: typst::foundations::Smart::Auto,
            timestamp,
            standards,
            page_ranges: None,
            tagged: true,
        };

        typst_pdf::pdf(&doc, &options).map_err(|e| {
            let msg = e
                .iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("; ");
            error!("export_pdf_bytes: pdf generation failed err=\"{msg}\"");
            msg
        })
    }

    pub fn export_png(&self, config: PngExportConfig) -> Result<(), String> {
        let t = Instant::now();
        info!(
            "export_png: dir={:?} scale={:?} prefix={:?}",
            config.dir, config.scale, config.prefix
        );

        let dir_path = std::path::Path::new(&config.dir).to_path_buf();
        std::fs::create_dir_all(&dir_path).map_err(|e| {
            error!(
                "export_png: create_dir_all failed dir={:?} err=\"{e}\"",
                config.dir
            );
            e.to_string()
        })?;

        let pages = self.export_png_pages(config)?;
        let count = pages.len();
        for (filename, bytes) in pages {
            std::fs::write(dir_path.join(&filename), &bytes).map_err(|e| {
                error!("export_png: write failed file={filename:?} err=\"{e}\"");
                e.to_string()
            })?;
        }

        info!(
            "export_png: ok - {count} page(s) ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Render the selected pages of the last compiled document as PNG bytes.
    /// Returns `(filename, bytes)` pairs. Destination handling (filesystem vs.
    /// android-fs) is the caller's responsibility.
    pub fn export_png_pages(
        &self,
        config: PngExportConfig,
    ) -> Result<Vec<(String, Vec<u8>)>, String> {
        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or_else(|| {
                let e = "No compiled document available";
                error!("export_png_pages: err=\"{e}\"");
                e.to_string()
            })?
            .clone();

        let scale = config.scale.unwrap_or(2.0);
        let prefix = config.prefix.as_deref().unwrap_or("page").to_string();

        let indices: Vec<usize> = match &config.page_range {
            Some(s) if !s.trim().is_empty() => parse_page_indices(s, doc.pages.len())?,
            _ => (0..doc.pages.len()).collect(),
        };

        let mut out = Vec::with_capacity(indices.len());
        for &i in &indices {
            let page = &doc.pages[i];
            let png = render_page(page, scale).map_err(|e| {
                error!("export_png_pages: render failed page={i} err=\"{e}\"");
                e
            })?;
            let filename = format!("{}-{}.png", prefix, i + 1);
            out.push((filename, png));
        }
        Ok(out)
    }

    pub fn export_svg(&self, config: SvgExportConfig) -> Result<(), String> {
        let t = Instant::now();
        info!(
            "export_svg: dir={:?} prefix={:?}",
            config.dir, config.prefix
        );

        let dir_path = std::path::Path::new(&config.dir).to_path_buf();
        std::fs::create_dir_all(&dir_path).map_err(|e| {
            error!(
                "export_svg: create_dir_all failed dir={:?} err=\"{e}\"",
                config.dir
            );
            e.to_string()
        })?;

        let pages = self.export_svg_pages(config)?;
        let count = pages.len();
        for (filename, bytes) in pages {
            std::fs::write(dir_path.join(&filename), &bytes).map_err(|e| {
                error!("export_svg: write failed file={filename:?} err=\"{e}\"");
                e.to_string()
            })?;
        }

        info!(
            "export_svg: ok - {count} page(s) ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(())
    }

    /// Render the selected pages of the last compiled document as SVG bytes.
    /// Returns `(filename, bytes)` pairs. Destination handling (filesystem vs.
    /// android-fs) is the caller's responsibility.
    pub fn export_svg_pages(
        &self,
        config: SvgExportConfig,
    ) -> Result<Vec<(String, Vec<u8>)>, String> {
        let doc = self
            .last_document
            .lock()
            .as_ref()
            .ok_or_else(|| {
                let e = "No compiled document available";
                error!("export_svg_pages: err=\"{e}\"");
                e.to_string()
            })?
            .clone();

        let prefix = config.prefix.as_deref().unwrap_or("page").to_string();

        let indices: Vec<usize> = match &config.page_range {
            Some(s) if !s.trim().is_empty() => parse_page_indices(s, doc.pages.len())?,
            _ => (0..doc.pages.len()).collect(),
        };

        let mut out = Vec::with_capacity(indices.len());
        for &i in &indices {
            let page = &doc.pages[i];
            let svg = typst_svg::svg(page);
            let filename = format!("{}-{}.svg", prefix, i + 1);
            out.push((filename, svg.into_bytes()));
        }
        Ok(out)
    }
}
