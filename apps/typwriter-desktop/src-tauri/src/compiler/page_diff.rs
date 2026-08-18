// "Which pages changed since this restore point?"
//
// The live preview already knows which pages changed between two *consecutive
// compiles* — that's what `diff::fingerprint_pages` is for, and it is the
// reason scrolling a 300-page document doesn't re-render the whole thing on
// every keystroke. Answering the same question against a restore point is a
// different job: the old fingerprints don't exist anywhere, because that
// version of the document was never compiled by this process. So we compile
// it, here, against a [`SnapshotWorld`] rooted at the snapshot's blobs, and
// align the two fingerprint vectors.
//
// That makes this a genuine Typst compile of a document the user is not
// looking at, which drives the whole shape of this module:
//
//   * **Off the main thread.** One worker thread owns every page diff; the
//     Tauri command only enqueues. A big deck can take seconds to lay out and
//     none of that may touch the UI thread.
//
//   * **Cancellable.** `current` holds the id of the request whose result we
//     still want. Superseding or cancelling a request stores a different value
//     and every phase boundary checks it — nothing is rendered or emitted for
//     a request the user has moved past. `typst::compile` itself can't be
//     interrupted, so a cancellation lands at the next boundary rather than
//     immediately; the wasted work is bounded by one compile.
//
//   * **Its own page cache.** Diff thumbnails render at their own scale into a
//     separate LRU, so a 200-page comparison can't evict the pages the live
//     preview is currently showing. They are served through the existing
//     `previewimg://` scheme, which falls through to this cache on a pipeline
//     miss — the keys are `(content hash, zoom bucket)` on both sides, so a
//     collision is by definition the same bytes.
//
//   * **The laid-out documents are kept.** Contact-sheet thumbnails are 72 dpi
//     — fine for spotting *which* page moved, useless for reading it. Holding
//     both `PagedDocument`s after a comparison lets `render_page_at` rasterize
//     any single page at any scale on demand, in tens of milliseconds, rather
//     than recompiling the snapshot every time someone opens a page full size.
//     They are dropped by `release`, which the frontend calls when it stops
//     looking at a comparison.

use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread,
    time::Instant,
};

use log::{error, info, warn};
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use typst_layout::PagedDocument;

use super::cache::{key_to_path, parse_key, zoom_to_bucket, PageCache, PageCacheKey};
use super::diff::{align_pages, fingerprint_pages, PageAlignment, PageChangeKind};
use super::render::render_page;
use super::snapshot_world::SnapshotWorld;
use super::PreviewPipeline;
use crate::vcs::VcsState;
use crate::world::EditorWorld;

/// Pixels per typst point for diff thumbnails. 1.0 is 72 dpi — enough to see
/// *what* moved on a page at a glance, cheap enough to rasterize a whole
/// document's worth. The user opens the real preview to read it.
const PAGE_DIFF_SCALE: f32 = 1.0;

/// How many pages the LRU keeps. Two sides of a comparison share it.
const PAGE_DIFF_CACHE_CAPACITY: usize = 400;

/// Hard cap on pages rasterized per comparison. Changed / added / removed
/// pages are rendered first; unchanged ones fill whatever is left, because a
/// filmstrip that shows the untouched pages too is what makes the changed
/// ones legible. Past the cap, rows come back without image keys and the
/// result is flagged `truncated`.
const MAX_DIFF_RENDERS: usize = 240;

/// Pages per parallel render batch, matching the preview pipeline. Bounds
/// peak memory and gives cancellation a frequent checkpoint.
const RENDER_BATCH: usize = 16;

/// Range a caller-requested full-size scale is clamped into. The floor keeps a
/// "full size" render from being no sharper than the thumbnail it replaced;
/// the ceiling is the memory guard — an A4 page at 4 px/pt decodes to roughly
/// 8 MB inside the webview, and the preview pane has hit Chromium's OOM before
/// by holding too many large bitmaps at once.
const MIN_FULL_SCALE: f32 = 1.5;
const MAX_FULL_SCALE: f32 = 4.0;

// ─── IPC payloads ────────────────────────────────────────────────────────────

/// One page of the comparison. `before_key` / `after_key` are `previewimg://`
/// path components (see [`key_to_path`]); `None` means "not rendered" — either
/// the page doesn't exist on that side, or the render budget ran out.
#[derive(Serialize, Clone, Debug)]
pub struct PageDiffEntry {
    pub kind: PageChangeKind,
    /// 0-based page index in the older document.
    pub before_index: Option<usize>,
    /// 0-based page index in the newer document.
    pub after_index: Option<usize>,
    pub before_key: Option<String>,
    pub after_key: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PageDiffPayload {
    pub request_id: u64,
    pub from_id: String,
    /// `None` when the comparison is against the working tree's current
    /// render rather than a second restore point.
    pub to_id: Option<String>,
    pub before_pages: usize,
    pub after_pages: usize,
    pub changed: usize,
    pub added: usize,
    pub removed: usize,
    pub unchanged: usize,
    pub entries: Vec<PageDiffEntry>,
    /// The render budget was exhausted: some rows carry no image keys.
    pub truncated: bool,
    pub elapsed_ms: f64,
}

#[derive(Serialize, Clone, Debug)]
struct PageDiffStartedPayload {
    request_id: u64,
}

#[derive(Serialize, Clone, Debug)]
struct PageDiffErrorPayload {
    request_id: u64,
    message: String,
}

/// Which of the two compared documents a full-size render comes from.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PageDiffSide {
    Before,
    After,
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/// The two laid-out documents from the most recent comparison, held so single
/// pages can be re-rendered at a higher scale without recompiling.
struct RetainedDocs {
    before: Arc<PagedDocument>,
    after: Arc<PagedDocument>,
}

#[derive(Clone, Debug)]
struct PageDiffJob {
    request_id: u64,
    from_id: String,
    to_id: Option<String>,
}

pub struct PageDiffEngine {
    world: Arc<EditorWorld>,
    vcs: Arc<VcsState>,
    /// Source of the "current" document when comparing against the working
    /// tree: whatever the live preview last compiled successfully.
    pipeline: Arc<PreviewPipeline>,
    app_handle: AppHandle,
    /// Rendered diff thumbnails, deliberately separate from the preview's
    /// cache so a comparison can't evict what the user is reading.
    cache: Mutex<PageCache>,
    /// Documents from the last completed comparison. `None` until one
    /// finishes, and again after [`Self::release`].
    retained: Mutex<Option<RetainedDocs>>,
    next_id: AtomicU64,
    /// Id of the request whose result is still wanted. `0` means "none" —
    /// which is also what [`Self::cancel`] stores.
    current: AtomicU64,
    tx: Sender<PageDiffJob>,
    rx: Mutex<Option<Receiver<PageDiffJob>>>,
}

impl PageDiffEngine {
    pub fn new(
        world: Arc<EditorWorld>,
        vcs: Arc<VcsState>,
        pipeline: Arc<PreviewPipeline>,
        app_handle: AppHandle,
    ) -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            world,
            vcs,
            pipeline,
            app_handle,
            cache: Mutex::new(PageCache::new(PAGE_DIFF_CACHE_CAPACITY)),
            retained: Mutex::new(None),
            next_id: AtomicU64::new(0),
            current: AtomicU64::new(0),
            tx,
            rx: Mutex::new(Some(rx)),
        }
    }

    /// Spawn the worker. Idempotent — the receiver is taken exactly once.
    pub fn start_worker(self: &Arc<Self>) {
        let Some(rx) = self.rx.lock().take() else {
            return;
        };
        let engine = Arc::clone(self);
        thread::spawn(move || engine.run_worker(rx));
    }

    /// Queue a comparison and return its request id. The result arrives on
    /// `vcs:page-diff`; failures on `vcs:page-diff-error`. Both carry the id
    /// back so a frontend that has moved on can ignore them.
    pub fn request(&self, from_id: String, to_id: Option<String>) -> u64 {
        let request_id = self.next_id.fetch_add(1, Ordering::AcqRel) + 1;
        self.current.store(request_id, Ordering::Release);
        let job = PageDiffJob {
            request_id,
            from_id,
            to_id,
        };
        if let Err(err) = self.tx.send(job) {
            error!("page_diff: worker queue send failed err=\"{err}\"");
        }
        request_id
    }

    /// Abandon whatever is in flight. The worker stops at its next phase
    /// boundary and emits nothing.
    pub fn cancel(&self) {
        self.current.store(0, Ordering::Release);
    }

    /// Cancel anything in flight *and* drop the retained documents. Called
    /// when the frontend stops looking at a comparison — the diff window
    /// closing, or a different restore point being selected.
    ///
    /// Deliberately separate from [`Self::cancel`], which a *superseding*
    /// request uses: that path must not throw away documents the user may
    /// still be opening pages from.
    pub fn release(&self) {
        self.cancel();
        *self.retained.lock() = None;
    }

    /// Rasterize one page of the last comparison at `scale` and return its
    /// `previewimg://` path component. Cheap — the document is already laid
    /// out, so this is one rasterization rather than a compile — and
    /// idempotent: asking again for the same page and scale is a cache hit.
    ///
    /// Runs on the caller's thread (a Tauri async-command worker) rather than
    /// the diff worker, so opening a page full size never queues behind a
    /// comparison that happens to be running.
    pub fn render_page_at(
        &self,
        side: PageDiffSide,
        page_index: usize,
        scale: f32,
    ) -> Result<String, String> {
        let scale = if scale.is_finite() {
            scale.clamp(MIN_FULL_SCALE, MAX_FULL_SCALE)
        } else {
            MIN_FULL_SCALE
        };

        // Clone the Arc out rather than holding the lock across the render:
        // rasterizing at 4x takes long enough that blocking a concurrent
        // comparison on it would be rude.
        let doc = {
            let retained = self.retained.lock();
            let retained = retained
                .as_ref()
                .ok_or("That comparison is no longer loaded — recompute it")?;
            match side {
                PageDiffSide::Before => Arc::clone(&retained.before),
                PageDiffSide::After => Arc::clone(&retained.after),
            }
        };

        let page = doc
            .pages()
            .get(page_index)
            .ok_or_else(|| format!("Page {} is not in that document", page_index + 1))?;

        // Same key scheme as everything else on this URI: fingerprint the
        // frame, pair it with the zoom bucket. That is what makes the
        // full-size render cacheable and immutable at its URL.
        let key: PageCacheKey = (typst::utils::hash128(&page.frame), zoom_to_bucket(scale));
        if self.cache.lock().peek(key).is_some() {
            return Ok(key_to_path(key));
        }

        let t = Instant::now();
        let png = render_page(page, scale)?;
        info!(
            "page_diff: full render side={side:?} page={page_index} scale={scale} ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        self.cache.lock().insert(key, png);
        Ok(key_to_path(key))
    }

    /// PNG bytes for a diff thumbnail, for the `previewimg://` handler.
    pub fn page_bytes(&self, key: PageCacheKey) -> Option<Vec<u8>> {
        self.cache.lock().get(key).cloned()
    }

    /// Drop every rendered thumbnail. Called when the workspace changes —
    /// the snapshots these were computed from belong to the old one.
    pub fn invalidate(&self) {
        self.release();
        self.cache.lock().clear();
    }

    fn is_stale(&self, request_id: u64) -> bool {
        self.current.load(Ordering::Acquire) != request_id
    }

    fn run_worker(self: Arc<Self>, rx: Receiver<PageDiffJob>) {
        loop {
            let Ok(mut job) = rx.recv() else {
                return; // channel closed — app shutting down
            };
            // Coalesce: only the most recent request can still be current,
            // so running the earlier ones would render pages nobody wants.
            while let Ok(next) = rx.try_recv() {
                job = next;
            }
            if self.is_stale(job.request_id) {
                continue;
            }
            // A panic here would silently kill page diffs for the rest of the
            // session. Contain it to the one job, same as the compile worker.
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.run_job(&job);
            }));
            if outcome.is_err() {
                error!(
                    "page_diff: request={} panicked; worker continuing",
                    job.request_id
                );
                self.emit_error(job.request_id, "Page diff failed unexpectedly");
            }
        }
    }

    fn run_job(&self, job: &PageDiffJob) {
        let t = Instant::now();
        info!(
            "page_diff: start request={} from={} to={:?}",
            job.request_id,
            &job.from_id[..job.from_id.len().min(8)],
            job.to_id.as_ref().map(|id| &id[..id.len().min(8)])
        );
        let _ = self.app_handle.emit(
            "vcs:page-diff-started",
            PageDiffStartedPayload {
                request_id: job.request_id,
            },
        );

        match self.compute(job, t) {
            Ok(Some(payload)) => {
                info!(
                    "page_diff: request={} ok — {} changed, {} added, {} removed, {} unchanged ({:.1}ms)",
                    job.request_id,
                    payload.changed,
                    payload.added,
                    payload.removed,
                    payload.unchanged,
                    payload.elapsed_ms
                );
                if let Err(err) = self.app_handle.emit("vcs:page-diff", payload) {
                    error!("page_diff: emit vcs:page-diff failed err=\"{err}\"");
                }
            }
            // Superseded or cancelled — the caller no longer wants this.
            Ok(None) => info!(
                "page_diff: request={} abandoned ({:.1}ms)",
                job.request_id,
                t.elapsed().as_secs_f64() * 1000.0
            ),
            Err(err) => {
                warn!("page_diff: request={} err=\"{err}\"", job.request_id);
                self.emit_error(job.request_id, &err);
            }
        }
    }

    fn emit_error(&self, request_id: u64, message: &str) {
        let _ = self.app_handle.emit(
            "vcs:page-diff-error",
            PageDiffErrorPayload {
                request_id,
                message: message.to_string(),
            },
        );
    }

    /// The actual work. `Ok(None)` means the request went stale partway —
    /// distinct from `Err`, which is a real failure worth telling the user
    /// about.
    fn compute(&self, job: &PageDiffJob, t: Instant) -> Result<Option<PageDiffPayload>, String> {
        let main_rel = self
            .world
            .main_rel()
            .ok_or("No main file is set — nothing to compare")?;

        // Compiling against the empty fallback book would fingerprint
        // fonts-less pages and report every page as changed.
        self.world.ensure_fonts_loading();
        self.world.wait_until_fonts_loaded();
        if self.is_stale(job.request_id) {
            return Ok(None);
        }

        let before_doc = Arc::new(self.compile_snapshot(&job.from_id, &main_rel)?);
        if self.is_stale(job.request_id) {
            return Ok(None);
        }

        let after_doc = match &job.to_id {
            Some(id) => Arc::new(self.compile_snapshot(id, &main_rel)?),
            // Against the working tree: reuse the document the preview is
            // already showing rather than compiling it a second time.
            None => self.pipeline.last_document.lock().clone().ok_or(
                "The current document hasn't compiled successfully yet — fix the errors first",
            )?,
        };
        if self.is_stale(job.request_id) {
            return Ok(None);
        }

        let before_fps = fingerprint_pages(&before_doc);
        let after_fps = fingerprint_pages(&after_doc);
        let rows = align_pages(&before_fps, &after_fps);

        // Hold both layouts so `render_page_at` can serve a full-size page
        // without recompiling. Installed before the contact sheet renders:
        // that pass is the slow part, and someone who clicks the first
        // thumbnail the moment it appears should not race its tail.
        *self.retained.lock() = Some(RetainedDocs {
            before: Arc::clone(&before_doc),
            after: Arc::clone(&after_doc),
        });

        let bucket = zoom_to_bucket(PAGE_DIFF_SCALE);
        let (entries, truncated) = self.render_entries(
            job.request_id,
            &rows,
            (&before_doc, &before_fps),
            (&after_doc, &after_fps),
            bucket,
        );
        let Some(entries) = entries else {
            return Ok(None);
        };

        let count = |kind: PageChangeKind| rows.iter().filter(|r| r.kind == kind).count();
        Ok(Some(PageDiffPayload {
            request_id: job.request_id,
            from_id: job.from_id.clone(),
            to_id: job.to_id.clone(),
            before_pages: before_fps.len(),
            after_pages: after_fps.len(),
            changed: count(PageChangeKind::Changed),
            added: count(PageChangeKind::Added),
            removed: count(PageChangeKind::Removed),
            unchanged: count(PageChangeKind::Unchanged),
            entries,
            truncated,
            elapsed_ms: t.elapsed().as_secs_f64() * 1000.0,
        }))
    }

    /// Compile one snapshot as it existed at `commit_id`, entered at the
    /// current main file.
    fn compile_snapshot(&self, commit_id: &str, main_rel: &str) -> Result<PagedDocument, String> {
        let files = self.vcs.snapshot_files(commit_id)?;
        let world = SnapshotWorld::new(&self.world, &self.vcs, files, main_rel)?;
        let result = typst::compile::<PagedDocument>(&world);
        result.output.map_err(|diags| {
            let detail = diags
                .iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("; ");
            format!("That restore point doesn't compile: {detail}")
        })
    }

    /// Rasterize the thumbnails each row needs and pair them with their
    /// `previewimg://` keys. Returns `None` when the request went stale
    /// mid-render, plus whether the budget was exhausted.
    fn render_entries(
        &self,
        request_id: u64,
        rows: &[PageAlignment],
        before: (&PagedDocument, &[u128]),
        after: (&PagedDocument, &[u128]),
        bucket: u32,
    ) -> (Option<Vec<PageDiffEntry>>, bool) {
        let (before_doc, before_fps) = before;
        let (after_doc, after_fps) = after;

        let mut entries: Vec<PageDiffEntry> = rows
            .iter()
            .map(|row| PageDiffEntry {
                kind: row.kind,
                before_index: row.before,
                after_index: row.after,
                before_key: None,
                after_key: None,
            })
            .collect();

        // (row, side, page index, key). Changed / added / removed first, so a
        // budget that runs out costs unchanged context pages rather than the
        // pages the user came here to see.
        let mut wanted: Vec<(usize, bool, usize, PageCacheKey)> = Vec::new();
        for pass_changed in [true, false] {
            for (row_idx, row) in rows.iter().enumerate() {
                if (row.kind != PageChangeKind::Unchanged) != pass_changed {
                    continue;
                }
                if let Some(i) = row.before {
                    wanted.push((row_idx, true, i, (before_fps[i], bucket)));
                }
                if let Some(i) = row.after {
                    wanted.push((row_idx, false, i, (after_fps[i], bucket)));
                }
            }
        }

        // One cache slot can back several entries: an unchanged page has the
        // same fingerprint on both sides, and two visually identical pages
        // (a run of blanks, a repeated separator) share one too. `scheduled`
        // is what stops those from being rasterized — and charged to the
        // budget — once per reference instead of once per image.
        let mut to_render: Vec<(usize, bool, usize, PageCacheKey)> = Vec::new();
        let mut scheduled: HashSet<PageCacheKey> = HashSet::new();
        let mut truncated = false;
        {
            let cache = self.cache.lock();
            let mut budget = MAX_DIFF_RENDERS;
            for item in wanted {
                let (row_idx, is_before, _, key) = item;
                if cache.peek(key).is_some() || scheduled.contains(&key) {
                    set_key(&mut entries[row_idx], is_before, key);
                    continue;
                }
                if budget == 0 {
                    truncated = true;
                    continue;
                }
                budget -= 1;
                set_key(&mut entries[row_idx], is_before, key);
                scheduled.insert(key);
                to_render.push(item);
            }
        }

        for batch in to_render.chunks(RENDER_BATCH) {
            if self.is_stale(request_id) {
                return (None, truncated);
            }
            let rendered: Vec<(PageCacheKey, Vec<u8>)> = batch
                .par_iter()
                .filter_map(|&(_, is_before, page_idx, key)| {
                    let doc = if is_before { before_doc } else { after_doc };
                    match render_page(&doc.pages()[page_idx], PAGE_DIFF_SCALE) {
                        Ok(png) => Some((key, png)),
                        Err(err) => {
                            error!("page_diff: render page={page_idx} err=\"{err}\"");
                            None
                        }
                    }
                })
                .collect();

            let mut cache = self.cache.lock();
            for (key, png) in rendered {
                cache.insert(key, png);
            }
        }

        // A page that failed to rasterize would otherwise leave its row
        // pointing at a URL the scheme handler will 404. Drop those keys so
        // the frontend shows its "not rendered" placeholder instead of a
        // broken image.
        {
            let cache = self.cache.lock();
            for entry in &mut entries {
                if let Some(path) = &entry.before_key {
                    if !has_bytes(&cache, path) {
                        entry.before_key = None;
                        truncated = true;
                    }
                }
                if let Some(path) = &entry.after_key {
                    if !has_bytes(&cache, path) {
                        entry.after_key = None;
                        truncated = true;
                    }
                }
            }
        }

        (Some(entries), truncated)
    }
}

/// Whether the cache actually holds bytes for a key we already stringified.
fn has_bytes(cache: &PageCache, path: &str) -> bool {
    parse_key(path).is_some_and(|key| cache.peek(key).is_some())
}

/// Stamp a rendered key onto the correct side of a row.
fn set_key(entry: &mut PageDiffEntry, is_before: bool, key: PageCacheKey) {
    let path = key_to_path(key);
    if is_before {
        entry.before_key = Some(path);
    } else {
        entry.after_key = Some(path);
    }
}
