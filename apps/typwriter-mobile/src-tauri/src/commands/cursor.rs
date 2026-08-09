// Editor → preview: resolve the editor caret to the preview page it renders on,
// so opening the preview lands on the page the user was writing rather than at
// the top of the document.
//
// `typst_ide::jump_from_cursor` reports one position per page a span touches and
// can't say which page the caret's own character is on, so the page is resolved
// here by matching the rendered glyph nearest the caret across the whole
// document (see `find_caret_position`). This mirrors the desktop app's
// `commands/click.rs`, minus the click direction and the highlight rectangles —
// mobile only needs "which page?".

use std::{sync::Arc, time::Instant};

use log::info;
use tauri::State;
use typst::{
    introspection::PagedPosition,
    layout::{Abs, Frame, FrameItem, Point},
    syntax::{Source, Span},
    World,
};
use typst_ide::IdeWorld;
use typst_layout::PagedDocument;

use crate::{commands::editor::utf16_to_byte, compiler::CompileState, world::MobileWorld};

/// Resolve the caret in `rel_path` to a **0-based** preview page index.
///
/// `cursor` is a UTF-16 offset (CodeMirror's unit). Returns `None` when there is
/// no compiled document yet, or when the caret isn't on rendered content (inside
/// code, a blank gap) — the caller then leaves the preview where it is.
#[tauri::command]
pub async fn page_for_cursor(
    rel_path: String,
    cursor: usize,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<Option<usize>, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();

    // Scanning every glyph of a long document is measured in tens of ms — keep
    // it off the runtime's worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let Some(doc) = compile.document.lock().clone() else {
            return Ok(None);
        };
        let id = world.rel_to_id(&rel_path)?;
        let source = world.source(id).map_err(|e| e.to_string())?;
        let byte_cursor = utf16_to_byte(source.text(), cursor);

        let page = resolve_page(&*world, &doc, &source, byte_cursor);
        info!(
            "page_for_cursor: {rel_path:?} cursor={cursor} page={page:?} ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(page.map(|p| p.page.get() - 1))
    })
    .await
    .map_err(|e| format!("page_for_cursor task panicked: {e}"))?
}

/// Run `typst_ide::jump_from_cursor` (with the trailing-whitespace retry) and
/// pick the page from its candidates.
fn resolve_page(
    world: &dyn IdeWorld,
    doc: &PagedDocument,
    source: &Source,
    byte_cursor: usize,
) -> Option<PagedPosition> {
    let mut positions = typst_ide::jump_from_cursor(doc, source, byte_cursor);
    if positions.is_empty() {
        // The caret may sit right after trailing whitespace (e.g. at the end of
        // a line): `jump_from_cursor` requires the leaf *at* the cursor to be a
        // `Text`/`MathText` node, but whitespace is its own syntax node, so the
        // lookup comes back empty even though rendered text is one byte away.
        // Retry against the last non-whitespace byte; `find_caret_position`
        // still resolves the glyph using the original cursor, so this only
        // widens which candidates we're allowed to consider.
        if let Some(probe) = trailing_whitespace_probe(source.text(), byte_cursor) {
            positions = typst_ide::jump_from_cursor(doc, source, probe);
        }
    }
    resolve_preview_position(world, doc, source, byte_cursor, positions)
}

/// If `cursor` sits right after a run of plain spaces/tabs, back up to the byte
/// offset just past the last non-whitespace character before it — landing inside
/// that character's `Text` leaf instead of the whitespace node. Returns `None`
/// when there is no trailing whitespace to skip, or nothing but whitespace
/// before it (the caret genuinely isn't near rendered text).
fn trailing_whitespace_probe(text: &str, cursor: usize) -> Option<usize> {
    let before = text.get(..cursor)?;
    let trimmed = before.trim_end_matches([' ', '\t']);
    if trimmed.len() == before.len() || trimmed.is_empty() {
        return None;
    }
    Some(trimmed.len())
}

/// Pick the preview page for the caret from the candidates
/// `typst_ide::jump_from_cursor` produced. It reports one position per page on
/// which the caret's *exact* source offset is rendered:
///
/// * **Zero** — the caret isn't on rendered content. Return `None` so the
///   preview stays put rather than jumping somewhere arbitrary.
/// * **One** — the offset renders in a single place; [`find_caret_position`]
///   pins the precise glyph the caret sits on.
/// * **More than one** — the same offset renders on several pages (a heading
///   echoed in an `#outline`, a reference, a running header). The glyph scan
///   can't tell body copy from echo — it tie-breaks to the earliest page, i.e.
///   the outline — so disambiguate by round-tripping each candidate back through
///   the click resolver: an outline/reference entry is a *link* and resolves to
///   a [`typst_ide::Jump::Position`], while only the genuine body text resolves
///   to a [`typst_ide::Jump::File`] in this source.
fn resolve_preview_position(
    world: &dyn IdeWorld,
    doc: &PagedDocument,
    source: &Source,
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

/// Whether clicking `position` lands back on body text in `source` rather than
/// on a link such as an `#outline` entry.
///
/// `jump_from_cursor` hands us a glyph's **baseline** point, but
/// `jump_from_click`'s hit-test box for a glyph is `[baseline - text.size,
/// baseline]` — the raw baseline sits exactly on the box's bottom edge, which
/// smaller fonts fall off. Nudging a fraction of a point up and to the right
/// moves the probe into the glyph interior. The File jump's byte offset is
/// deliberately ignored: it's the clicked glyph's anchor, not the caret's.
fn round_trips_to_body(
    world: &dyn IdeWorld,
    doc: &PagedDocument,
    source: &Source,
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

/// Resolve the caret to the page+point of the rendered glyph nearest it.
///
/// Every glyph rendered from the caret's file is scanned across the whole
/// document; each glyph's *absolute* source byte offset is recovered (its span's
/// node start + `glyph.span.1`) and the glyph the caret sits on wins. Because
/// the offset is absolute, a paragraph that wraps across a page break resolves
/// to the correct page on either side.
fn find_caret_position(
    doc: &PagedDocument,
    source: &Source,
    cursor: usize,
) -> Option<PagedPosition> {
    let file = source.id();

    // Resolving a span to its byte range walks the syntax tree, so memoize it:
    // every glyph in a text run shares one span, making this a handful of
    // lookups rather than one per glyph.
    let mut span_starts: std::collections::HashMap<Span, usize> = std::collections::HashMap::new();

    // The rank's last element is the page index, so the winner carries its page.
    let mut best: Option<((u8, usize, usize), Point)> = None;

    for (index, page) in doc.pages().iter().enumerate() {
        for_each_glyph(&page.frame, &mut |span, span_offset, point| {
            // Only glyphs rendered from *this* file can carry the caret; spans
            // from imports/packages map into a different source text.
            if span.id() != Some(file) {
                return;
            }
            let start = match span_starts.get(&span) {
                Some(&start) => start,
                None => {
                    let Some(node) = source.find(span) else {
                        return;
                    };
                    let start = node.range().start;
                    span_starts.insert(span, start);
                    start
                }
            };
            let rank = caret_rank(start + span_offset as usize, index, cursor);
            if best.as_ref().is_none_or(|(best_rank, _)| rank < *best_rank) {
                best = Some((rank, point));
            }
        });
    }

    let (rank, point) = best?;
    let page = std::num::NonZeroUsize::new(rank.2 + 1).expect("page indices are 1-based");
    Some(PagedPosition { page, point })
}

/// Ordering key that selects the glyph the caret sits on. Compared
/// lexicographically as `(side, distance, page)`:
///
/// * `side` — `0` for a glyph at/just-before the caret, `1` for one after it. A
///   text cursor belongs to the character on its left, so any before-or-at glyph
///   beats every after glyph regardless of distance.
/// * `distance` — bytes between the glyph and the caret; nearest wins.
/// * `page` — breaks exact-offset ties (the same offset rendered on several
///   pages) in reading order.
fn caret_rank(offset: usize, page: usize, cursor: usize) -> (u8, usize, usize) {
    if offset <= cursor {
        (0, cursor - offset, page)
    } else {
        (1, offset - cursor, page)
    }
}

/// Walk a frame, invoking `f(span, span_offset, origin)` for every glyph it
/// renders. Mirrors typst-ide's `find_in_frame`, but reports all glyphs rather
/// than the first match per page — which is what lets the caller match the glyph
/// nearest the caret across the whole document. `origin` is the glyph's left
/// edge on the baseline.
fn for_each_glyph(frame: &Frame, f: &mut dyn FnMut(Span, u16, Point)) {
    for &(pos, ref item) in frame.items() {
        match item {
            FrameItem::Group(group) => {
                for_each_glyph(&group.frame, &mut |span, offset, point| {
                    f(span, offset, pos + point.transform(group.transform))
                });
            }
            FrameItem::Text(text) => {
                let mut x = pos.x;
                for glyph in &text.glyphs {
                    f(glyph.span.0, glyph.span.1, Point::new(x, pos.y));
                    x += glyph.x_advance.at(text.size);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{caret_rank, trailing_whitespace_probe};

    #[test]
    fn caret_rank_prefers_glyph_at_or_before_caret() {
        let cursor = 17;
        // The glyph exactly at the caret is the best possible match.
        assert_eq!(caret_rank(17, 9, cursor), (0, 0, 9));
        // A glyph just before the caret beats one just after, even though both
        // are one byte away — this is the page-N-vs-page-(N+1) tie-break at a
        // page break.
        assert!(caret_rank(16, 5, cursor) < caret_rank(18, 5, cursor));
        // Among before-or-at glyphs, the nearest wins.
        assert!(caret_rank(16, 5, cursor) < caret_rank(0, 5, cursor));
        // A far-before glyph still beats any after-caret glyph.
        assert!(caret_rank(0, 5, cursor) < caret_rank(18, 5, cursor));
    }

    #[test]
    fn caret_rank_breaks_exact_offset_ties_by_page() {
        let cursor = 100;
        assert!(caret_rank(100, 2, cursor) < caret_rank(100, 4, cursor));
    }

    #[test]
    fn caret_rank_distance_outranks_page() {
        // A nearer glyph on a *later* page beats a farther glyph on an earlier
        // one, so a wrapped paragraph resolves to the page holding the caret's
        // own line rather than the first page its span touches.
        assert!(caret_rank(99, 7, 100) < caret_rank(80, 1, 100));
    }

    #[test]
    fn trailing_whitespace_probe_backs_up_to_last_real_character() {
        assert_eq!(trailing_whitespace_probe("Hello world ", 12), Some(11));
        assert_eq!(trailing_whitespace_probe("Hello world  ", 13), Some(11));
        assert_eq!(trailing_whitespace_probe("Hello\tworld\t", 12), Some(11));
        assert_eq!(trailing_whitespace_probe("Hello world", 11), None);
        assert_eq!(trailing_whitespace_probe("   ", 3), None);
    }
}
