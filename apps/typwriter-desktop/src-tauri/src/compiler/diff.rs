// Per-page fingerprinting, and the alignment that turns two fingerprint
// vectors into a page-level change list.
//
// The diff between two *consecutive compiles* is computed inline in
// `PreviewPipeline::compile_and_emit`, where it needs to consider both the
// content fingerprint and the current zoom bucket together — that path only
// asks "does slot i still hold the same page?" and never needs alignment.
//
// [`align_pages`] is the richer question, asked by the page-diff engine:
// given the document as it was at a restore point and as it is now, which
// pages changed, which are new, which are gone? Inserting a paragraph on
// page 1 renumbers everything after it, so a positional comparison would
// report a 400-page document as entirely rewritten. An LCS over the
// fingerprints finds the pages that survived, and the gaps between them are
// where the real edits are.

use std::hash::{Hash, Hasher};

use typst::foundations::Smart;
use typst::layout::{Frame, FrameItem};
use typst::visualize::{FixedStroke, Paint};
use typst_layout::{Page, PagedDocument};

/// A 128-bit hash of everything a page *draws*, used as a stable content
/// identity. Stable means across app runs, not just within one: it names the
/// PNGs in the on-disk preview cache, so a re-opened, unchanged document has
/// to arrive at the same value or every page is rendered again.
pub type PageFingerprint = u128;

/// Mixed into every fingerprint. The disk cache outlives the process, so a
/// release that draws the same frame differently (a Typst upgrade, say) must
/// not be handed the previous release's PNGs.
const FINGERPRINT_SALT: (&str, u32) = (env!("CARGO_PKG_VERSION"), 1);

/// Fingerprint every page in the document.
pub fn fingerprint_pages(doc: &PagedDocument) -> Vec<PageFingerprint> {
    doc.pages().iter().map(fingerprint_page).collect()
}

/// Fingerprint one page. See [`PageFingerprint`].
pub fn fingerprint_page(page: &Page) -> PageFingerprint {
    typst::utils::hash128(&(FINGERPRINT_SALT, PaintedPage(page)))
}

// Typst's own `Hash for Frame` can't be the fingerprint: it covers source
// spans, introspection tags and labels, which hash interned ids (`FileId`,
// `PicoStr`) that are handed out in first-use order and so differ from one
// run to the next. None of that reaches the pixels. These wrappers hash what
// `typst_render` reads and nothing else.

struct PaintedPage<'a>(&'a Page);

impl Hash for PaintedPage<'_> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // The background is a property of the page, not of its frame.
        match &self.0.fill {
            Smart::Auto => 0u8.hash(state),
            Smart::Custom(fill) => {
                1u8.hash(state);
                fill.as_ref().map(PaintedPaint).hash(state);
            }
        }
        PaintedFrame(&self.0.frame).hash(state);
    }
}

struct PaintedFrame<'a>(&'a Frame);

impl Hash for PaintedFrame<'_> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        let frame = self.0;
        frame.size().hash(state);
        // Hard frames are the boundary gradients and tilings resolve against.
        frame.kind().hash(state);
        for (pos, item) in frame.items() {
            match item {
                FrameItem::Group(group) => {
                    0u8.hash(state);
                    pos.hash(state);
                    group.transform.hash(state);
                    group.clip.hash(state);
                    PaintedFrame(&group.frame).hash(state);
                }
                FrameItem::Text(text) => {
                    1u8.hash(state);
                    pos.hash(state);
                    text.font.hash(state);
                    text.size.hash(state);
                    PaintedPaint(&text.fill).hash(state);
                    text.stroke.as_ref().map(PaintedStroke).hash(state);
                    text.glyphs.len().hash(state);
                    for glyph in &text.glyphs {
                        glyph.id.hash(state);
                        glyph.x_advance.hash(state);
                        glyph.x_offset.hash(state);
                        glyph.y_advance.hash(state);
                        glyph.y_offset.hash(state);
                    }
                }
                FrameItem::Shape(shape, _) => {
                    2u8.hash(state);
                    pos.hash(state);
                    shape.geometry.hash(state);
                    shape.fill.as_ref().map(PaintedPaint).hash(state);
                    shape.fill_rule.hash(state);
                    shape.stroke.as_ref().map(PaintedStroke).hash(state);
                }
                FrameItem::Image(image, size, _) => {
                    3u8.hash(state);
                    pos.hash(state);
                    image.hash(state);
                    size.hash(state);
                }
                // Links and tags draw nothing.
                FrameItem::Link(..) | FrameItem::Tag(_) => {}
            }
        }
        // Closes the item list, so a nested frame's items can't be mistaken
        // for its parent's.
        u8::MAX.hash(state);
    }
}

struct PaintedPaint<'a>(&'a Paint);

impl Hash for PaintedPaint<'_> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        match self.0 {
            Paint::Solid(color) => {
                0u8.hash(state);
                color.hash(state);
            }
            Paint::Gradient(gradient) => {
                1u8.hash(state);
                gradient.hash(state);
            }
            // A tiling carries a whole frame, spans and all.
            Paint::Tiling(tiling) => {
                2u8.hash(state);
                PaintedFrame(tiling.frame()).hash(state);
                tiling.size().hash(state);
                tiling.spacing().hash(state);
                tiling.offset().hash(state);
                tiling.relative().hash(state);
            }
        }
    }
}

struct PaintedStroke<'a>(&'a FixedStroke);

impl Hash for PaintedStroke<'_> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        let stroke = self.0;
        PaintedPaint(&stroke.paint).hash(state);
        stroke.thickness.hash(state);
        stroke.cap.hash(state);
        stroke.join.hash(state);
        stroke.dash.hash(state);
        stroke.miter_limit.hash(state);
    }
}

/// What happened to one page between the two documents.
#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PageChangeKind {
    /// Byte-identical frame, possibly at a different page number.
    Unchanged,
    /// A page that exists on both sides but renders differently.
    Changed,
    /// Only in the newer document.
    Added,
    /// Only in the older document.
    Removed,
}

/// One row of the page-level diff. Exactly one of `before`/`after` is `None`
/// for `Added`/`Removed`; both are set otherwise. Indices are 0-based into
/// their respective documents.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PageAlignment {
    pub kind: PageChangeKind,
    pub before: Option<usize>,
    pub after: Option<usize>,
}

/// Above this many DP cells the LCS table stops being worth its memory
/// (`u32` per cell, so 4M cells is about 16 MB). Documents that large fall
/// back to a positional comparison, which is wrong about insertions but
/// bounded.
const LCS_CELL_BUDGET: usize = 4_000_000;

/// Align two page-fingerprint vectors into a change list.
///
/// Pages present in both (in order) are `Unchanged`. Each run of
/// non-matching pages between two survivors is paired up positionally:
/// the k-th dropped page meets the k-th inserted page as a single `Changed`
/// row, and whatever is left over becomes `Removed` / `Added`. That pairing
/// is what turns "page 7 was deleted and a different page 7 appeared" — all
/// an edit script can say — back into "page 7 changed", which is what the
/// user actually did.
///
/// The returned rows read in document order: every row for a given gap comes
/// before the survivor that follows it.
pub fn align_pages(before: &[PageFingerprint], after: &[PageFingerprint]) -> Vec<PageAlignment> {
    if before.len().saturating_mul(after.len()) > LCS_CELL_BUDGET {
        return align_positional(before, after);
    }

    let n = before.len();
    let m = after.len();

    // lcs[i][j] = length of the longest common subsequence of before[i..]
    // and after[j..]. Built backwards so the walk below can go forwards,
    // which keeps the output in document order without a reverse.
    let mut lcs = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if before[i] == after[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut out = Vec::new();
    // Pages dropped / inserted since the last survivor. Flushed as paired
    // `Changed` rows (plus leftovers) whenever a survivor is reached.
    let mut dropped: Vec<usize> = Vec::new();
    let mut inserted: Vec<usize> = Vec::new();

    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if before[i] == after[j] {
            flush_gap(&mut out, &mut dropped, &mut inserted);
            out.push(PageAlignment {
                kind: PageChangeKind::Unchanged,
                before: Some(i),
                after: Some(j),
            });
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            dropped.push(i);
            i += 1;
        } else {
            inserted.push(j);
            j += 1;
        }
    }
    dropped.extend(i..n);
    inserted.extend(j..m);
    flush_gap(&mut out, &mut dropped, &mut inserted);
    out
}

/// Pair up one run of non-matching pages and append it to `out`.
fn flush_gap(out: &mut Vec<PageAlignment>, dropped: &mut Vec<usize>, inserted: &mut Vec<usize>) {
    let paired = dropped.len().min(inserted.len());
    for k in 0..paired {
        out.push(PageAlignment {
            kind: PageChangeKind::Changed,
            before: Some(dropped[k]),
            after: Some(inserted[k]),
        });
    }
    for &b in &dropped[paired..] {
        out.push(PageAlignment {
            kind: PageChangeKind::Removed,
            before: Some(b),
            after: None,
        });
    }
    for &a in &inserted[paired..] {
        out.push(PageAlignment {
            kind: PageChangeKind::Added,
            before: None,
            after: Some(a),
        });
    }
    dropped.clear();
    inserted.clear();
}

/// Fallback for documents too large to run LCS over: compare page N to page
/// N. Reports every page after an insertion as changed, which is wrong but
/// honest — and it costs O(n).
fn align_positional(before: &[PageFingerprint], after: &[PageFingerprint]) -> Vec<PageAlignment> {
    let common = before.len().min(after.len());
    let mut out = Vec::with_capacity(before.len().max(after.len()));
    for i in 0..common {
        out.push(PageAlignment {
            kind: if before[i] == after[i] {
                PageChangeKind::Unchanged
            } else {
                PageChangeKind::Changed
            },
            before: Some(i),
            after: Some(i),
        });
    }
    for i in common..before.len() {
        out.push(PageAlignment {
            kind: PageChangeKind::Removed,
            before: Some(i),
            after: None,
        });
    }
    for i in common..after.len() {
        out.push(PageAlignment {
            kind: PageChangeKind::Added,
            before: None,
            after: Some(i),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use typst::foundations::Content;
    use typst::layout::{Abs, Point, Sides, Size};
    use std::num::NonZeroU64;
    use typst::diag::{FileError, FileResult};
    use typst::foundations::{Bytes, Datetime, Duration};
    use typst::syntax::{FileId, RootedPath, Source, Span, VirtualPath, VirtualRoot};
    use typst::text::{Font, FontBook};
    use typst::utils::LazyHash;
    use typst::{Library, LibraryExt, World};
    use typst_kit::fonts::FontStore;
    use typst::visualize::{Color, Geometry};

    /// A page with one filled rectangle, attributed to source span `span`.
    fn page_with_rect(span: u64, width: f64, fill: Color) -> Page {
        let span = Span::from_raw(NonZeroU64::new(span).unwrap());
        let size = Size::new(Abs::pt(200.0), Abs::pt(100.0));
        let rect = Geometry::Rect(Size::new(Abs::pt(width), Abs::pt(20.0))).filled(fill);
        let mut inner = Frame::soft(size);
        inner.push(Point::zero(), FrameItem::Shape(rect, span));
        let mut frame = Frame::hard(size);
        frame.push_frame(Point::zero(), inner);
        Page {
            frame,
            bleed: Sides::default(),
            fill: Smart::Auto,
            numbering: None,
            supplement: Content::empty(),
            number: 1,
        }
    }

    // What broke the on-disk preview cache: the same page, compiled in another
    // run, attributes its items to differently-numbered source spans.
    #[test]
    fn fingerprint_ignores_where_the_page_came_from() {
        let a = page_with_rect(7, 50.0, Color::BLACK);
        let b = page_with_rect(8, 50.0, Color::BLACK);
        assert_ne!(typst::utils::hash128(&a.frame), typst::utils::hash128(&b.frame));
        assert_eq!(fingerprint_page(&a), fingerprint_page(&b));
    }

    /// Just enough of a `World` to compile one in-memory source.
    struct OneFileWorld {
        library: LazyHash<Library>,
        fonts: FontStore,
        source: Source,
    }

    impl OneFileWorld {
        fn new(file: &str, text: &str) -> Self {
            let id = RootedPath::new(VirtualRoot::Project, VirtualPath::new(file).unwrap()).intern();
            let mut fonts = FontStore::new();
            fonts.extend(typst_kit::fonts::embedded());
            Self {
                library: LazyHash::new(Library::default()),
                fonts,
                source: Source::new(id, text.into()),
            }
        }
    }

    impl World for OneFileWorld {
        fn library(&self) -> &LazyHash<Library> {
            &self.library
        }

        fn book(&self) -> &LazyHash<FontBook> {
            self.fonts.book()
        }

        fn main(&self) -> FileId {
            self.source.id()
        }

        fn source(&self, id: FileId) -> FileResult<Source> {
            if id == self.source.id() {
                Ok(self.source.clone())
            } else {
                Err(FileError::AccessDenied)
            }
        }

        fn file(&self, _: FileId) -> FileResult<Bytes> {
            Err(FileError::AccessDenied)
        }

        fn font(&self, index: usize) -> Option<Font> {
            self.fonts.font(index)
        }

        fn today(&self, _: Option<Duration>) -> Option<Datetime> {
            None
        }
    }

    // The real thing, end to end: one document compiled as two differently
    // named main files gets different `FileId`s, as it would in two runs.
    #[test]
    fn recompiling_the_same_document_keeps_its_fingerprints() {
        const TEXT: &str = "#set page(width: 200pt, height: 120pt, fill: luma(240))
            #set heading(numbering: \"1.\")
            = Intro <intro>
            See @intro and #link(\"https://typst.app\")[the site].
            #rect(fill: gradient.linear(red, blue), stroke: 2pt + green)
            $ sum_(i=0)^n i $
            #pagebreak()
            Second page.";
        let compile = |file: &str| {
            typst::compile::<PagedDocument>(&OneFileWorld::new(file, TEXT))
                .output
                .expect("the fixture compiles")
        };
        let (a, b) = (compile("a.typ"), compile("nested/b.typ"));
        assert!(a.pages().len() > 1);

        let (fps_a, fps_b) = (fingerprint_pages(&a), fingerprint_pages(&b));
        assert_eq!(fps_a, fps_b);
        assert_ne!(fps_a[0], fps_a[1]);
        assert_ne!(
            typst::utils::hash128(&a.pages()[0].frame),
            typst::utils::hash128(&b.pages()[0].frame)
        );
    }

    #[test]
    fn fingerprint_follows_what_the_page_draws() {
        let base = page_with_rect(7, 50.0, Color::BLACK);
        let wider = page_with_rect(7, 51.0, Color::BLACK);
        let recolored = page_with_rect(7, 50.0, Color::WHITE);
        let mut filled = page_with_rect(7, 50.0, Color::BLACK);
        filled.fill = Smart::Custom(Some(Color::BLACK.into()));

        let fp = fingerprint_page(&base);
        assert_ne!(fp, fingerprint_page(&wider));
        assert_ne!(fp, fingerprint_page(&recolored));
        assert_ne!(fp, fingerprint_page(&filled));
    }

    fn kinds(rows: &[PageAlignment]) -> Vec<PageChangeKind> {
        rows.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn identical_documents_have_no_changes() {
        let fps = [1u128, 2, 3, 4];
        let rows = align_pages(&fps, &fps);
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|r| r.kind == PageChangeKind::Unchanged));
        assert_eq!(rows[2].before, Some(2));
        assert_eq!(rows[2].after, Some(2));
    }

    #[test]
    fn edited_page_is_changed_not_added_plus_removed() {
        // Page 2 (index 1) re-rendered; everything else survived.
        let rows = align_pages(&[1, 2, 3], &[1, 9, 3]);
        assert_eq!(
            kinds(&rows),
            vec![
                PageChangeKind::Unchanged,
                PageChangeKind::Changed,
                PageChangeKind::Unchanged
            ]
        );
        assert_eq!(rows[1].before, Some(1));
        assert_eq!(rows[1].after, Some(1));
    }

    // The whole reason for LCS: adding content near the front renumbers every
    // later page, and a positional compare would call all of them changed.
    #[test]
    fn insertion_does_not_mark_the_shifted_tail_as_changed() {
        let rows = align_pages(&[1, 2, 3, 4], &[1, 9, 2, 3, 4]);
        assert_eq!(
            kinds(&rows),
            vec![
                PageChangeKind::Unchanged,
                PageChangeKind::Added,
                PageChangeKind::Unchanged,
                PageChangeKind::Unchanged,
                PageChangeKind::Unchanged
            ]
        );
        // The surviving pages report their *new* numbers.
        let tail: Vec<_> = rows.iter().filter(|r| r.before == Some(3)).collect();
        assert_eq!(tail[0].after, Some(4));
    }

    #[test]
    fn deletion_reports_removed_and_keeps_the_rest_aligned() {
        let rows = align_pages(&[1, 2, 3, 4], &[1, 3, 4]);
        assert_eq!(
            kinds(&rows),
            vec![
                PageChangeKind::Unchanged,
                PageChangeKind::Removed,
                PageChangeKind::Unchanged,
                PageChangeKind::Unchanged
            ]
        );
        assert_eq!(rows[1].before, Some(1));
        assert_eq!(rows[1].after, None);
    }

    #[test]
    fn uneven_gap_pairs_what_it_can_and_reports_the_rest() {
        // Two old pages replaced by three new ones: two Changed, one Added.
        let rows = align_pages(&[1, 2, 3, 9], &[1, 7, 8, 5, 9]);
        assert_eq!(
            kinds(&rows),
            vec![
                PageChangeKind::Unchanged,
                PageChangeKind::Changed,
                PageChangeKind::Changed,
                PageChangeKind::Added,
                PageChangeKind::Unchanged
            ]
        );
    }

    #[test]
    fn empty_sides_degrade_to_all_added_or_all_removed() {
        assert_eq!(
            kinds(&align_pages(&[], &[1, 2])),
            vec![PageChangeKind::Added, PageChangeKind::Added]
        );
        assert_eq!(
            kinds(&align_pages(&[1, 2], &[])),
            vec![PageChangeKind::Removed, PageChangeKind::Removed]
        );
        assert!(align_pages(&[], &[]).is_empty());
    }

    #[test]
    fn a_wholly_rewritten_document_pairs_page_for_page() {
        let rows = align_pages(&[1, 2, 3], &[7, 8, 9]);
        assert!(rows.iter().all(|r| r.kind == PageChangeKind::Changed));
        assert_eq!(rows[0].before, Some(0));
        assert_eq!(rows[0].after, Some(0));
        assert_eq!(rows[2].before, Some(2));
    }

    #[test]
    fn positional_fallback_matches_lcs_when_nothing_moved() {
        let before: Vec<u128> = (0..8).collect();
        let mut after = before.clone();
        after[3] = 99;
        assert_eq!(
            align_positional(&before, &after),
            align_pages(&before, &after)
        );
    }
}
