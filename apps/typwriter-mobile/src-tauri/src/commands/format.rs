// Typst source formatting via `typstyle-core`. Mobile only needs to format the
// document currently open in the editor (an in-memory buffer), so unlike the
// desktop app there are no file/workspace-on-disk variants here:
//   - format_typst_source         (pure text → text)
//   - format_typst_cursor_virtual (insert marker at cursor → format → find marker)
//
// Cursor maintenance lives entirely on the Rust side so positions stay in
// UTF-8 byte space until the very last step. The frontend (CodeMirror) speaks
// UTF-16 code units, so the boundary functions convert at the IPC edge.
//
// Cursor strategy — virtual marker:
// The returned text always comes from formatting the *unmarked* source, so it
// is identical to what `format_typst_source` produces. The cursor is located
// separately: splice a unique `/*tw_cursor_<hex>*/` block-comment marker into
// a copy of the source at the start of the word run the cursor touches,
// format that copy, and read the marker's new byte offset. Degrades to
// mapping the cursor through the common prefix/suffix of source → formatted
// if the marked copy fails to format or the marker is missing/duplicated
// post-format (e.g. cursor sat inside a string literal where `/* */` is
// literal text, or typstyle hoists the comment).

use std::time::{Instant, SystemTime, UNIX_EPOCH};

use log::{debug, error, warn};
use serde::Serialize;
use typstyle_core::Typstyle;

/// Format a Typst source string and return the formatted output.
#[tauri::command]
pub fn format_typst_source(source: String) -> Result<String, String> {
    let t = Instant::now();
    debug!("format_typst_source: bytes={}", source.len());

    let formatted = Typstyle::default()
        .format_text(source)
        .render()
        .map_err(|e| {
            error!("format_typst_source: err=\"{e}\"");
            e.to_string()
        })?;

    debug!(
        "format_typst_source: ok ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(formatted)
}

/// Response from any `format_typst_cursor_*` command — the formatted text
/// plus the cursor's new offset (UTF-16 code units, matching JavaScript
/// indexing).
#[derive(Serialize)]
pub struct FormatWithCursorResponse {
    pub formatted: String,
    pub cursor: u32,
}

// ── Virtual Cursor ───────────────────────────────────────────────────────
//
// Format the unmarked source for the output text, then format a marked copy
// (block-comment marker spliced at the cursor's word-run start) purely to
// locate where the cursor lands. See the module docs for the full strategy.
#[tauri::command]
pub fn format_typst_cursor_virtual(
    source: String,
    cursor: u32,
) -> Result<FormatWithCursorResponse, String> {
    let t = Instant::now();
    let byte_cursor = parse_utf16_cursor(&source, cursor)?;

    // Single source of truth for the text. If the source itself doesn't
    // format, the command fails here — exactly like the plain-format path.
    let formatted = Typstyle::default()
        .format_text(source.clone())
        .render()
        .map_err(|e| {
            error!("format_typst_cursor_virtual: format err=\"{e}\"");
            e.to_string()
        })?;

    let new_byte_cursor =
        locate_cursor_with_marker(&source, byte_cursor, &formatted).unwrap_or_else(|| {
            // Marked copy failed to format (marker landed in a syntax-
            // sensitive spot) or the marker was lost — degrade to mapping
            // the cursor through the common affixes of source → formatted.
            warn!("format_typst_cursor_virtual: marker unusable; mapping cursor by affix");
            map_cursor_by_affix(&source, &formatted, byte_cursor)
        });

    let new_cursor = byte_to_utf16_offset(&formatted, new_byte_cursor) as u32;
    debug!(
        "virtual[1/1] ok cursor_utf16={new_cursor} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(FormatWithCursorResponse {
        formatted,
        cursor: new_cursor,
    })
}

// ── Shared helpers ────────────────────────────────────────────────────────

fn parse_utf16_cursor(source: &str, cursor: u32) -> Result<usize, String> {
    let utf16 = cursor as usize;
    utf16_to_byte_offset(source, utf16).ok_or_else(|| {
        format!(
            "cursor offset {utf16} (utf16) is out of range for source of {} utf16 units",
            count_utf16(source)
        )
    })
}

/// Convert a UTF-16 code-unit offset (JavaScript-style) to a UTF-8 byte
/// offset. Returns `None` if the offset is past the end of the string.
/// If the offset falls inside a surrogate pair (which CodeMirror normally
/// prevents), rounds forward to the next char boundary.
fn utf16_to_byte_offset(s: &str, utf16: usize) -> Option<usize> {
    if utf16 == 0 {
        return Some(0);
    }
    let mut count = 0usize;
    for (byte_idx, ch) in s.char_indices() {
        if count == utf16 {
            return Some(byte_idx);
        }
        let units = ch.len_utf16();
        if count + units > utf16 {
            return Some(byte_idx + ch.len_utf8());
        }
        count += units;
    }
    if count == utf16 {
        Some(s.len())
    } else {
        None
    }
}

fn byte_to_utf16_offset(s: &str, byte_offset: usize) -> usize {
    let clamped = byte_offset.min(s.len());
    s[..clamped].encode_utf16().count()
}

fn count_utf16(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Round `idx` down to the nearest UTF-8 char boundary in `s` (returns
/// `s.len()` if `idx >= s.len()`). Idempotent on already-aligned offsets.
fn floor_char_boundary(s: &str, mut idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

// ── Virtual-cursor helpers ────────────────────────────────────────────────

/// Locate the cursor's byte offset in `formatted` by formatting a marked copy
/// of `source`. Returns `None` when the marked copy fails to format (the
/// marker landed somewhere syntax-sensitive despite the word-run snap) or the
/// marker isn't exactly once in the output — callers then fall back to
/// [`map_cursor_by_affix`]. The returned offset is in bounds of `formatted`
/// and on a char boundary.
fn locate_cursor_with_marker(source: &str, byte_cursor: usize, formatted: &str) -> Option<usize> {
    // Snap the splice point to the start of the word run the cursor touches:
    // a block comment spliced mid-identifier (`foo/*m*/bar`) or between a
    // sigil and its word (`#/*m*/foo`, `@/*m*/ref`) is a syntax error in code
    // mode. The cursor's offset within the run is added back after the marker
    // is located; the run's bytes are verified to have survived the reflow.
    let anchor = word_run_start(source, byte_cursor);
    let delta = byte_cursor - anchor;

    let marker = make_cursor_marker(source);
    let marked = {
        let mut buf = String::with_capacity(source.len() + marker.len());
        buf.push_str(&source[..anchor]);
        buf.push_str(&marker);
        buf.push_str(&source[anchor..]);
        buf
    };

    let raw = Typstyle::default().format_text(marked).render().ok()?;
    let idx = locate_unique(&raw, &marker)?;
    let mut stripped = String::with_capacity(raw.len() - marker.len());
    stripped.push_str(&raw[..idx]);
    stripped.push_str(&raw[idx + marker.len()..]);

    // Re-derive the cursor's position inside `stripped`. The word run the
    // cursor belongs to survives the reflow verbatim (formatters don't
    // rewrite word interiors), but typstyle may insert whitespace — a space,
    // or a newline plus indent when it hoists the comment — between the
    // marker and the run, so look for the run at the marker spot first and
    // just past any inserted whitespace second.
    let run = &source[anchor..byte_cursor];
    let pos_in_stripped = if run.is_empty() {
        // Cursor wasn't attached to a word; the marker spot itself is it.
        idx
    } else if stripped[idx..].starts_with(run) {
        idx + delta
    } else {
        let after_ws = idx + (stripped[idx..].len() - stripped[idx..].trim_start().len());
        if stripped[after_ws..].starts_with(run) {
            after_ws + delta
        } else {
            // Run not found (typstyle broke a line inside it, or rewrote it);
            // the marker spot is the best remaining anchor.
            floor_char_boundary(&stripped, idx.min(stripped.len()))
        }
    };

    if stripped == formatted {
        Some(pos_in_stripped)
    } else {
        // The marker changed typstyle's decisions (inserted whitespace, or a
        // line pushed over the width limit). `stripped` and `formatted` are
        // near-identical texts, so map the position between them.
        Some(map_cursor_by_affix(&stripped, formatted, pos_in_stripped))
    }
}

/// Byte offset where the contiguous "word run" containing `byte_cursor` ends
/// on its left — i.e. scan backwards over word-like characters. Word-like
/// covers identifier/number/label characters (alphanumeric, `_`, `-`, `.`,
/// `:`), the expression sigils that must stay glued to their word (`#`, `@`),
/// and the markup escape `\`. Returns `byte_cursor` itself when the preceding
/// char isn't word-like (splicing there is already safe).
fn word_run_start(source: &str, byte_cursor: usize) -> usize {
    fn is_word_char(c: char) -> bool {
        c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | ':' | '#' | '@' | '\\')
    }
    source[..byte_cursor]
        .char_indices()
        .rev()
        .take_while(|&(_, c)| is_word_char(c))
        .last()
        .map(|(i, _)| i)
        .unwrap_or(byte_cursor)
}

/// Map a cursor byte offset from `old` into `new` via the longest common
/// prefix and suffix: positions inside the shared prefix keep their offset,
/// positions inside the shared suffix shift by the length delta, and positions
/// in the differing middle clamp to the end of the middle region in `new`.
/// The result is always in bounds of `new` and on a char boundary.
fn map_cursor_by_affix(old: &str, new: &str, cursor: usize) -> usize {
    let cursor = floor_char_boundary(old, cursor.min(old.len()));
    let max_affix = old.len().min(new.len());

    let mut lcp = old
        .as_bytes()
        .iter()
        .zip(new.as_bytes())
        .take(max_affix)
        .take_while(|(a, b)| a == b)
        .count();
    // Prefix bytes are identical, so a char boundary in `old` is one in `new`
    // too — one floor aligns both.
    while lcp > 0 && !old.is_char_boundary(lcp) {
        lcp -= 1;
    }

    let mut lcs = old
        .as_bytes()
        .iter()
        .rev()
        .zip(new.as_bytes().iter().rev())
        .take(max_affix - lcp)
        .take_while(|(a, b)| a == b)
        .count();
    // Same argument as above, applied at the suffix start.
    while lcs > 0 && !old.is_char_boundary(old.len() - lcs) {
        lcs -= 1;
    }

    let mapped = if cursor <= lcp {
        cursor
    } else if cursor >= old.len() - lcs {
        new.len() - (old.len() - cursor)
    } else {
        cursor.min(new.len() - lcs)
    };
    floor_char_boundary(new, mapped.min(new.len()))
}

/// Pick a block-comment marker that isn't already present in `source`.
/// Block comments are valid in both code and markup mode and survive
/// typstyle reformatting (when the surrounding syntax is also valid), so
/// they're a stable anchor for tracking the cursor through reflows.
fn make_cursor_marker(source: &str) -> String {
    let mut seed: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0xdead_beef_dead_beef);
    for _ in 0..16 {
        let candidate = format!("/*tw_cursor_{seed:016x}*/");
        if !source.contains(&candidate) {
            return candidate;
        }
        // LCG advance — cheap, no rng dep needed.
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
    }
    // Vanishingly unlikely fallback.
    format!("/*tw_cursor_{seed:016x}_{:x}*/", source.len())
}

/// Returns `Some(offset)` if `needle` occurs exactly once in `haystack`.
fn locate_unique(haystack: &str, needle: &str) -> Option<usize> {
    let first = haystack.find(needle)?;
    let last = haystack.rfind(needle)?;
    if first == last {
        Some(first)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_round_trip_ascii() {
        let s = "hello";
        for i in 0..=s.len() {
            assert_eq!(utf16_to_byte_offset(s, i), Some(i));
            assert_eq!(byte_to_utf16_offset(s, i), i);
        }
    }

    #[test]
    fn utf16_with_multibyte() {
        // "é" is 2 bytes in UTF-8, 1 unit in UTF-16
        let s = "aébc";
        assert_eq!(utf16_to_byte_offset(s, 0), Some(0));
        assert_eq!(utf16_to_byte_offset(s, 1), Some(1));
        assert_eq!(utf16_to_byte_offset(s, 2), Some(3)); // after é
        assert_eq!(utf16_to_byte_offset(s, 3), Some(4));
        assert_eq!(utf16_to_byte_offset(s, 4), Some(5));
        assert_eq!(utf16_to_byte_offset(s, 5), None);

        assert_eq!(byte_to_utf16_offset(s, 0), 0);
        assert_eq!(byte_to_utf16_offset(s, 1), 1);
        assert_eq!(byte_to_utf16_offset(s, 3), 2);
        assert_eq!(byte_to_utf16_offset(s, 4), 3);
        assert_eq!(byte_to_utf16_offset(s, 5), 4);
    }

    #[test]
    fn utf16_with_surrogate_pair() {
        // "🦀" — 4 bytes UTF-8, 2 units UTF-16 (surrogate pair)
        let s = "a🦀b";
        assert_eq!(utf16_to_byte_offset(s, 0), Some(0));
        assert_eq!(utf16_to_byte_offset(s, 1), Some(1));
        assert_eq!(utf16_to_byte_offset(s, 3), Some(5)); // after the crab
        assert_eq!(utf16_to_byte_offset(s, 4), Some(6));

        assert_eq!(byte_to_utf16_offset(s, 1), 1);
        assert_eq!(byte_to_utf16_offset(s, 5), 3);
    }

    #[test]
    fn utf16_to_byte_offset_inside_surrogate_pair_rounds_forward() {
        // An offset between the surrogates rounds forward, never splitting it.
        let s = "a🦀b";
        assert_eq!(utf16_to_byte_offset(s, 2), Some(5));
    }

    #[test]
    fn floor_char_boundary_rounds_down_inside_multibyte() {
        // "é" occupies bytes 1..3.
        let s = "aébc";
        assert_eq!(floor_char_boundary(s, 1), 1); // already aligned
        assert_eq!(floor_char_boundary(s, 2), 1); // mid-é → floor to 1
        assert_eq!(floor_char_boundary(s, 3), 3); // aligned again
    }

    #[test]
    fn locate_unique_handles_duplicates_and_misses() {
        assert_eq!(locate_unique("aXbXc", "X"), None);
        assert_eq!(locate_unique("aXb", "X"), Some(1));
        assert_eq!(locate_unique("abc", "X"), None);
    }

    #[test]
    fn marker_is_unique_against_source() {
        let source = "= Heading\nSome paragraph text.\n";
        let marker = make_cursor_marker(source);
        assert!(!source.contains(&marker));
        assert!(marker.starts_with("/*tw_cursor_"));
        assert!(marker.ends_with("*/"));
    }

    #[test]
    fn parse_utf16_cursor_out_of_range_is_err() {
        let s = "abc";
        let err = parse_utf16_cursor(s, 4).expect_err("should be out of range");
        assert!(err.contains("out of range"), "unexpected message: {err}");
    }

    // ── End-to-end cursor maintenance (runs real typstyle) ──────────────

    fn fmt(source: &str, cursor_utf16: u32) -> FormatWithCursorResponse {
        format_typst_cursor_virtual(source.to_string(), cursor_utf16)
            .expect("format_typst_cursor_virtual should succeed")
    }

    fn cursor_before(source: &str, anchor: &str) -> u32 {
        let byte = source.find(anchor).expect("anchor present in source");
        byte_to_utf16_offset(source, byte) as u32
    }

    fn assert_invariants(source: &str, res: &FormatWithCursorResponse) {
        assert!(
            !res.formatted.contains("/*tw_cursor_"),
            "marker leaked into formatted output:\n{}",
            res.formatted
        );
        let units = count_utf16(&res.formatted);
        assert!(
            res.cursor as usize <= units,
            "cursor {} out of bounds ({units} utf16 units) for source {source:?}",
            res.cursor
        );
        assert!(
            utf16_to_byte_offset(&res.formatted, res.cursor as usize).is_some(),
            "cursor {} does not land on a char boundary",
            res.cursor
        );
    }

    #[test]
    fn cursor_virtual_empty_source() {
        let res = fmt("", 0);
        assert_invariants("", &res);
        assert_eq!(res.cursor, 0);
    }

    #[test]
    fn cursor_follows_sentinel_through_whitespace_reflow() {
        // typstyle collapses the runaway spaces, shifting the markup that
        // follows; the cursor (before SENTINEL) must move with it.
        let source = "#let    x    =    1\nSENTINEL tail\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[byte..].starts_with("SENTINEL"),
            "cursor should sit right before SENTINEL; got tail {:?}",
            &res.formatted[byte..]
        );
    }

    #[test]
    fn cursor_mid_identifier_in_code_formats_and_tracks() {
        // A marker spliced between `foo` and `bar` is a syntax error, so the
        // marked format fails; the command must still return the plain
        // formatting instead of surfacing "the document has syntax errors".
        let source = "#let    foobar   =   1\n";
        let cursor = cursor_before(source, "bar");
        let res = fmt(source, cursor);
        assert_invariants(source, &res);
        assert_eq!(
            res.formatted,
            format_typst_source(source.to_string()).unwrap(),
            "mid-identifier cursor must not change (or fail) the formatting"
        );
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[..byte].ends_with("foo") && res.formatted[byte..].starts_with("bar"),
            "cursor should stay between foo|bar; got {:?} | {:?}",
            &res.formatted[..byte],
            &res.formatted[byte..]
        );
    }

    #[test]
    fn word_run_start_snaps_to_run_and_sigil() {
        // Mid-identifier snaps back to the start of the run ("foobar" @ 5).
        assert_eq!(word_run_start("#let foobar = 1", 8), 5);
        // A cursor after a space is already a safe splice point.
        assert_eq!(word_run_start("ab cd", 3), 3);
        // Sigil stays glued to its word.
        assert_eq!(word_run_start("@ref", 3), 0);
    }

    #[test]
    fn map_cursor_by_affix_maps_prefix_middle_and_suffix() {
        // "a  b" → "a b": prefix "a", suffix " b" (len delta 1).
        assert_eq!(map_cursor_by_affix("a  b", "a b", 0), 0);
        assert_eq!(map_cursor_by_affix("a  b", "a b", 4), 3);
        // Middle positions clamp inside the new middle region.
        let mapped = map_cursor_by_affix("a  b", "a b", 2);
        assert!(mapped <= 3, "mapped {mapped} out of bounds");
    }

    #[test]
    fn format_source_normalizes_messy_spacing() {
        let messy = "=    Messy    Heading\n\nParagraph   with     gaps.\n";
        let once = format_typst_source(messy.to_string()).expect("format should succeed");
        assert!(!once.contains("=    Messy"), "heading spacing should be normalized");
        // typstyle is idempotent: re-formatting is a no-op.
        let twice = format_typst_source(once.clone()).expect("reformat should succeed");
        assert_eq!(once, twice, "formatting is not idempotent");
    }
}
