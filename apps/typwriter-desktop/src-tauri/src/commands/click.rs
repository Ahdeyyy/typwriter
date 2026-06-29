// commands/click.rs
//
// Bidirectional jump commands between the editor and the preview pane.
//
// Preview → Editor:
//   jump_from_click  — convert a pixel click on a preview page to a source
//                      location so the editor can move the cursor there.
//
// Editor → Preview:
//   jump_from_cursor — convert the editor cursor offset to a list of
//                      (page, point) positions in the preview.

use std::{path::Path, sync::Arc, time::Instant};

use log::{debug, error, info};
use tauri::State;
use typst::{
    introspection::PagedPosition,
    layout::{Abs, Frame, FrameItem, Point},
    syntax::Span,
    World,
};
use typst_ide::IdeWorld;
use typst_layout::PagedDocument;

use crate::{
    commands::editor::{serialize_jump, utf16_to_byte, JumpResponse},
    compiler::PreviewPipeline,
    world::EditorWorld,
};

// ─── Preview → Editor ─────────────────────────────────────────────────────────

/// Convert a pixel click on a specific page of the preview to a source
/// location.
///
/// `page`  — 0-based page index
/// `x`, `y` — pixel coordinates within that page
#[tauri::command]
pub fn jump_from_click(
    page: usize,
    x: f64,
    y: f64,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<Option<JumpResponse>, String> {
    let t = Instant::now();
    debug!("jump_from_click: page={page} x={x:.1} y={y:.1}");

    let zoom = *pipeline.zoom.lock() as f64;
    let point = Point::new(Abs::pt(x / zoom), Abs::pt(y / zoom));

    let doc_arc = pipeline.last_document.lock().clone().ok_or_else(|| {
        let e = "No compiled document available";
        error!(
            "jump_from_click: err=\"{e}\" ({:.1}ms) page={page}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;
    let doc: &PagedDocument = &doc_arc;

    if page >= doc.pages().len() {
        let e = format!(
            "page index {page} out of bounds (doc has {} pages)",
            doc.pages().len()
        );
        error!(
            "jump_from_click: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Err(e);
    }

    let frame = &doc.pages()[page].frame;
    let jump = typst_ide::jump_from_click_in_frame(&**world, doc, frame, point);
    let found = jump.is_some();
    debug!(
        "jump_from_click: ok found={found} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(jump.map(|j| serialize_jump(&j, &**world)))
}

// ─── Editor → Preview ─────────────────────────────────────────────────────────

/// Convert the editor cursor (byte offset inside a source file) to a preview
/// position. The engine (`typst_ide::jump_from_cursor`) reports one position per
/// page a span touches and can't say which page the caret's own character is on,
/// so we resolve the page ourselves by matching the rendered glyph nearest the
/// caret across the whole document (see [`find_caret_position`]).
///
/// `path`   — absolute or workspace-relative path to the source file
/// `cursor` — byte offset of the cursor within the source text
#[tauri::command]
pub fn jump_from_cursor(
    path: String,
    cursor: usize,
    world: State<'_, Arc<EditorWorld>>,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<Option<PreviewPositionResponse>, String> {
    let t = Instant::now();
    debug!("jump_from_cursor: path={path:?} cursor={cursor}");

    let abs = Path::new(&path);
    let id = world.path_to_id(abs).ok_or_else(|| {
        let e = "Could not resolve file path to a FileId";
        error!(
            "jump_from_cursor: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let source = world.source(id).map_err(|e| {
        error!(
            "jump_from_cursor: source error path={path:?} err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;

    let text = source.text();
    let byte_cursor = utf16_to_byte(text, cursor);

    let doc_arc = pipeline.last_document.lock().clone().ok_or_else(|| {
        let e = "No compiled document available";
        error!(
            "jump_from_cursor: err=\"{e}\" ({:.1}ms) path={path:?}",
            t.elapsed().as_secs_f64() * 1000.0
        );
        e.to_string()
    })?;
    let doc: &PagedDocument = &doc_arc;

    let positions = typst_ide::jump_from_cursor(doc, &source, byte_cursor);
    let count = positions.len();
    let resolved = resolve_preview_position(&**world, doc, &source, byte_cursor, positions);
    info!(
        "jump_from_cursor: ok — {count} position(s), resolved={} ({:.1}ms)",
        resolved.is_some(),
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(resolved.map(|position| {
        let frame = &doc.pages()[position.page.get() - 1].frame;
        let page_width = frame.width().to_pt();
        let page_height = frame.height().to_pt();
        let highlights = compute_highlights(doc, &source, &position);
        preview_position_response(position, page_width, page_height, highlights)
    }))
}

// ─── Response type ────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct PreviewPositionResponse {
    /// 0-based page index.
    pub page: usize,
    /// Horizontal offset in typst points from the left edge of the page.
    pub x: f64,
    /// Vertical offset in typst points from the top edge of the page.
    pub y: f64,
    /// Width of the resolved page in typst points. Lets the frontend place the
    /// highlight rectangles as a fraction of the displayed page image, so they
    /// stay aligned regardless of zoom or how the image is scaled to fit.
    pub page_width: f64,
    /// Height of the resolved page in typst points.
    pub page_height: f64,
    /// Rectangles (in typst points, origin at the page's top-left) covering the
    /// text run the caret sits in on the resolved page — one per rendered line,
    /// so a run that wraps highlights each line tightly. Empty when there's
    /// nothing sensible to highlight.
    pub highlights: Vec<HighlightRect>,
}

/// An axis-aligned rectangle on a preview page, in typst points with the origin
/// at the page's top-left corner.
#[derive(serde::Serialize)]
pub struct HighlightRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Pick the preview page+point for the caret from the candidates
/// `typst_ide::jump_from_cursor` produced. It reports one position per page on
/// which the caret's *exact* source offset is rendered:
///
/// * **Zero** — the caret isn't on rendered content (inside code, a diagram
///   body, a blank gap). Return `None` so the preview stays put rather than
///   yanking somewhere while the user edits code.
/// * **One** — the offset renders in a single place. Use [`find_caret_position`]
///   to pin the precise glyph the caret sits on; that's correct whenever the
///   offset isn't rendered more than once.
/// * **More than one** — the same offset renders on several pages: a heading
///   echoed in an `#outline`, a reference, or a running header. The glyph scan
///   can't tell the body copy from the echo (it tie-breaks to the earliest
///   page — i.e. the outline), so disambiguate by round-tripping each candidate
///   back through the click resolver. An outline / reference entry is a *link*
///   and resolves to a [`typst_ide::Jump::Position`]; only the genuine body text
///   resolves to a [`typst_ide::Jump::File`] in this source — that's the page
///   the caret is really on. We deliberately ignore the File jump's byte offset:
///   it's the clicked glyph's anchor, never the caret's exact offset, so the old
///   `== cursor` equality could essentially never hold. If nothing round-trips
///   (every copy is a link), fall back to the glyph scan.
fn resolve_preview_position(
    world: &dyn IdeWorld,
    doc: &PagedDocument,
    source: &typst::syntax::Source,
    cursor: usize,
    positions: Vec<PagedPosition>,
) -> Option<PagedPosition> {
    match positions.len() {
        0 => None,
        1 => find_caret_position(doc, source, cursor),
        _ => positions
            .iter()
            .find(|position| round_trips_to_body(world, doc, source, position))
            .copied()
            .or_else(|| find_caret_position(doc, source, cursor)),
    }
}

/// Whether clicking `position` lands back on body text in `source` (a
/// [`typst_ide::Jump::File`]) rather than on a link such as an `#outline` entry
/// (which resolves to a [`typst_ide::Jump::Position`]).
///
/// `jump_from_cursor` hands us a glyph's **baseline** point, but
/// `jump_from_click`'s hit-test box for a glyph is `[baseline - text.size,
/// baseline]` — so the raw baseline sits exactly on the box's bottom edge. Large
/// fonts (a level-1 heading) happen to register the hit; smaller ones (level-2+
/// sub-headings) fall off the edge and resolve to nothing, which sent the caret
/// to the outline copy on the wrong page. Nudging a fraction of a point up and
/// to the right moves the click into the glyph interior, so any font taller than
/// the nudge registers — verified across heading levels 1–3. We ignore the File
/// jump's byte offset (it's the clicked glyph's anchor, not the caret's offset).
fn round_trips_to_body(
    world: &dyn IdeWorld,
    doc: &PagedDocument,
    source: &typst::syntax::Source,
    position: &PagedPosition,
) -> bool {
    let probe = PagedPosition {
        page: position.page,
        point: Point::new(
            position.point.x + Abs::pt(0.5),
            position.point.y - Abs::pt(0.5),
        ),
    };
    matches!(
        typst_ide::jump_from_click(world, doc, &probe),
        Some(typst_ide::Jump::File(id, _)) if id == source.id()
    )
}

/// Resolve the caret to the exact page+point of the rendered glyph nearest it.
///
/// `typst_ide::jump_from_cursor` reports one position per page a span touches
/// and can't disambiguate which page the caret is actually on. Instead of
/// trusting that per-page list, we scan every glyph rendered from the caret's
/// file across the entire document, recover each glyph's *absolute* source byte
/// offset (its span's node start + `glyph.span.1`), and pick the glyph the
/// caret sits on — the one at/just-before the caret, or, failing that, the
/// nearest one after it. Because the offset is absolute, a paragraph that wraps
/// across a page break resolves to the correct page on either side, and a caret
/// in a non-text gap naturally falls back to the preceding rendered character
/// (the behaviour the old probe heuristics approximated).
///
/// Returns `None` only when the caret's file rendered no glyphs at all.
fn find_caret_position(
    doc: &PagedDocument,
    source: &typst::syntax::Source,
    cursor: usize,
) -> Option<PagedPosition> {
    let file = source.id();

    // The absolute byte offset of a glyph is `start-of-its-span + glyph.span.1`.
    // Resolving a span to its byte range walks the syntax tree, so memoize it:
    // every glyph in a text run shares one span, making this a handful of lookups
    // rather than one per glyph.
    let mut span_starts: std::collections::HashMap<Span, usize> = std::collections::HashMap::new();

    // Track the single best glyph, keyed by `caret_rank`. The rank's last
    // element is the page index, so the winner carries its own page.
    let mut best: Option<((u8, usize, usize), Point)> = None;

    for (index, page) in doc.pages().iter().enumerate() {
        for_each_glyph(&page.frame, &mut |span, span_offset, point, _width, _size| {
            // Only glyphs rendered from *this* file can carry the caret; spans
            // from imports/packages map into a different source text.
            if span.id() != Some(file) {
                return;
            }
            let start = match span_starts.get(&span) {
                Some(&start) => start,
                None => {
                    // `Source::find` returns the node for the span (and already
                    // filters to this file); its range start anchors the glyph.
                    let Some(node) = source.find(span) else {
                        return;
                    };
                    let start = node.range().start;
                    span_starts.insert(span, start);
                    start
                }
            };
            let offset = start + span_offset as usize;
            let rank = caret_rank(offset, index, cursor);
            if best
                .as_ref()
                .map_or(true, |(best_rank, _)| rank < *best_rank)
            {
                best = Some((rank, point));
            }
        });
    }

    let (rank, point) = best?;
    let page =
        std::num::NonZeroUsize::new(rank.2 + 1).expect("page indices are 1-based and non-zero");
    Some(PagedPosition { page, point })
}

/// Ordering key that selects the glyph the caret sits on. Compared
/// lexicographically as `(side, distance, page)`:
///
/// * `side` — `0` for a glyph at/just-before the caret, `1` for one after it. A
///   text cursor belongs to the character on its left, so any before-or-at glyph
///   beats every after glyph regardless of distance.
/// * `distance` — bytes between the glyph and the caret; nearest wins within a
///   side.
/// * `page` — breaks exact-offset ties (the same offset rendered on several
///   pages, e.g. reused diagram content) in reading order.
fn caret_rank(offset: usize, page: usize, cursor: usize) -> (u8, usize, usize) {
    if offset <= cursor {
        (0, cursor - offset, page)
    } else {
        (1, offset - cursor, page)
    }
}

/// Build the highlight rectangles for the resolved caret position: the text run
/// the caret sits in, one rectangle per rendered line on the resolved page.
///
/// `find_caret_position`/`resolve_preview_position` hand us a page plus the
/// origin (left edge of the baseline) of the glyph the caret lands on. We find
/// the glyph nearest that origin on the page, take its **span** — i.e. the whole
/// rendered text run, such as a heading or a contiguous stretch of body text —
/// and union every glyph sharing that span into per-line boxes. Highlighting the
/// run (rather than a single glyph) is what tells the user *what* the cursor maps
/// to; splitting by line keeps a wrapped run from drawing one tall box across the
/// whole column. Glyphs are restricted to the caret's own file so a span reused
/// elsewhere (an `#outline` echo) on the same page can't bleed in.
fn compute_highlights(
    doc: &PagedDocument,
    source: &typst::syntax::Source,
    position: &PagedPosition,
) -> Vec<HighlightRect> {
    let Some(page) = doc.pages().get(position.page.get() - 1) else {
        return Vec::new();
    };
    let file = source.id();
    let target = position.point;

    // A single glyph's box, in page-space typst points. `top`/`bottom` bracket
    // the glyph vertically (typst's own hit-test uses `[baseline - size,
    // baseline]`); `baseline` groups glyphs into lines.
    struct GlyphBox {
        span: Span,
        left: Abs,
        right: Abs,
        top: Abs,
        bottom: Abs,
        baseline: Abs,
    }

    let mut boxes: Vec<GlyphBox> = Vec::new();
    // Span of the glyph closest to the resolved point — the run to highlight.
    let mut nearest: Option<(f64, Span)> = None;
    for_each_glyph(&page.frame, &mut |span, _offset, point, width, size| {
        if span.id() != Some(file) {
            return;
        }
        let dx = (point.x - target.x).to_pt();
        let dy = (point.y - target.y).to_pt();
        let dist = dx * dx + dy * dy;
        if nearest.as_ref().map_or(true, |(best, _)| dist < *best) {
            nearest = Some((dist, span));
        }
        boxes.push(GlyphBox {
            span,
            left: point.x,
            right: point.x + width,
            top: point.y - size,
            bottom: point.y,
            baseline: point.y,
        });
    });

    let Some((_, target_span)) = nearest else {
        return Vec::new();
    };

    // Union the run's glyphs into one rectangle per line. Glyphs on the same line
    // share a baseline; allow a small slop so sub/superscripts or mixed sizes in
    // the run still merge into their line rather than spawning a sliver box.
    const LINE_SLOP: f64 = 1.0;
    let mut lines: Vec<GlyphBox> = Vec::new();
    for glyph in boxes.iter().filter(|b| b.span == target_span) {
        let line = lines.iter_mut().find(|l| {
            (l.baseline - glyph.baseline).to_pt().abs() < LINE_SLOP
        });
        match line {
            Some(line) => {
                if glyph.left < line.left {
                    line.left = glyph.left;
                }
                if glyph.right > line.right {
                    line.right = glyph.right;
                }
                if glyph.top < line.top {
                    line.top = glyph.top;
                }
                if glyph.bottom > line.bottom {
                    line.bottom = glyph.bottom;
                }
            }
            None => lines.push(GlyphBox {
                span: target_span,
                left: glyph.left,
                right: glyph.right,
                top: glyph.top,
                bottom: glyph.bottom,
                baseline: glyph.baseline,
            }),
        }
    }

    lines
        .into_iter()
        .map(|l| HighlightRect {
            x: l.left.to_pt(),
            y: l.top.to_pt(),
            width: (l.right - l.left).to_pt(),
            height: (l.bottom - l.top).to_pt(),
        })
        .collect()
}

/// Walk a frame, invoking `f(span, span_offset, origin, x_advance, size)` for
/// *every* glyph it renders. Mirrors typst-ide's `find_in_frame`, but reports all
/// glyphs (with their source span, per-glyph byte offset, advance width, and font
/// size) rather than only the first matching one per page — which is what lets
/// callers match the glyph nearest the caret across the whole document and bound
/// the text run for highlighting. `origin` is the glyph's left edge on the
/// baseline.
fn for_each_glyph(frame: &Frame, f: &mut dyn FnMut(Span, u16, Point, Abs, Abs)) {
    for &(pos, ref item) in frame.items() {
        match item {
            FrameItem::Group(group) => {
                for_each_glyph(&group.frame, &mut |span, offset, point, width, size| {
                    f(span, offset, pos + point.transform(group.transform), width, size)
                });
            }
            FrameItem::Text(text) => {
                let mut x = pos.x;
                for glyph in &text.glyphs {
                    let advance = glyph.x_advance.at(text.size);
                    f(glyph.span.0, glyph.span.1, Point::new(x, pos.y), advance, text.size);
                    x += advance;
                }
            }
            _ => {}
        }
    }
}

fn preview_position_response(
    position: PagedPosition,
    page_width: f64,
    page_height: f64,
    highlights: Vec<HighlightRect>,
) -> PreviewPositionResponse {
    PreviewPositionResponse {
        page: position.page.get() - 1,
        x: position.point.x.to_pt(),
        y: position.point.y.to_pt(),
        page_width,
        page_height,
        highlights,
    }
}

#[cfg(test)]
mod tests {
    use super::{caret_rank, preview_position_response, resolve_preview_position};
    use crate::world::local_file_id;
    use ecow::EcoString;
    use std::num::NonZeroUsize;
    use std::path::{Path, PathBuf};
    use typst::diag::{FileError, FileResult};
    use typst::foundations::{Bytes, Datetime, Duration};
    use typst::introspection::PagedPosition;
    use typst::layout::{Abs, Point};
    use typst::syntax::package::PackageSpec;
    use typst::syntax::{FileId, Source};
    use typst::text::{Font, FontBook};
    use typst::utils::LazyHash;
    use typst::{Library, LibraryExt, World};
    use typst_ide::IdeWorld;
    use typst_kit::fonts::{self, FontStore};
    use typst_layout::PagedDocument;

    /// Build a 1-based `PagedPosition` at `(x, y)` typst points on `page`.
    fn pos(page: usize, x: f64, y: f64) -> PagedPosition {
        PagedPosition {
            page: NonZeroUsize::new(page).expect("page indices are 1-based and non-zero"),
            point: Point::new(Abs::pt(x), Abs::pt(y)),
        }
    }

    // ─── In-memory world for end-to-end resolution tests ────────────────────────
    //
    // `resolve_preview_position`'s interesting branch round-trips real preview
    // positions through `typst_ide::jump_from_click`, so it can only be exercised
    // against a genuinely compiled `PagedDocument`. `EditorWorld` needs a Tauri
    // handle plus background font/condvar machinery a unit test can't stand up, so
    // we provide a single-file `World` + `IdeWorld` backed by the embedded fonts
    // and the standard library — everything layout and the jump APIs require.

    struct TestWorld {
        library: LazyHash<Library>,
        fonts: FontStore,
        main: FileId,
        source: Source,
    }

    impl TestWorld {
        fn new(text: &str) -> Self {
            let main = local_file_id(Path::new("main.typ"))
                .expect("main.typ is a valid project-relative path");
            let mut fonts = FontStore::new();
            fonts.extend(fonts::embedded());
            Self {
                library: LazyHash::new(Library::builder().build()),
                fonts,
                main,
                source: Source::new(main, text.to_string()),
            }
        }

        /// Compile to a paged document, asserting the fixture itself is valid so a
        /// broken fixture fails loudly rather than as a confusing `None`.
        fn compile(&self) -> PagedDocument {
            typst::compile::<PagedDocument>(self)
                .output
                .expect("test fixture compiles without errors")
        }
    }

    impl World for TestWorld {
        fn library(&self) -> &LazyHash<Library> {
            &self.library
        }
        fn book(&self) -> &LazyHash<FontBook> {
            self.fonts.book()
        }
        fn main(&self) -> FileId {
            self.main
        }
        fn source(&self, id: FileId) -> FileResult<Source> {
            if id == self.main {
                Ok(self.source.clone())
            } else {
                Err(FileError::NotFound(PathBuf::from("<test: unknown file>")))
            }
        }
        fn file(&self, _id: FileId) -> FileResult<Bytes> {
            Err(FileError::NotFound(PathBuf::from("<test: no assets>")))
        }
        fn font(&self, index: usize) -> Option<Font> {
            self.fonts.font(index)
        }
        fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
            None
        }
    }

    impl IdeWorld for TestWorld {
        fn upcast(&self) -> &dyn World {
            self
        }
        fn packages(&self) -> &[(PackageSpec, Option<EcoString>)] {
            &[]
        }
        fn files(&self) -> Vec<FileId> {
            vec![self.main]
        }
    }

    /// Compile `text`, place the caret at byte offset `cursor`, and resolve the
    /// preview position exactly as the `jump_from_cursor` command does.
    fn resolve_at(text: &str, cursor: usize) -> Option<PagedPosition> {
        let world = TestWorld::new(text);
        let doc = world.compile();
        let source = world.source(world.main).expect("main source is available");
        let positions = typst_ide::jump_from_cursor(&doc, &source, cursor);
        resolve_preview_position(&world, &doc, &source, cursor, positions)
    }

    /// One outline page followed by three single-heading pages, one heading per
    /// level. Each heading's text therefore renders twice — once in the `#outline`
    /// on page 1, once on its own body page — which is the duplicate-render case
    /// the round-trip exists to disambiguate.
    const OUTLINE_FIXTURE: &str = "\
#outline()
#pagebreak()
= Alpha
#pagebreak()
== Beta
#pagebreak()
=== Gamma
";

    /// Byte offset one character into the body occurrence of `heading` (inside the
    /// `Text` node, where `jump_from_cursor` will find a span).
    fn caret_in_heading(text: &str, heading: &str) -> usize {
        text.find(heading)
            .unwrap_or_else(|| panic!("fixture should contain heading {heading:?}"))
            + 1
    }

    // ─── preview_position_response ──────────────────────────────────────────

    #[test]
    fn response_converts_one_based_page_to_zero_based() {
        let r = preview_position_response(pos(1, 10.0, 20.0), 595.0, 842.0, Vec::new());
        assert_eq!(r.page, 0, "page 1 in the doc is index 0 in the preview");
        assert!((r.x - 10.0).abs() < 1e-9);
        assert!((r.y - 20.0).abs() < 1e-9);
        assert!((r.page_width - 595.0).abs() < 1e-9);
        assert!((r.page_height - 842.0).abs() < 1e-9);

        // A later page must not be off-by-one — this is the classic "preview
        // lands one page away" failure.
        assert_eq!(
            preview_position_response(pos(5, 0.0, 0.0), 0.0, 0.0, Vec::new()).page,
            4
        );
    }

    // ─── caret_rank ─────────────────────────────────────────────────────────
    //
    // The ordering that picks which rendered glyph the caret sits on once every
    // glyph in the document has been collected. It is the whole game now: a span
    // rendered on several pages (a wrapped paragraph, a reused fletcher label)
    // contributes one glyph per page, and the smallest `caret_rank` decides the
    // page. Compared as `(side, distance, page)`.

    #[test]
    fn caret_rank_prefers_glyph_at_or_before_caret() {
        let cursor = 17;
        // The glyph exactly at the caret is the best possible match (side 0,
        // zero distance) — page is irrelevant when offset/distance already win.
        assert_eq!(caret_rank(17, 9, cursor), (0, 0, 9));
        // A glyph just before the caret beats one just after, even though both
        // are one byte away — this is the page-N-vs-page-(N+1) tie-break at a
        // page break.
        assert!(caret_rank(16, 5, cursor) < caret_rank(18, 5, cursor));
        // Among before-or-at glyphs, the nearest (largest offset ≤ cursor) wins.
        assert!(caret_rank(16, 5, cursor) < caret_rank(0, 5, cursor));
        // A far-before glyph still beats any after-caret glyph (the cursor
        // belongs to the character on its left).
        assert!(caret_rank(0, 5, cursor) < caret_rank(18, 5, cursor));
        // Among after-caret glyphs, the nearest wins.
        assert!(caret_rank(18, 5, cursor) < caret_rank(49, 5, cursor));
    }

    #[test]
    fn caret_rank_breaks_exact_offset_ties_by_page() {
        let cursor = 100;
        // The same source offset rendered on two pages (reused diagram content):
        // identical side + distance, so the earlier page wins (reading order).
        assert!(caret_rank(100, 2, cursor) < caret_rank(100, 4, cursor));
        // Likewise for a before-caret offset shared across pages.
        assert!(caret_rank(80, 1, cursor) < caret_rank(80, 6, cursor));
    }

    #[test]
    fn caret_rank_distance_outranks_page() {
        let cursor = 100;
        // A nearer glyph on a *later* page still beats a farther glyph on an
        // earlier page — distance is compared before the page tiebreak, so a
        // wrapped paragraph resolves to the page holding the caret's own line,
        // not merely the first page the span touches.
        assert!(caret_rank(99, 7, cursor) < caret_rank(80, 1, cursor));
    }

    // ─── resolve_preview_position (end-to-end) ──────────────────────────────────

    #[test]
    fn outline_duplicates_the_heading_render() {
        // Precondition for the tests below: with an #outline, a heading's text
        // really does render on two pages (the outline copy on page 1 and the
        // body copy), so `jump_from_cursor` returns several candidates. If typst's
        // outline behaviour ever stopped reusing the heading span, these tests
        // would no longer exercise the disambiguation and this guard would catch
        // it.
        let world = TestWorld::new(OUTLINE_FIXTURE);
        let doc = world.compile();
        let source = world.source(world.main).unwrap();
        let cursor = caret_in_heading(OUTLINE_FIXTURE, "Alpha");

        let pages: Vec<usize> = typst_ide::jump_from_cursor(&doc, &source, cursor)
            .iter()
            .map(|p| p.page.get())
            .collect();

        assert!(
            pages.contains(&1),
            "one copy of the heading is rendered in the outline on page 1 ({pages:?})",
        );
        assert!(
            pages.contains(&2),
            "the other copy is the body heading on page 2 ({pages:?})",
        );
    }

    #[test]
    fn resolves_each_heading_level_to_its_body_page_not_the_outline() {
        // The whole reason the round-trip exists: a heading echoed in an #outline
        // renders on page 1 too, and the glyph scan alone would tie-break to that
        // earliest (outline) page. The round-trip must instead land on the body
        // page, where the heading resolves to a Jump::File rather than the
        // outline's Jump::Position link. Covers level-1, -2 and -3 headings.
        for (heading, body_page) in [("Alpha", 2usize), ("Beta", 3), ("Gamma", 4)] {
            let cursor = caret_in_heading(OUTLINE_FIXTURE, heading);
            let resolved = resolve_at(OUTLINE_FIXTURE, cursor)
                .unwrap_or_else(|| panic!("{heading}: expected a resolved preview position"));
            assert_eq!(
                resolved.page.get(),
                body_page,
                "{heading}: caret in the body heading must resolve to its body page, \
                 not the duplicate rendered in the outline on page 1",
            );
        }
    }

    #[test]
    fn single_render_resolves_to_its_page() {
        // No outline → the body text renders exactly once, so there's nothing to
        // disambiguate and resolution falls to the glyph scan, which lands on the
        // page holding the caret's text.
        let text = "First page.\n#pagebreak()\nSecond page paragraph.\n";
        let cursor = text.find("Second").unwrap() + 1;
        let resolved = resolve_at(text, cursor).expect("rendered text resolves to a position");
        assert_eq!(resolved.page.get(), 2, "the paragraph sits on page 2");
    }

    #[test]
    fn caret_off_rendered_text_resolves_to_nothing() {
        // Caret inside code (the `outline` function name) isn't on a Text node, so
        // `jump_from_cursor` yields no candidates and we leave the preview where it
        // is rather than jumping somewhere arbitrary.
        let cursor = OUTLINE_FIXTURE.find("outline").unwrap();
        assert!(
            resolve_at(OUTLINE_FIXTURE, cursor).is_none(),
            "a caret on a code token should not move the preview",
        );
    }
}
