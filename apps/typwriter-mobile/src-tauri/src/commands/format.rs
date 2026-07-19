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
// Splice a unique `/*tw_cursor_<hex>*/` block-comment marker into the source
// at the cursor, format, and read the marker's new byte offset. Most accurate
// when typstyle preserves the marker in place. Degrades by clamping to the
// original byte offset if the marker is missing or duplicated post-format
// (e.g. cursor sat inside a string literal where `/* */` is literal text, or
// typstyle hoists the comment).

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
// Splice a unique block-comment marker into the source at the cursor, format
// the marked source, and read the marker's offset in the output.
//
// Trade-off: very accurate when typstyle preserves the marker in place. If
// the marker is missing or duplicated post-format — e.g. cursor sat inside a
// string literal, or typstyle moved the comment to its own line — the cursor
// is clamped to the original byte offset.
#[tauri::command]
pub fn format_typst_cursor_virtual(
    source: String,
    cursor: u32,
) -> Result<FormatWithCursorResponse, String> {
    let t = Instant::now();
    let byte_cursor = parse_utf16_cursor(&source, cursor)?;

    let marker = make_cursor_marker(&source);
    let marked = {
        let mut buf = String::with_capacity(source.len() + marker.len());
        buf.push_str(&source[..byte_cursor]);
        buf.push_str(&marker);
        buf.push_str(&source[byte_cursor..]);
        buf
    };

    let raw = Typstyle::default()
        .format_text(marked)
        .render()
        .map_err(|e| {
            error!("format_typst_cursor_virtual: format err=\"{e}\"");
            e.to_string()
        })?;

    let (formatted, new_byte_cursor) = match locate_unique(&raw, &marker) {
        Some(idx) => {
            let mut out = String::with_capacity(raw.len() - marker.len());
            out.push_str(&raw[..idx]);
            out.push_str(&raw[idx + marker.len()..]);
            (out, idx)
        }
        None => {
            // Marker missing or duplicated — strip every occurrence and
            // clamp the cursor to its original byte offset. No delegation
            // to another strategy.
            let stripped = raw.replace(&marker, "");
            let clamp = floor_char_boundary(&stripped, byte_cursor.min(stripped.len()));
            warn!(
                "format_typst_cursor_virtual: marker not unique in output (count={}); clamping cursor",
                raw.matches(&marker).count()
            );
            (stripped, clamp)
        }
    };

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
    fn format_source_normalizes_messy_spacing() {
        let messy = "=    Messy    Heading\n\nParagraph   with     gaps.\n";
        let once = format_typst_source(messy.to_string()).expect("format should succeed");
        assert!(!once.contains("=    Messy"), "heading spacing should be normalized");
        // typstyle is idempotent: re-formatting is a no-op.
        let twice = format_typst_source(once.clone()).expect("reformat should succeed");
        assert_eq!(once, twice, "formatting is not idempotent");
    }
}
