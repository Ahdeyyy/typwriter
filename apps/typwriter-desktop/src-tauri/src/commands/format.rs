// commands/format.rs
//
// Tauri commands for Typst source formatting via `typstyle-core`:
//   - format_typst_source         (pure text → text)
//   - format_typst_cursor_virtual (insert marker at cursor → format → find marker)
//   - format_typst_file           (read → format → write back, returns text)
//   - format_workspace_typ_files  (recursively format every .typ in the workspace)
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

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use log::{debug, error, info, warn};
use serde::Serialize;
use tauri::State;
use typstyle_core::Typstyle;

use crate::workspace::WorkspaceState;

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

/// Format a single .typ file in place. Reads from disk, formats, writes the
/// result back, and returns the formatted content so the frontend can refresh
/// any open editor view.
#[tauri::command]
pub fn format_typst_file(path: String) -> Result<String, String> {
    let t = Instant::now();
    info!("format_typst_file: path={path:?}");

    let abs = Path::new(&path);
    let content = std::fs::read_to_string(abs).map_err(|e| {
        error!("format_typst_file: read failed path={path:?} err=\"{e}\"");
        e.to_string()
    })?;

    let formatted = Typstyle::default()
        .format_text(content.clone())
        .render()
        .map_err(|e| {
            error!("format_typst_file: format failed path={path:?} err=\"{e}\"");
            e.to_string()
        })?;

    if formatted != content {
        std::fs::write(abs, formatted.as_bytes()).map_err(|e| {
            error!("format_typst_file: write failed path={path:?} err=\"{e}\"");
            e.to_string()
        })?;
    }

    info!(
        "format_typst_file: ok changed={} ({:.1}ms)",
        formatted != content,
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(formatted)
}

/// Outcome of a workspace-wide format pass.
#[derive(Serialize)]
pub struct FormatWorkspaceReport {
    /// Total .typ files discovered.
    pub total: usize,
    /// Files whose content was rewritten on disk.
    pub formatted: usize,
    /// Files left unchanged because they were already formatted.
    pub unchanged: usize,
    /// File paths that failed to format (read/parse/write error).
    pub failed: Vec<String>,
}

/// Format every .typ file under the current workspace root.
#[tauri::command]
pub fn format_workspace_typ_files(
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<FormatWorkspaceReport, String> {
    let t = Instant::now();
    info!("format_workspace_typ_files");

    let root = workspace
        .root
        .read()
        .clone()
        .ok_or_else(|| "No workspace open".to_string())?;

    let files = collect_typ_files(&root);
    let total = files.len();
    info!("format_workspace_typ_files: found {total} .typ file(s)");

    let typstyle = Typstyle::default();
    let mut formatted_count = 0usize;
    let mut unchanged = 0usize;
    let mut failed: Vec<String> = Vec::new();

    for path in files {
        let display = path.display().to_string();
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                warn!("format_workspace_typ_files: read failed path={path:?} err=\"{e}\"");
                failed.push(display);
                continue;
            }
        };

        let formatted = match typstyle.format_text(content.clone()).render() {
            Ok(out) => out,
            Err(e) => {
                warn!("format_workspace_typ_files: format failed path={path:?} err=\"{e}\"");
                failed.push(display);
                continue;
            }
        };

        if formatted == content {
            unchanged += 1;
            continue;
        }

        if let Err(e) = std::fs::write(&path, formatted.as_bytes()) {
            warn!("format_workspace_typ_files: write failed path={path:?} err=\"{e}\"");
            failed.push(display);
            continue;
        }
        formatted_count += 1;
    }

    info!(
        "format_workspace_typ_files: ok total={total} formatted={formatted_count} unchanged={unchanged} failed={} ({:.1}ms)",
        failed.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(FormatWorkspaceReport {
        total,
        formatted: formatted_count,
        unchanged,
        failed,
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
    fn marker_is_unique_against_source() {
        let source = "= Heading\nSome paragraph text.\n";
        let marker = make_cursor_marker(source);
        assert!(!source.contains(&marker));
        assert!(marker.starts_with("/*tw_cursor_"));
        assert!(marker.ends_with("*/"));
    }

    // ── Virtual strategy primitives ─────────────────────────────────

    #[test]
    fn locate_unique_handles_duplicates_and_misses() {
        assert_eq!(locate_unique("aXbXc", "X"), None);
        assert_eq!(locate_unique("aXb", "X"), Some(1));
        assert_eq!(locate_unique("abc", "X"), None);
    }

    #[test]
    fn locate_unique_at_string_boundaries() {
        assert_eq!(locate_unique("Xabc", "X"), Some(0)); // at the very start
        assert_eq!(locate_unique("abcX", "X"), Some(3)); // at the very end
        assert_eq!(locate_unique("X", "X"), Some(0)); // whole string
        assert_eq!(locate_unique("abc", "abc"), Some(0)); // needle == haystack
    }

    // ── utf16 ↔ byte conversions: edge cases ────────────────────────

    #[test]
    fn utf16_to_byte_offset_empty_string() {
        assert_eq!(utf16_to_byte_offset("", 0), Some(0));
        assert_eq!(utf16_to_byte_offset("", 1), None);
    }

    #[test]
    fn utf16_to_byte_offset_out_of_range() {
        let s = "hi";
        assert_eq!(utf16_to_byte_offset(s, 2), Some(2)); // exactly the end
        assert_eq!(utf16_to_byte_offset(s, 3), None); // one past the end
        assert_eq!(utf16_to_byte_offset(s, 999), None);
    }

    #[test]
    fn utf16_to_byte_offset_inside_surrogate_pair_rounds_forward() {
        // "🦀" is one char: 4 bytes UTF-8, 2 units UTF-16 (a surrogate pair).
        // An offset that lands *between* the surrogates rounds forward to the
        // char boundary after the crab (byte 5), never splitting the char.
        let s = "a🦀b";
        assert_eq!(utf16_to_byte_offset(s, 2), Some(5));
    }

    #[test]
    fn byte_to_utf16_offset_clamps_past_end() {
        let s = "hi";
        assert_eq!(byte_to_utf16_offset(s, 2), 2);
        assert_eq!(byte_to_utf16_offset(s, 99), 2); // clamps to the end
    }

    #[test]
    fn utf16_round_trip_mixed_multibyte_and_surrogates() {
        // ASCII, 2-byte (é), 3-byte (€), and a surrogate-pair emoji (🦀).
        let s = "a é € 🦀 b";
        let units = count_utf16(s);
        // Walk every char boundary; both directions must agree.
        for (byte_idx, _) in s.char_indices() {
            let u = byte_to_utf16_offset(s, byte_idx);
            assert_eq!(
                utf16_to_byte_offset(s, u),
                Some(byte_idx),
                "round trip failed at byte {byte_idx}"
            );
        }
        // The end is reachable too.
        assert_eq!(utf16_to_byte_offset(s, units), Some(s.len()));
    }

    #[test]
    fn count_utf16_counts_code_units_not_chars() {
        assert_eq!(count_utf16(""), 0);
        assert_eq!(count_utf16("hello"), 5);
        assert_eq!(count_utf16("é"), 1); // 2 bytes, 1 unit
        assert_eq!(count_utf16("€"), 1); // 3 bytes, 1 unit
        assert_eq!(count_utf16("🦀"), 2); // 4 bytes, surrogate pair → 2 units
    }

    // ── floor_char_boundary ─────────────────────────────────────────

    #[test]
    fn floor_char_boundary_ascii_is_identity_and_clamps() {
        let s = "hello";
        for i in 0..=s.len() {
            assert_eq!(floor_char_boundary(s, i), i);
        }
        assert_eq!(floor_char_boundary(s, 99), s.len()); // past end → len
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
    fn floor_char_boundary_rounds_down_inside_emoji() {
        // "🦀" occupies bytes 1..5.
        let s = "a🦀b";
        assert_eq!(floor_char_boundary(s, 1), 1);
        for mid in 2..=4 {
            assert_eq!(floor_char_boundary(s, mid), 1, "byte {mid} should floor to 1");
        }
        assert_eq!(floor_char_boundary(s, 5), 5);
    }

    // ── parse_utf16_cursor ──────────────────────────────────────────

    #[test]
    fn parse_utf16_cursor_ok() {
        let s = "aébc"; // é is 2 bytes
        assert_eq!(parse_utf16_cursor(s, 0), Ok(0));
        assert_eq!(parse_utf16_cursor(s, 2), Ok(3)); // after é
        assert_eq!(parse_utf16_cursor(s, 4), Ok(5)); // end of string
    }

    #[test]
    fn parse_utf16_cursor_out_of_range_is_err() {
        let s = "abc";
        let err = parse_utf16_cursor(s, 4).expect_err("should be out of range");
        assert!(err.contains("out of range"), "unexpected message: {err}");
        assert!(err.contains("utf16"), "unexpected message: {err}");
    }

    // ── make_cursor_marker against tricky sources ───────────────────

    #[test]
    fn marker_is_unique_against_multibyte_source() {
        let source = "= Café ☕\nWith a crab 🦀 and a /* real comment */.\n";
        let marker = make_cursor_marker(source);
        assert!(!source.contains(&marker));
        assert!(marker.starts_with("/*tw_cursor_"));
        assert!(marker.ends_with("*/"));
    }

    #[test]
    fn marker_avoids_an_existing_marker_like_string() {
        // Source already contains a string shaped like our marker; the
        // generated marker must still be absent from the source.
        let source = "text /*tw_cursor_0000000000000000*/ more text";
        let marker = make_cursor_marker(source);
        assert!(!source.contains(&marker));
    }

    // ── format_typst_cursor_virtual: end-to-end cursor maintenance ───
    //
    // These run real typstyle. To stay robust against typstyle's exact
    // whitespace decisions we assert *invariants* (marker never leaks, the
    // cursor stays in bounds and on a char boundary) plus anchor checks that
    // only depend on a sentinel surviving the reflow.

    /// Convenience: run the command and unwrap.
    fn fmt(source: &str, cursor_utf16: u32) -> FormatWithCursorResponse {
        format_typst_cursor_virtual(source.to_string(), cursor_utf16)
            .expect("format_typst_cursor_virtual should succeed")
    }

    /// utf16 cursor positioned at the byte where `anchor` first appears.
    fn cursor_before(source: &str, anchor: &str) -> u32 {
        let byte = source.find(anchor).expect("anchor present in source");
        byte_to_utf16_offset(source, byte) as u32
    }

    /// Assert the universal post-conditions of the command.
    fn assert_invariants(source: &str, res: &FormatWithCursorResponse) {
        let marker_prefix = "/*tw_cursor_";
        assert!(
            !res.formatted.contains(marker_prefix),
            "marker leaked into formatted output:\n{}",
            res.formatted
        );
        let units = count_utf16(&res.formatted);
        assert!(
            res.cursor as usize <= units,
            "cursor {} out of bounds (formatted has {units} utf16 units) for source {source:?}",
            res.cursor
        );
        // The reported cursor must map back to a real char boundary.
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize);
        assert!(
            byte.is_some(),
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
    fn cursor_virtual_out_of_range_cursor_errors() {
        let source = "#let x = 1\n";
        let too_big = count_utf16(source) as u32 + 5;
        let err = match format_typst_cursor_virtual(source.to_string(), too_big) {
            Ok(_) => panic!("out-of-range cursor should error"),
            Err(e) => e,
        };
        assert!(err.contains("out of range"), "unexpected message: {err}");
    }

    #[test]
    fn cursor_virtual_at_start_stays_at_start() {
        let source = "Hello world\n";
        let res = fmt(source, 0);
        assert_invariants(source, &res);
        assert_eq!(res.cursor, 0, "cursor at offset 0 should remain at 0");
    }

    #[test]
    fn cursor_virtual_at_end_stays_near_end() {
        let source = "Hello world";
        let res = fmt(source, count_utf16(source) as u32);
        assert_invariants(source, &res);
        // typstyle may append a trailing newline; the cursor should land at or
        // just before the end, never before the final word.
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[..byte].ends_with("world"),
            "cursor should follow the last word; got prefix {:?}",
            &res.formatted[..byte]
        );
    }

    #[test]
    fn cursor_follows_sentinel_through_whitespace_reflow() {
        // typstyle collapses the runaway spaces in the code line, shifting the
        // byte offset of the markup that follows. The cursor (placed right
        // before the SENTINEL word) must move with it.
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
    fn cursor_neighborhood_preserved_in_already_formatted_source() {
        // An already well-formatted document is (near) a no-op for typstyle, so
        // the cursor's neighborhood must be byte-for-byte stable.
        let source = "#let x = 1\n\nHello world\n";
        let res = fmt(source, cursor_before(source, "world"));
        assert_invariants(source, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[byte..].starts_with("world"),
            "cursor should sit right before 'world'; got tail {:?}",
            &res.formatted[byte..]
        );
    }

    #[test]
    fn cursor_follows_sentinel_past_multibyte_and_emoji() {
        // Multibyte (é, €) and a surrogate-pair emoji precede the cursor: the
        // utf16 ↔ byte conversions on both ends must stay consistent.
        let source = "Café € 🦀 SENTINEL done\n";
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
    fn cursor_inside_string_literal_returns_valid_output() {
        // The cursor sits inside a string literal, where the spliced `/* */`
        // marker is literal text rather than a comment. typstyle's handling
        // here is implementation-defined, so we only assert the invariants:
        // the function must succeed, never leak the marker, and return an
        // in-bounds, boundary-aligned cursor (the clamp fallback guarantees
        // this even when the marker can't be located).
        let source = "#let s = \"hello world\"\n";
        let cursor = cursor_before(source, "world");
        let res = fmt(source, cursor);
        assert_invariants(source, &res);
    }

    // ── Longer documents: formatting stability + cursor maintenance ──
    //
    // typstyle is idempotent: formatting already-formatted output must be a
    // no-op. `assert_idempotent` re-formats the output and asserts it's stable,
    // which is a strong correctness property that exercises the whole pipeline
    // on realistic, multi-construct documents.

    fn assert_idempotent(source: &str) {
        let once = format_typst_source(source.to_string()).expect("first format should succeed");
        let twice =
            format_typst_source(once.clone()).expect("reformatting output should succeed");
        assert_eq!(once, twice, "formatting is not idempotent for source:\n{source}");
    }

    /// A realistic mixed document: front-matter set rules, headings, prose with
    /// irregular spacing, bullet + numbered + nested lists, inline and display
    /// math, and a code definition. `SENTINEL` marks a stable cursor anchor.
    const ACADEMIC_DOC: &str = r#"#set page(margin: 1in)
#set text(font: "New Computer Modern", size: 11pt)

= Introduction

This paragraph has    some   irregular    spacing that typstyle will
normalize, and we place a SENTINEL token here to anchor the cursor.

== Background

An unordered list:
- first item
- second item
    - deeply nested item
    - another nested item
- third item

An ordered list:
+ alpha
+ beta
+ gamma

== Mathematics

The inline equation $E = m c^2$ appears mid-sentence, followed by a
display equation:

$ integral_0^1 x^2 dif x = 1 / 3 $

== Implementation

#let greet(name) = [Hello, #name!]

#greet("world")
"#;

    #[test]
    fn long_academic_document_is_idempotent() {
        assert_idempotent(ACADEMIC_DOC);
    }

    #[test]
    fn cursor_maintained_in_long_academic_document() {
        let res = fmt(ACADEMIC_DOC, cursor_before(ACADEMIC_DOC, "SENTINEL"));
        assert_invariants(ACADEMIC_DOC, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[byte..].starts_with("SENTINEL"),
            "cursor should track SENTINEL through a long document; got tail {:?}",
            &res.formatted[byte..].chars().take(20).collect::<String>()
        );
    }

    #[test]
    fn cursor_maintained_inside_nested_list_item() {
        // Anchor sits inside a deeply nested list item — a spot where typstyle
        // re-indents the surrounding structure.
        let res = fmt(ACADEMIC_DOC, cursor_before(ACADEMIC_DOC, "deeply"));
        assert_invariants(ACADEMIC_DOC, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        // typstyle re-indents the nested list and may insert a space after the
        // spliced marker, so allow intervening whitespace — the cursor must
        // still rest at the start of the same nested item, not drift away.
        let tail = &res.formatted[byte..];
        assert!(
            tail.trim_start_matches([' ', '\t']).starts_with("deeply"),
            "cursor should track the nested list item; got tail {:?}",
            &tail.chars().take(20).collect::<String>()
        );
    }

    #[test]
    fn cursor_survives_two_consecutive_format_passes() {
        // First pass on the raw (unformatted-spacing) document, then a second
        // pass on the already-formatted output. The anchor must hold both
        // times, and the second pass must leave the cursor's neighborhood
        // untouched (idempotent text).
        let first = fmt(ACADEMIC_DOC, cursor_before(ACADEMIC_DOC, "SENTINEL"));
        assert_invariants(ACADEMIC_DOC, &first);

        let second = fmt(&first.formatted, first.cursor);
        assert_invariants(&first.formatted, &second);
        let byte = utf16_to_byte_offset(&second.formatted, second.cursor as usize).unwrap();
        assert!(
            second.formatted[byte..].starts_with("SENTINEL"),
            "cursor should still track SENTINEL after a second pass; got tail {:?}",
            &second.formatted[byte..].chars().take(20).collect::<String>()
        );
        // The second pass is a no-op on the text itself.
        assert_eq!(
            first.formatted, second.formatted,
            "a second format pass should not change already-formatted text"
        );
    }

    const TABLE_DOC: &str = r#"= Results

#table(
  columns: 3,
  table.header([Name], [Score], [Rank]),
  [Alice], [95], [1],
  [Bob], [87], [2],
  [Carol], [SENTINEL], [3],
)

See the table above for the final standings.
"#;

    #[test]
    fn table_document_is_idempotent() {
        assert_idempotent(TABLE_DOC);
    }

    #[test]
    fn cursor_maintained_inside_table_cell() {
        let res = fmt(TABLE_DOC, cursor_before(TABLE_DOC, "SENTINEL"));
        assert_invariants(TABLE_DOC, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[byte..].starts_with("SENTINEL"),
            "cursor should track the table cell; got tail {:?}",
            &res.formatted[byte..].chars().take(20).collect::<String>()
        );
    }

    const CODE_HEAVY_DOC: &str = r#"#import "@preview/example:0.1.0": thing

#let fib(n) = {
  if n <= 1 {
    n
  } else {
    fib(n - 1) + fib(n - 2)
  }
}

#let data = (
  alpha: 1,
  beta: 2,
  gamma: 3,
)

The tenth Fibonacci number is #fib(10), and the SENTINEL follows.

```rust
// A raw block: typstyle must not reflow its contents.
fn main() {
    println!("hello   world");
}
```
"#;

    #[test]
    fn code_heavy_document_is_idempotent() {
        assert_idempotent(CODE_HEAVY_DOC);
    }

    #[test]
    fn cursor_maintained_in_code_heavy_document() {
        let res = fmt(CODE_HEAVY_DOC, cursor_before(CODE_HEAVY_DOC, "SENTINEL"));
        assert_invariants(CODE_HEAVY_DOC, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[byte..].starts_with("SENTINEL"),
            "cursor should track text near code blocks; got tail {:?}",
            &res.formatted[byte..].chars().take(20).collect::<String>()
        );
    }

    #[test]
    fn cursor_inside_raw_block_returns_valid_output() {
        // The cursor lands inside a fenced raw block, where the spliced marker
        // is literal text typstyle preserves verbatim. Behaviour is
        // content-dependent, so assert invariants only.
        let res = fmt(CODE_HEAVY_DOC, cursor_before(CODE_HEAVY_DOC, "hello"));
        assert_invariants(CODE_HEAVY_DOC, &res);
    }

    #[test]
    fn document_with_comments_is_idempotent() {
        let source = r#"// A leading line comment.
#set text(size: 12pt) // trailing comment

= Title /* a block comment */ here

Body paragraph with a SENTINEL anchor and /* inline */ a comment.
"#;
        assert_idempotent(source);
    }

    #[test]
    fn cursor_maintained_in_very_long_generated_document() {
        // Build a large document programmatically and place the anchor near the
        // very end, exercising long-distance utf16 ↔ byte mapping.
        let mut source = String::from("= Generated Report\n\n");
        for i in 0..300 {
            source.push_str(&format!(
                "This is paragraph number {i}, containing enough prose to make the document long.\n\n"
            ));
        }
        source.push_str("The final SENTINEL marker closes the report.\n");

        let res = fmt(&source, cursor_before(&source, "SENTINEL"));
        assert_invariants(&source, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[byte..].starts_with("SENTINEL"),
            "cursor should track SENTINEL near the end of a very long document"
        );
    }

    #[test]
    fn formatting_normalizes_then_stabilizes_messy_document() {
        // A deliberately messy document (irregular spacing, blank-line runs)
        // must format to something that is itself idempotent.
        let messy = "=    Messy    Heading\n\n\n\nParagraph   with     gaps.\n\n\n#let    x=1\n";
        let once = format_typst_source(messy.to_string()).expect("format should succeed");
        assert!(!once.contains("=    Messy"), "heading spacing should be normalized");
        assert_idempotent(&once);
    }

    // ════════════════════════════════════════════════════════════════
    // Additional coverage: more unicode helper edge cases, and cursor
    // maintenance / formatting stability across a wider set of Typst
    // constructs (math, figures, show/set rules, citations, CRLF, named
    // args, inline raw, CJK, combining marks, emoji).
    // ════════════════════════════════════════════════════════════════

    /// Assert the cursor in `res` rests right before `anchor`, allowing only
    /// the leading whitespace typstyle may insert after the spliced marker.
    fn assert_cursor_at_anchor(res: &FormatWithCursorResponse, anchor: &str) {
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize)
            .expect("cursor must land on a char boundary");
        let tail = &res.formatted[byte..];
        assert!(
            tail.trim_start_matches([' ', '\t']).starts_with(anchor),
            "cursor should rest before {anchor:?}; got tail {:?}",
            tail.chars().take(24).collect::<String>()
        );
    }

    // ── More unicode helper edge cases ──────────────────────────────

    #[test]
    fn utf16_to_byte_offset_cjk() {
        // Each CJK char is 3 bytes UTF-8 but a single UTF-16 unit.
        let s = "a日本b";
        assert_eq!(utf16_to_byte_offset(s, 0), Some(0));
        assert_eq!(utf16_to_byte_offset(s, 1), Some(1)); // after 'a'
        assert_eq!(utf16_to_byte_offset(s, 2), Some(4)); // after 日
        assert_eq!(utf16_to_byte_offset(s, 3), Some(7)); // after 本
        assert_eq!(utf16_to_byte_offset(s, 4), Some(8)); // after 'b'
        assert_eq!(utf16_to_byte_offset(s, 5), None);
    }

    #[test]
    fn byte_to_utf16_offset_cjk() {
        let s = "a日本b";
        assert_eq!(byte_to_utf16_offset(s, 0), 0);
        assert_eq!(byte_to_utf16_offset(s, 1), 1);
        assert_eq!(byte_to_utf16_offset(s, 4), 2);
        assert_eq!(byte_to_utf16_offset(s, 7), 3);
        assert_eq!(byte_to_utf16_offset(s, 8), 4);
    }

    #[test]
    fn byte_to_utf16_offset_zero_is_zero() {
        assert_eq!(byte_to_utf16_offset("", 0), 0);
        assert_eq!(byte_to_utf16_offset("anything", 0), 0);
    }

    #[test]
    fn utf16_round_trip_combining_diacritics() {
        // "e" + combining acute accent: two codepoints, each one UTF-16 unit.
        let s = "Cafe\u{0301}"; // renders as "Café" but is 5 codepoints
        assert_eq!(count_utf16(s), 5);
        for (byte_idx, _) in s.char_indices() {
            let u = byte_to_utf16_offset(s, byte_idx);
            assert_eq!(utf16_to_byte_offset(s, u), Some(byte_idx));
        }
        assert_eq!(utf16_to_byte_offset(s, 5), Some(s.len()));
    }

    #[test]
    fn utf16_to_byte_offset_multiple_emojis() {
        // Two surrogate-pair emoji: 2 UTF-16 units each.
        let s = "🦀🎉";
        assert_eq!(utf16_to_byte_offset(s, 0), Some(0));
        assert_eq!(utf16_to_byte_offset(s, 2), Some(4)); // after the crab
        assert_eq!(utf16_to_byte_offset(s, 4), Some(8)); // after the party
        // Offsets landing mid-surrogate round forward to the next boundary.
        assert_eq!(utf16_to_byte_offset(s, 1), Some(4));
        assert_eq!(utf16_to_byte_offset(s, 3), Some(8));
    }

    #[test]
    fn floor_char_boundary_inside_cjk() {
        // 日 occupies bytes 1..4.
        let s = "a日b";
        assert_eq!(floor_char_boundary(s, 1), 1);
        assert_eq!(floor_char_boundary(s, 2), 1);
        assert_eq!(floor_char_boundary(s, 3), 1);
        assert_eq!(floor_char_boundary(s, 4), 4);
    }

    #[test]
    fn floor_char_boundary_empty_string() {
        assert_eq!(floor_char_boundary("", 0), 0);
        assert_eq!(floor_char_boundary("", 5), 0);
    }

    #[test]
    fn floor_char_boundary_is_idempotent() {
        let s = "a🦀é日b";
        for i in 0..=s.len() + 3 {
            let once = floor_char_boundary(s, i);
            assert_eq!(floor_char_boundary(s, once), once, "not idempotent at {i}");
        }
    }

    #[test]
    fn count_utf16_matches_encode_utf16_len() {
        let samples = ["", "ascii", "aé€🦀日", "Cafe\u{0301}", "🎉🚀✨"];
        for s in samples {
            assert_eq!(count_utf16(s), s.encode_utf16().count());
        }
    }

    #[test]
    fn make_cursor_marker_on_empty_source() {
        let marker = make_cursor_marker("");
        assert!(marker.starts_with("/*tw_cursor_"));
        assert!(marker.ends_with("*/"));
    }

    #[test]
    fn make_cursor_marker_has_hex_body_of_expected_shape() {
        let marker = make_cursor_marker("some source");
        // "/*tw_cursor_" + 16 hex digits + "*/"
        assert_eq!(marker.len(), "/*tw_cursor_".len() + 16 + "*/".len());
        let hex = &marker["/*tw_cursor_".len()..marker.len() - "*/".len()];
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()), "non-hex body: {hex}");
    }

    #[test]
    fn locate_unique_multichar_needle() {
        assert_eq!(locate_unique("foo bar baz", "bar"), Some(4));
        assert_eq!(locate_unique("ab ab", "ab"), None); // duplicated
        assert_eq!(locate_unique("hello", "xyz"), None); // absent
    }

    #[test]
    fn parse_utf16_cursor_zero_and_exact_end() {
        let s = "héllo"; // é is 2 bytes
        assert_eq!(parse_utf16_cursor(s, 0), Ok(0));
        assert_eq!(parse_utf16_cursor(s, count_utf16(s) as u32), Ok(s.len()));
    }

    #[test]
    fn utf16_byte_round_trip_over_generated_mixed_string() {
        // A longer programmatically built string mixing every width class.
        let mut s = String::new();
        for _ in 0..50 {
            s.push_str("aé€日🦀");
        }
        for (byte_idx, _) in s.char_indices() {
            let u = byte_to_utf16_offset(&s, byte_idx);
            assert_eq!(utf16_to_byte_offset(&s, u), Some(byte_idx));
        }
    }

    // ── Math documents ──────────────────────────────────────────────

    const MATH_DOC: &str = r#"= Equations

Inline math $a^2 + b^2 = c^2$ and a SENTINEL right after it.

A display equation with a fraction and an integral:

$ f(x) = integral_(-oo)^(oo) e^(-x^2) dif x = sqrt(pi) $

Identity matrix:

$ mat(1, 0; 0, 1) $
"#;

    #[test]
    fn math_document_is_idempotent() {
        assert_idempotent(MATH_DOC);
    }

    #[test]
    fn cursor_maintained_after_inline_math() {
        let res = fmt(MATH_DOC, cursor_before(MATH_DOC, "SENTINEL"));
        assert_invariants(MATH_DOC, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    #[test]
    fn cursor_inside_display_math_returns_valid_output() {
        // Anchor inside a display equation; typstyle reflows math internals, so
        // assert invariants only.
        let res = fmt(MATH_DOC, cursor_before(MATH_DOC, "integral"));
        assert_invariants(MATH_DOC, &res);
    }

    // ── Figures, labels, references ─────────────────────────────────

    const FIGURE_DOC: &str = r#"= Figures

#figure(
  rect(width: 4cm, height: 2cm),
  caption: [A SENTINEL placeholder figure.],
) <fig:demo>

As shown in @fig:demo, the placeholder renders correctly.
"#;

    #[test]
    fn figure_document_is_idempotent() {
        assert_idempotent(FIGURE_DOC);
    }

    #[test]
    fn cursor_maintained_in_figure_caption() {
        let res = fmt(FIGURE_DOC, cursor_before(FIGURE_DOC, "SENTINEL"));
        assert_invariants(FIGURE_DOC, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    #[test]
    fn cursor_maintained_near_reference() {
        let res = fmt(FIGURE_DOC, cursor_before(FIGURE_DOC, "@fig:demo, the"));
        assert_invariants(FIGURE_DOC, &res);
        assert_cursor_at_anchor(&res, "@fig:demo");
    }

    // ── Show / set rules ────────────────────────────────────────────

    const SHOWRULE_DOC: &str = r#"#show heading: set text(navy)
#show "TODO": strong[TODO]
#set par(justify: true)

= Styled Heading

A justified paragraph that contains a SENTINEL anchor in the middle.
"#;

    #[test]
    fn show_rule_document_is_idempotent() {
        assert_idempotent(SHOWRULE_DOC);
    }

    #[test]
    fn cursor_maintained_with_show_rules() {
        let res = fmt(SHOWRULE_DOC, cursor_before(SHOWRULE_DOC, "SENTINEL"));
        assert_invariants(SHOWRULE_DOC, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    // ── Citations / bibliography ────────────────────────────────────

    const CITE_DOC: &str = r#"= Related Work

Prior work @smith2020 established the SENTINEL baseline, later extended
by others @jones2021 in a follow-up study.

#bibliography("refs.bib")
"#;

    #[test]
    fn citation_document_is_idempotent() {
        assert_idempotent(CITE_DOC);
    }

    #[test]
    fn cursor_maintained_near_citation() {
        let res = fmt(CITE_DOC, cursor_before(CITE_DOC, "SENTINEL"));
        assert_invariants(CITE_DOC, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    // ── CRLF line endings ───────────────────────────────────────────

    #[test]
    fn crlf_document_formats_successfully() {
        let source = "= Title\r\n\r\nA paragraph with a SENTINEL anchor and more text.\r\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    #[test]
    fn crlf_source_is_handled_by_pure_format() {
        let source = "#let x = 1\r\n#let y = 2\r\n\r\nBody text here.\r\n";
        // Whatever typstyle decides for line endings, the call must succeed and
        // produce a non-empty, idempotent result.
        let once = format_typst_source(source.to_string()).expect("format should succeed");
        assert!(!once.is_empty());
        assert_idempotent(&once);
    }

    // ── Named function arguments / content blocks ───────────────────

    const NAMED_ARGS_DOC: &str = r#"#let card(title: "", body) = box(
  stroke: 1pt,
  inset: 8pt,
)[
  *#title* SENTINEL #body
]

#card(title: "Hello")[Some body content goes here.]
"#;

    #[test]
    fn named_args_document_is_idempotent() {
        assert_idempotent(NAMED_ARGS_DOC);
    }

    #[test]
    fn cursor_maintained_in_content_block_with_named_args() {
        let res = fmt(NAMED_ARGS_DOC, cursor_before(NAMED_ARGS_DOC, "SENTINEL"));
        assert_invariants(NAMED_ARGS_DOC, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    // ── Inline raw, blank-line runs, headings ───────────────────────

    #[test]
    fn cursor_maintained_after_inline_raw_code() {
        let source = "Use the `format_text` function then SENTINEL to continue.\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    #[test]
    fn cursor_maintained_through_blank_line_runs() {
        // Several blank lines that typstyle collapses; the anchor sits after.
        let source = "First paragraph.\n\n\n\n\n\nSENTINEL second paragraph.\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    #[test]
    fn cursor_maintained_before_a_heading() {
        let source = "Intro paragraph.\n\n= SENTINEL Heading\n\nMore body text.\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    // ── CJK, combining marks, emoji before the cursor ───────────────

    #[test]
    fn cursor_maintained_with_cjk_text_before_it() {
        let source = "日本語のテキストです。 SENTINEL 続きの文章。\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    #[test]
    fn cursor_maintained_with_combining_diacritics_before_it() {
        // Precompose-free text: each accent is a separate combining codepoint.
        let source = "Cafe\u{0301} a\u{0300} la mode SENTINEL dessert.\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    #[test]
    fn cursor_maintained_on_emoji_heavy_line() {
        let source = "Launch day 🎉 🚀 ✨ SENTINEL 🔥 shipped.\n";
        let res = fmt(source, cursor_before(source, "SENTINEL"));
        assert_invariants(source, &res);
        assert_cursor_at_anchor(&res, "SENTINEL");
    }

    // ── Degenerate / tiny inputs ────────────────────────────────────

    #[test]
    fn whitespace_only_source_formats() {
        let source = "   \n\n   \n";
        let res = fmt(source, 0);
        assert_invariants(source, &res);
    }

    #[test]
    fn single_character_source_formats() {
        let source = "x";
        let res = fmt(source, count_utf16(source) as u32);
        assert_invariants(source, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(res.formatted[..byte].ends_with('x'));
    }

    #[test]
    fn cursor_at_end_of_multiline_document() {
        let source = "= Heading\n\nA body paragraph that ends the document here.";
        let res = fmt(source, count_utf16(source) as u32);
        assert_invariants(source, &res);
        let byte = utf16_to_byte_offset(&res.formatted, res.cursor as usize).unwrap();
        assert!(
            res.formatted[..byte].trim_end().ends_with("here."),
            "cursor should follow the final sentence; got prefix tail {:?}",
            res.formatted[..byte].chars().rev().take(12).collect::<String>()
        );
    }
}

/// Recursively collect every `.typ` file under `dir`, skipping hidden
/// directories (e.g. `.git`, `.typwriter`).
fn collect_typ_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            warn!("collect_typ_files: failed to read dir={dir:?} err=\"{err}\"");
            return files;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                warn!("collect_typ_files: skipped entry in dir={dir:?} err=\"{err}\"");
                continue;
            }
        };
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            files.extend(collect_typ_files(&path));
        } else if path.extension().and_then(|e| e.to_str()) == Some("typ") {
            files.push(path);
        }
    }
    files
}
