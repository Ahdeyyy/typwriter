//! Position bookkeeping for the Typst → Harper translation.
//!
//! `typst-syntax` reports positions as opaque [`Span`]s over **byte** offsets;
//! Harper works in **character** offsets. Bridging the two naively (one span
//! lookup + one UTF-8 recount per token) is what upstream's `harper-typst`
//! does, and it costs a tree search per token plus a hard assumption that the
//! translator only ever walks forward.
//!
//! Instead we precompute both directions once per parse:
//!
//! * [`SpanRanges`] — one iterative walk over the tree recording each node's
//!   byte range, keyed by its span. This also means we never call
//!   `Source::range`, whose signature changed in 0.15; all we depend on is
//!   `SyntaxNode::{span, len, children}`.
//! * [`CharOffsets`] — a byte → char index table, skipped entirely for ASCII
//!   sources (the common case).
//!
//! The result is O(1) lookups with no ordering constraints, so the translator
//! is free to visit nodes out of source order.

use std::collections::HashMap;
use std::num::NonZeroU64;
use std::ops::Range;

use harper_core::Span as CharSpan;
use typst_syntax::{Source, Span, SyntaxNode};

/// Byte ranges for every node of a parsed [`Source`], keyed by span.
///
/// Spans are unique per node once a `Source` has been numberized, which
/// `Source::new`/`Source::detached` always do.
struct SpanRanges {
    ranges: HashMap<NonZeroU64, Range<usize>>,
}

impl SpanRanges {
    fn build(root: &SyntaxNode) -> Self {
        let mut ranges = HashMap::new();
        // Iterative rather than recursive: adversarial input (deeply nested
        // brackets) can produce trees deep enough to overflow the stack, and
        // this parser runs on arbitrary editor buffers.
        let mut stack = vec![(root, 0usize)];
        while let Some((node, offset)) = stack.pop() {
            ranges.insert(node.span().into_raw(), offset..offset + node.len());
            let mut cursor = offset;
            for child in node.children() {
                stack.push((child, cursor));
                cursor += child.len();
            }
        }
        Self { ranges }
    }

    fn get(&self, span: Span) -> Option<Range<usize>> {
        self.ranges.get(&span.into_raw()).cloned()
    }
}

/// Byte index → character index lookup for a single source string.
struct CharOffsets {
    /// `None` when the source is pure ASCII, where the two indices coincide.
    /// Entry `i` holds the char index of the character containing byte `i`;
    /// the table has one extra entry for the end-of-input position.
    table: Option<Vec<u32>>,
    len: usize,
}

impl CharOffsets {
    fn new(text: &str) -> Self {
        if text.is_ascii() {
            return Self {
                table: None,
                len: text.len(),
            };
        }

        let mut table = Vec::with_capacity(text.len() + 1);
        let mut chars = 0u32;
        for c in text.chars() {
            // Continuation bytes map to the char that owns them, so a byte
            // offset landing mid-character still resolves sensibly.
            for _ in 0..c.len_utf8() {
                table.push(chars);
            }
            chars += 1;
        }
        table.push(chars);

        Self {
            len: chars as usize,
            table: Some(table),
        }
    }

    fn char_index(&self, byte: usize) -> usize {
        match &self.table {
            None => byte.min(self.len),
            Some(table) => table.get(byte).copied().unwrap_or(self.len as u32) as usize,
        }
    }
}

/// Everything the translator needs to turn a `typst-syntax` span into a Harper
/// span or a slice of the original source.
pub struct SourceMap<'a> {
    text: &'a str,
    spans: SpanRanges,
    chars: CharOffsets,
}

impl<'a> SourceMap<'a> {
    pub fn new(source: &'a Source) -> Self {
        Self {
            text: source.text(),
            spans: SpanRanges::build(source.root()),
            chars: CharOffsets::new(source.text()),
        }
    }

    /// The byte range a span covers, or `None` for synthesized/detached spans.
    pub fn byte_range(&self, span: Span) -> Option<Range<usize>> {
        self.spans.get(span)
    }

    /// The span's extent in Harper's character coordinates.
    pub fn char_span(&self, span: Span) -> Option<CharSpan<char>> {
        let range = self.byte_range(span)?;
        Some(self.char_span_of_bytes(range))
    }

    /// An empty character span pinned to the start of `span`. Used for markers
    /// (paragraph breaks around content blocks) that occupy no source text.
    pub fn char_span_at_start(&self, span: Span) -> Option<CharSpan<char>> {
        let start = self.chars.char_index(self.byte_range(span)?.start);
        Some(CharSpan::new_with_len(start, 0))
    }

    /// An empty character span pinned to the end of `span`.
    pub fn char_span_at_end(&self, span: Span) -> Option<CharSpan<char>> {
        let end = self.chars.char_index(self.byte_range(span)?.end);
        Some(CharSpan::new_with_len(end, 0))
    }

    /// Convert an arbitrary byte range into Harper's character coordinates.
    pub fn char_span_of_bytes(&self, range: Range<usize>) -> CharSpan<char> {
        let start = self.chars.char_index(range.start);
        let end = self.chars.char_index(range.end).max(start);
        CharSpan::new(start, end)
    }

    /// The character index at a byte offset.
    pub fn char_index(&self, byte: usize) -> usize {
        self.chars.char_index(byte)
    }

    /// The original source text a span covers.
    pub fn source_text(&self, span: Span) -> Option<&'a str> {
        self.text.get(self.byte_range(span)?)
    }

    /// The original source text between two byte offsets.
    pub fn slice(&self, range: Range<usize>) -> Option<&'a str> {
        self.text.get(range)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_offsets_are_identity() {
        let offsets = CharOffsets::new("hello world");
        assert!(offsets.table.is_none());
        assert_eq!(offsets.char_index(6), 6);
        // Past-the-end offsets clamp rather than panic.
        assert_eq!(offsets.char_index(99), 11);
    }

    #[test]
    fn non_ascii_offsets_count_characters() {
        // "é" is two bytes, "🎉" is four.
        let offsets = CharOffsets::new("aé🎉b");
        assert_eq!(offsets.char_index(0), 0);
        assert_eq!(offsets.char_index(1), 1);
        // Mid-character byte resolves to the character that owns it.
        assert_eq!(offsets.char_index(2), 1);
        assert_eq!(offsets.char_index(3), 2);
        assert_eq!(offsets.char_index(7), 3);
        assert_eq!(offsets.char_index(8), 4);
    }

    #[test]
    fn span_ranges_cover_the_whole_tree() {
        let source = Source::detached("= Hi\n\nSome *text* here.");
        let map = SourceMap::new(&source);
        let root = map.byte_range(source.root().span()).unwrap();
        assert_eq!(root, 0..source.text().len());
    }

    #[test]
    fn char_spans_account_for_multibyte_prefixes() {
        let source = Source::detached("é = 1\n\nword");
        let map = SourceMap::new(&source);
        let root_span = map.char_span(source.root().span()).unwrap();
        assert_eq!(root_span.start, 0);
        assert_eq!(root_span.end, source.text().chars().count());
    }
}
