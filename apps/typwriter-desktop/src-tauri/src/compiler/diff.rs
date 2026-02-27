// compiler/diff.rs
//
// Per-page fingerprinting and diffing so we only re-render pages that actually
// changed between two consecutive compilations.

use typst::layout::PagedDocument;

/// A 128-bit hash of a page frame, used as a stable identity/cache key.
pub type PageFingerprint = u128;

/// Fingerprint every page in the document.
pub fn fingerprint_pages(doc: &PagedDocument) -> Vec<PageFingerprint> {
    doc.pages
        .iter()
        .map(|page| typst::utils::hash128(&page.frame))
        .collect()
}

/// Compare old and new fingerprint slices.
///
/// Returns:
/// - `changed` — indices of pages that are new or whose content changed.
/// - `removed_count` — how many trailing pages were removed (old had more pages).
pub fn diff_pages(old: &[PageFingerprint], new: &[PageFingerprint]) -> (Vec<usize>, usize) {
    let mut changed = Vec::new();

    for (i, &new_fp) in new.iter().enumerate() {
        if old.get(i).copied() != Some(new_fp) {
            changed.push(i);
        }
    }

    let removed_count = old.len().saturating_sub(new.len());
    (changed, removed_count)
}
