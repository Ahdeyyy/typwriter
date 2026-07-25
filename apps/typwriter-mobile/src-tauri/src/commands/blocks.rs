// `block_extents` — map source spans (the frontend's block partition) to the
// vertical bands they occupy on the rendered pages.
//
// This is what lets the Notion-style block surface show each block's *real*
// compiled output instead of an approximation: the frontend crops the already
// rendered page PNGs to the returned `[y0, y1]` bands, so there's no second
// rasterization path and the webview's HTTP cache absorbs repeat views.
//
// Offsets crossing IPC are UTF-16 code units (CodeMirror's unit); typst works
// in UTF-8 bytes, so the conversion happens here against the main source.

use std::{collections::HashMap, sync::Arc};

use log::info;
use serde::{Deserialize, Serialize};
use tauri::State;
use typst::{
    layout::{Abs, Frame, FrameItem, Point},
    syntax::Span,
    World, WorldExt,
};
use crate::{commands::editor::utf16_to_byte, compiler::CompileState, world::MobileWorld};

/// One block's span in the main source, in UTF-16 code units.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSpanReq {
    pub id: String,
    pub from: usize,
    pub to: usize,
}

/// A vertical band of one page that a block rendered into.
#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlockExtent {
    /// 0-based page index.
    pub page: usize,
    pub y0_pt: f64,
    pub y1_pt: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlockExtentsResult {
    /// The compile these extents describe. The frontend drops the response if
    /// it no longer matches the render it is showing.
    pub generation: u64,
    /// `(block id, extents)`. A block that rendered nothing — a `#set` rule, a
    /// `#let`, a comment — gets an empty list and is drawn as a code chip.
    pub blocks: Vec<(String, Vec<BlockExtent>)>,
}

/// Vertical slack around a band so ascenders/descenders aren't clipped.
const PAD_PT: f64 = 2.0;

#[tauri::command]
pub async fn block_extents(
    spans: Vec<BlockSpanReq>,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<BlockExtentsResult, String> {
    let world = world.inner().clone();
    let state = compile.inner().clone();

    // A full-frame walk is cheap but not free, and SAF-era mobile must never
    // do it on the main thread.
    tauri::async_runtime::spawn_blocking(move || run(&world, &state, spans))
        .await
        .map_err(|e| format!("block_extents task panicked: {e}"))?
}

fn run(
    world: &MobileWorld,
    state: &CompileState,
    spans: Vec<BlockSpanReq>,
) -> Result<BlockExtentsResult, String> {
    let Some((generation, document)) = state.document_snapshot() else {
        // Nothing compiled yet: no extents, and generation 0 never matches a
        // real compile, so the frontend keeps showing source.
        return Ok(BlockExtentsResult {
            generation: 0,
            blocks: spans.into_iter().map(|s| (s.id, Vec::new())).collect(),
        });
    };

    let main = world.main_id().ok_or_else(|| "no main file set".to_string())?;
    let source = world.source(main).map_err(|e| e.to_string())?;
    let text = source.text();

    // Requests arrive as a partition of the source in document order; keep that
    // order for the response but search a byte-offset copy.
    let ranges: Vec<(usize, usize)> = spans
        .iter()
        .map(|s| (utf16_to_byte(text, s.from), utf16_to_byte(text, s.to)))
        .collect();

    // block index -> page index -> (min y, max y)
    let mut bands: HashMap<usize, HashMap<usize, (Abs, Abs)>> = HashMap::new();
    // Resolving a span to its byte range walks the syntax tree; every glyph in
    // a text run shares one span, so memoizing makes this a handful of lookups.
    let mut span_starts: HashMap<Span, Option<usize>> = HashMap::new();

    for (page_index, page) in document.pages().iter().enumerate() {
        let page_height = page.frame.height();
        for_each_item(&page.frame, &mut |span, span_offset, top, bottom| {
            if span.id() != Some(main) {
                return;
            }
            let start = *span_starts
                .entry(span)
                .or_insert_with(|| world.range(span).map(|r| r.start));
            let Some(start) = start else { return };
            let offset = start + span_offset as usize;
            let Some(block) = find_block(&ranges, offset) else {
                return;
            };
            let entry = bands
                .entry(block)
                .or_default()
                .entry(page_index)
                .or_insert((top, bottom));
            if top < entry.0 {
                entry.0 = top;
            }
            if bottom > entry.1 {
                entry.1 = bottom;
            }
            // Clamp to the page so padding can't push a crop off the image.
            entry.0 = entry.0.max(Abs::zero());
            entry.1 = entry.1.min(page_height);
        });
    }

    let blocks = spans
        .into_iter()
        .enumerate()
        .map(|(index, span)| {
            let extents = bands.remove(&index).map(collect_extents).unwrap_or_default();
            (span.id, extents)
        })
        .collect::<Vec<_>>();

    let mapped = blocks.iter().filter(|(_, e)| !e.is_empty()).count();
    info!(
        "block_extents: gen={generation} blocks={} mapped={mapped}",
        blocks.len()
    );

    Ok(BlockExtentsResult { generation, blocks })
}

/// Turn one block's per-page bands into padded extents in page order.
///
/// The walk accumulates a single min/max per page, so a block interrupted by a
/// float on the same page comes back as one band spanning the interruption —
/// the same y-only approximation that lets neighbouring columns bleed into a
/// crop. That's the accepted v1 trade-off (see `plans/typwriter-mobile/09`).
/// A block that spans a page break naturally yields one extent per page.
fn collect_extents(pages: HashMap<usize, (Abs, Abs)>) -> Vec<BlockExtent> {
    let mut extents: Vec<BlockExtent> = pages
        .into_iter()
        .map(|(page, (top, bottom))| BlockExtent {
            page,
            y0_pt: (top.to_pt() - PAD_PT).max(0.0),
            y1_pt: bottom.to_pt() + PAD_PT,
        })
        .collect();
    extents.sort_by_key(|e| e.page);
    extents
}

/// The index of the block whose `[from, to)` contains `offset`. The ranges are
/// a sorted partition, so this is a binary search on the starts.
fn find_block(ranges: &[(usize, usize)], offset: usize) -> Option<usize> {
    let index = match ranges.binary_search_by(|(from, _)| from.cmp(&offset)) {
        Ok(exact) => exact,
        Err(0) => return None,
        Err(after) => after - 1,
    };
    let (from, to) = ranges[index];
    // A zero-length block (an empty document) still owns the offset at its
    // start; everything else is a half-open span.
    if offset >= from && (offset < to || from == to) {
        Some(index)
    } else {
        None
    }
}

/// Walk a frame, reporting `(span, span_offset, top, bottom)` — the vertical
/// extent in page coordinates — for every item that carries a source span.
/// Adapted from the desktop's `for_each_glyph`, extended to `Shape` and
/// `Image` items (which carry spans directly and are all a diagram or figure
/// block ever produces).
fn for_each_item(frame: &Frame, f: &mut dyn FnMut(Span, u16, Abs, Abs)) {
    for &(pos, ref item) in frame.items() {
        match item {
            FrameItem::Group(group) => {
                let transform = group.transform;
                for_each_item(&group.frame, &mut |span, offset, top, bottom| {
                    // Map both edges through the group's transform; a rotation
                    // can flip them, so re-order before reporting.
                    let a = (pos + Point::new(Abs::zero(), top).transform(transform)).y;
                    let b = (pos + Point::new(Abs::zero(), bottom).transform(transform)).y;
                    f(span, offset, a.min(b), a.max(b))
                });
            }
            FrameItem::Text(text) => {
                // typst hit-tests a glyph as `[baseline - size, baseline]`;
                // widen a little below for descenders.
                let top = pos.y - text.size;
                let bottom = pos.y + text.size * 0.25;
                for glyph in &text.glyphs {
                    f(glyph.span.0, glyph.span.1, top, bottom);
                }
            }
            FrameItem::Shape(shape, span) => {
                let bbox = shape.geometry.bbox(shape.stroke.as_ref());
                f(*span, 0, pos.y + bbox.min.y, pos.y + bbox.max.y);
            }
            FrameItem::Image(_, size, span) => {
                f(*span, 0, pos.y, pos.y + size.y);
            }
            FrameItem::Link(_, _) | FrameItem::Tag(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{collect_extents, find_block};
    use std::collections::HashMap;
    use typst::layout::Abs;

    #[test]
    fn find_block_buckets_offsets_into_the_partition() {
        // [0,5) [5,12) [12,20)
        let ranges = [(0usize, 5usize), (5, 12), (12, 20)];
        assert_eq!(find_block(&ranges, 0), Some(0));
        assert_eq!(find_block(&ranges, 4), Some(0));
        assert_eq!(find_block(&ranges, 5), Some(1));
        assert_eq!(find_block(&ranges, 11), Some(1));
        assert_eq!(find_block(&ranges, 12), Some(2));
        assert_eq!(find_block(&ranges, 19), Some(2));
        // Past the end of the partition (a span from a file we don't cover).
        assert_eq!(find_block(&ranges, 20), None);
    }

    #[test]
    fn extents_are_padded_sorted_and_merged_per_page() {
        let mut pages = HashMap::new();
        pages.insert(2usize, (Abs::pt(100.0), Abs::pt(140.0)));
        pages.insert(1usize, (Abs::pt(700.0), Abs::pt(760.0)));

        let extents = collect_extents(pages);
        assert_eq!(extents.len(), 2, "a two-page block yields one extent per page");
        assert_eq!(extents[0].page, 1, "extents come back in page order");
        assert_eq!(extents[1].page, 2);
        // Padding widens the band but never crosses the top of the page.
        assert!(extents[1].y0_pt < 100.0 && extents[1].y1_pt > 140.0);
        assert!(collect_extents(HashMap::from([(0usize, (Abs::zero(), Abs::pt(10.0)))]))[0].y0_pt >= 0.0);
    }

    #[test]
    fn a_block_that_rendered_nothing_has_no_extents() {
        assert!(collect_extents(HashMap::new()).is_empty());
    }
}
