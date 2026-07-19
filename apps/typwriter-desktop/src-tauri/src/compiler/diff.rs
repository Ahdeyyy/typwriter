// Per-page fingerprinting. The diff between two compiles is computed inline
// in `PreviewPipeline::compile_and_emit`, where it needs to consider both the
// content fingerprint and the current zoom bucket together.

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
