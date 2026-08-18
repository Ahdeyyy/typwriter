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

use typst_layout::PagedDocument;

/// A 128-bit hash of a page frame, used as a stable content identity.
pub type PageFingerprint = u128;

/// Fingerprint every page in the document.
pub fn fingerprint_pages(doc: &PagedDocument) -> Vec<PageFingerprint> {
    doc.pages()
        .iter()
        .map(|page| typst::utils::hash128(&page.frame))
        .collect()
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
