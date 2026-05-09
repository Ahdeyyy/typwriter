// commands/format.rs
//
// Tauri commands for Typst source formatting via `typstyle-core`:
//   - format_typst_source              (pure text → text)
//   - format_typst_cursor_virtual      (insert marker at cursor → format → find marker)
//   - format_typst_cursor_laszlo       (Laszlo retrospective: count non-ws chars before cursor)
//   - format_typst_cursor_line_column  (track (line, column-bytes) through reformatting)
//   - format_typst_file                (read → format → write back, returns text)
//   - format_workspace_typ_files       (recursively format every .typ in the workspace)
//
// Cursor maintenance lives entirely on the Rust side so positions stay in
// UTF-8 byte space until the very last step. The frontend (CodeMirror) speaks
// UTF-16 code units, so the boundary functions convert at the IPC edge.
//
// The three cursor-maintenance strategies are intentionally INDEPENDENT — none
// of them falls back to another. Each produces a definite (formatted, cursor)
// answer for any input. The frontend picks one strategy per format call.
//
// Strategy comparison:
//
// - `virtual`     : splice a unique `/*tw_cursor_<hex>*/` marker into the
//                   source at the cursor, format, and read the marker's new
//                   byte offset. Most accurate when typstyle preserves the
//                   marker in place. Degrades by clamping to the original
//                   cursor offset if the marker is missing or duplicated
//                   (e.g. cursor sat inside a string literal where `/* */`
//                   is literal text, or typstyle hoists the comment).
//
// - `laszlo`      : (Michael Laszlo, https://github.com/michaellaszlo/cursor-maintenance)
//                   count non-whitespace characters before the cursor in the
//                   old text, then walk the formatted output and place the
//                   cursor right after the Nth non-whitespace character.
//                   This naturally handles whitespace normalization — which
//                   is most of what typstyle does — including the trimmed-
//                   trailing-space case that previously sent the cursor to
//                   the top of the file. The cursor lands at the natural
//                   "same logical position" rather than chasing whitespace.
//
// - `line_column` : preserve (line index, column bytes). After formatting,
//                   look up the same line index, clamp the column to the
//                   line's new length. Cheap and intuitive when typstyle
//                   only edits within lines, but loses the cursor when
//                   content reflows across lines.

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

// ── Strategy 1 — Virtual Cursor ──────────────────────────────────────────
//
// Splice a unique block-comment marker into the source at the cursor, format
// the marked source, and read the marker's offset in the output.
//
// Trade-off: very accurate when typstyle preserves the marker in place. If
// the marker is missing or duplicated post-format — e.g. cursor sat inside a
// string literal, or typstyle moved the comment to its own line — the cursor
// is clamped to the original byte offset (no fallback to other strategies).
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

    let raw = Typstyle::default().format_text(marked).render().map_err(|e| {
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
    Ok(FormatWithCursorResponse { formatted, cursor: new_cursor })
}

// ── Strategy 1 Debug — Virtual Cursor with marker left in ────────────────
//
// Same as `format_typst_cursor_virtual` but the marker is NOT stripped from
// the returned `formatted_with_marker` field, so the caller can see exactly
// where the cursor ended up in the formatted text. Used only for debugging.
#[derive(Serialize)]
pub struct VirtualDebugResponse {
    /// Formatted text with the cursor marker still embedded.
    pub formatted_with_marker: String,
    /// Formatted text with the marker stripped — same as the regular command.
    pub formatted: String,
    /// New cursor offset (UTF-16), matching the regular virtual strategy.
    pub cursor: u32,
    /// The exact marker string that was spliced in (for grep/highlight).
    pub marker: String,
    /// true if the marker survived formatting exactly once.
    pub marker_found: bool,
    /// Byte offset of the marker in the pre-format marked source.
    pub marker_byte_before: u32,
    /// UTF-16 offset of the marker in the pre-format marked source.
    pub marker_utf16_before: u32,
    /// Line (0-based) of the marker in the pre-format marked source.
    pub marker_line_before: u32,
    /// Column bytes (0-based) of the marker in the pre-format marked source.
    pub marker_col_before: u32,
    /// Byte offset of the marker in the post-format raw output (u32::MAX if not found uniquely).
    pub marker_byte_after: u32,
    /// UTF-16 offset of the marker in the post-format raw output (u32::MAX if not found uniquely).
    pub marker_utf16_after: u32,
    /// Line (0-based) of the marker in the post-format raw output (u32::MAX if not found uniquely).
    pub marker_line_after: u32,
    /// Column bytes (0-based) of the marker in the post-format raw output (u32::MAX if not found uniquely).
    pub marker_col_after: u32,
}

/// Return `(line, col_bytes)` — both 0-based — for a byte offset in `text`.
fn byte_to_line_col(text: &str, byte_offset: usize) -> (usize, usize) {
    let clamped = byte_offset.min(text.len());
    let before = &text[..clamped];
    let line = before.bytes().filter(|&b| b == b'\n').count();
    let col = before.rfind('\n').map(|i| clamped - (i + 1)).unwrap_or(clamped);
    (line, col)
}

#[tauri::command]
pub fn format_typst_cursor_virtual_debug(
    source: String,
    cursor: u32,
) -> Result<VirtualDebugResponse, String> {
    let t = Instant::now();
    let byte_cursor = parse_utf16_cursor(&source, cursor)?;

    let marker = make_cursor_marker(&source);

    // ── Before formatting: marker sits at byte_cursor in the marked source ──
    let marked = {
        let mut buf = String::with_capacity(source.len() + marker.len());
        buf.push_str(&source[..byte_cursor]);
        buf.push_str(&marker);
        buf.push_str(&source[byte_cursor..]);
        buf
    };
    // The marker starts at byte_cursor in `marked`.
    let marker_byte_before = byte_cursor;
    let marker_utf16_before = byte_to_utf16_offset(&marked, marker_byte_before);
    let (marker_line_before, marker_col_before) = byte_to_line_col(&marked, marker_byte_before);

    // Context around insertion point in the marked source.
    let ctx_start = marker_byte_before.saturating_sub(40);
    let ctx_end = (marker_byte_before + marker.len() + 40).min(marked.len());
    debug!(
        "virtual_debug BEFORE: byte={marker_byte_before} utf16={marker_utf16_before} \
         line={marker_line_before} col={marker_col_before}\n  context: {:?}",
        &marked[ctx_start..ctx_end]
    );

    // ── Format ──────────────────────────────────────────────────────────────
    let raw = Typstyle::default().format_text(marked).render().map_err(|e| {
        error!("virtual_debug: format err=\"{e}\"");
        e.to_string()
    })?;

    // ── After formatting: locate marker in raw output ────────────────────────
    let marker_count = raw.matches(&marker).count();
    let (formatted_with_marker, formatted, new_byte_cursor, marker_found,
         marker_byte_after, marker_utf16_after, marker_line_after, marker_col_after) =
        match locate_unique(&raw, &marker) {
            Some(idx) => {
                let utf16_after = byte_to_utf16_offset(&raw, idx);
                let (line_after, col_after) = byte_to_line_col(&raw, idx);
                let ctx_start = idx.saturating_sub(40);
                let ctx_end = (idx + marker.len() + 40).min(raw.len());
                debug!(
                    "virtual_debug AFTER (found): byte={idx} utf16={utf16_after} \
                     line={line_after} col={col_after}\n  context: {:?}",
                    &raw[ctx_start..ctx_end]
                );
                let mut stripped = String::with_capacity(raw.len() - marker.len());
                stripped.push_str(&raw[..idx]);
                stripped.push_str(&raw[idx + marker.len()..]);
                (raw, stripped, idx, true, idx, utf16_after, line_after, col_after)
            }
            None => {
                warn!(
                    "virtual_debug AFTER (lost): marker_count={marker_count}; \
                     clamping cursor to byte_cursor={byte_cursor}"
                );
                let stripped = raw.replace(&marker, "");
                let clamp = floor_char_boundary(&stripped, byte_cursor.min(stripped.len()));
                (raw, stripped, clamp, false,
                 u32::MAX as usize, u32::MAX as usize, u32::MAX as usize, u32::MAX as usize)
            }
        };

    let new_cursor = byte_to_utf16_offset(&formatted, new_byte_cursor) as u32;
    debug!(
        "virtual_debug RESULT: cursor_utf16={new_cursor} marker_found={marker_found} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(VirtualDebugResponse {
        formatted_with_marker,
        formatted,
        cursor: new_cursor,
        marker,
        marker_found,
        marker_byte_before: marker_byte_before as u32,
        marker_utf16_before: marker_utf16_before as u32,
        marker_line_before: marker_line_before as u32,
        marker_col_before: marker_col_before as u32,
        marker_byte_after: marker_byte_after as u32,
        marker_utf16_after: marker_utf16_after as u32,
        marker_line_after: marker_line_after as u32,
        marker_col_after: marker_col_after as u32,
    })
}

// ── Strategy 2 — Laszlo Retrospective ────────────────────────────────────
//
// Count the non-whitespace characters that precede the cursor in the old
// text. After formatting, walk the new text and place the cursor immediately
// after the Nth non-whitespace character.
//
// This is the strategy that fixes the "trailing-space-at-end-of-line jumps to
// top of file" bug: whitespace doesn't count, so trimming trailing spaces on
// the cursor's line never affects the count of non-ws chars before the
// cursor — the new cursor lands at end-of-content on the same logical line.
//
// See https://github.com/michaellaszlo/cursor-maintenance for the original
// formulation. We use a single-category count (non-whitespace) which is a
// good fit for a code formatter that mostly normalizes whitespace.
#[tauri::command]
pub fn format_typst_cursor_laszlo(
    source: String,
    cursor: u32,
) -> Result<FormatWithCursorResponse, String> {
    let t = Instant::now();

    let source_utf16_len = count_utf16(&source);
    debug!(
        "laszlo[1/6] input: cursor_utf16={cursor} source_bytes={} source_utf16={source_utf16_len}",
        source.len()
    );

    let byte_cursor = parse_utf16_cursor(&source, cursor)?;
    debug!("laszlo[2/6] cursor converted: byte_cursor={byte_cursor}");

    // Show up to 60 chars of context around the cursor in the original source.
    let ctx_start = byte_cursor.saturating_sub(30);
    let ctx_end = (byte_cursor + 30).min(source.len());
    let before_ctx = &source[ctx_start..byte_cursor];
    let after_ctx = &source[byte_cursor..ctx_end];
    debug!("laszlo[2/6] source context: ...{before_ctx:?}|{after_ctx:?}...");

    let target_count = count_non_ws(&source[..byte_cursor]);
    debug!(
        "laszlo[3/6] non-ws before cursor: target_count={target_count} (total non-ws in source={})",
        count_non_ws(&source)
    );

    let formatted = Typstyle::default().format_text(source.clone()).render().map_err(|e| {
        error!("laszlo: format err=\"{e}\"");
        e.to_string()
    })?;
    debug!(
        "laszlo[4/6] formatted: bytes={} utf16={} changed={}",
        formatted.len(),
        count_utf16(&formatted),
        formatted != source
    );

    let new_byte_cursor = laszlo_locate(&formatted, target_count);
    debug!("laszlo[5/6] laszlo_locate: new_byte_cursor={new_byte_cursor}");

    // Show context around the new cursor in the formatted output.
    let fctx_start = new_byte_cursor.saturating_sub(30);
    let fctx_end = (new_byte_cursor + 30).min(formatted.len());
    let fbefore = &formatted[fctx_start..new_byte_cursor];
    let fafter = &formatted[new_byte_cursor..fctx_end];
    debug!("laszlo[5/6] formatted context: ...{fbefore:?}|{fafter:?}...");

    let new_cursor = byte_to_utf16_offset(&formatted, new_byte_cursor) as u32;
    debug!(
        "laszlo[6/6] done: new_cursor_utf16={new_cursor} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(FormatWithCursorResponse { formatted, cursor: new_cursor })
}

// ── Strategy 3 — Line / Column ───────────────────────────────────────────
//
// Track the cursor's (line index, column bytes) in the old text. After
// formatting, look up the same line index in the new text and clamp the
// column to that line's new length. If the line index no longer exists,
// fall back to the last line.
//
// Cheap and intuitive when typstyle's edits stay within lines; loses the
// cursor when content reflows across line boundaries.
#[tauri::command]
pub fn format_typst_cursor_line_column(
    source: String,
    cursor: u32,
) -> Result<FormatWithCursorResponse, String> {
    let t = Instant::now();
    let byte_cursor = parse_utf16_cursor(&source, cursor)?;

    let formatted = Typstyle::default().format_text(source.clone()).render().map_err(|e| {
        error!("format_typst_cursor_line_column: format err=\"{e}\"");
        e.to_string()
    })?;

    let line_start = source[..byte_cursor].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line_idx = source[..byte_cursor].bytes().filter(|&b| b == b'\n').count();
    let column = byte_cursor - line_start;

    let (new_start, new_end) = nth_line_range(&formatted, line_idx);
    let new_column = column.min(new_end - new_start);
    let new_byte_cursor = floor_char_boundary(&formatted, new_start + new_column);

    let new_cursor = byte_to_utf16_offset(&formatted, new_byte_cursor) as u32;
    debug!(
        "format_typst_cursor_line_column: ok line={line_idx} column={column} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(FormatWithCursorResponse { formatted, cursor: new_cursor })
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
    if count == utf16 { Some(s.len()) } else { None }
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
    if first == last { Some(first) } else { None }
}

// ── Laszlo-strategy helpers ───────────────────────────────────────────────

/// Count non-whitespace Unicode characters in `s`. Whitespace is whatever
/// `char::is_whitespace` says — a superset of ASCII whitespace, matching
/// what typstyle considers "noise" between tokens.
fn count_non_ws(s: &str) -> usize {
    s.chars().filter(|c| !c.is_whitespace()).count()
}

/// Walk `text` and return the byte offset immediately AFTER the
/// `target_count`-th non-whitespace character. If `target_count == 0`,
/// the cursor was before any non-whitespace content — return 0 so it stays
/// at the top. If the new text has fewer non-ws characters than the target
/// (typstyle deleted some), return `text.len()` (clamp to end).
fn laszlo_locate(text: &str, target_count: usize) -> usize {
    if target_count == 0 {
        return 0;
    }
    let mut count = 0usize;
    for (byte_idx, ch) in text.char_indices() {
        if !ch.is_whitespace() {
            count += 1;
            if count == target_count {
                return byte_idx + ch.len_utf8();
            }
        }
    }
    text.len()
}

// ── Line/column-strategy helpers ──────────────────────────────────────────

/// Return the byte range `(start, end)` of the `n`-th line (0-indexed) in
/// `text`. If `n` is past the last line, returns the last line's range.
/// `end` is the byte offset of the line-terminating `\n` (or `text.len()`
/// for the final line) — i.e. the line content excludes its trailing `\n`.
fn nth_line_range(text: &str, n: usize) -> (usize, usize) {
    let bytes = text.as_bytes();
    let mut current = 0usize;
    let mut start = 0usize;
    for i in 0..bytes.len() {
        if bytes[i] == b'\n' {
            if current == n {
                return (start, i);
            }
            current += 1;
            start = i + 1;
        }
    }
    (start, bytes.len())
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

    // ── Laszlo strategy ──────────────────────────────────────────────

    #[test]
    fn laszlo_trailing_space_at_eol_does_not_jump_to_top() {
        // The bug: cursor right after a trailing space at end of line, the
        // formatter trims the trailing space, and the cursor incorrectly
        // jumps to the top of the file.
        // Old: "hello \nworld\n", cursor at 6 (after the trailing space).
        // After format trims the trailing space: "hello\nworld\n".
        // Non-ws chars before cursor in old: 5 (h,e,l,l,o).
        // 5th non-ws char in new is 'o' at byte 4; cursor lands at 5
        // (end of "hello", same logical position — NOT byte 0).
        let formatted = "hello\nworld\n";
        let target = count_non_ws("hello "); // 5
        assert_eq!(target, 5);
        assert_eq!(laszlo_locate(formatted, target), 5);
    }

    #[test]
    fn laszlo_trailing_space_at_end_of_only_line() {
        // No trailing newline. Old: "foo ", cursor at 4. Format → "foo".
        let target = count_non_ws("foo "); // 3
        assert_eq!(laszlo_locate("foo", target), 3);
    }

    #[test]
    fn laszlo_cursor_in_middle_of_word() {
        // Old: "hello world", cursor at 7 (between "wo" and "rld").
        // Non-ws before: h,e,l,l,o,w,o = 7. Format unchanged → cursor at 7.
        assert_eq!(laszlo_locate("hello world", count_non_ws("hello w")), 7);
    }

    #[test]
    fn laszlo_cursor_in_leading_whitespace() {
        // target_count == 0 → cursor stays at byte 0.
        assert_eq!(laszlo_locate("  hello", 0), 0);
        assert_eq!(laszlo_locate("hello", 0), 0);
        assert_eq!(laszlo_locate("", 0), 0);
    }

    #[test]
    fn laszlo_target_unreachable_clamps_to_end() {
        // Formatter deleted some non-ws chars; cursor falls off the end.
        assert_eq!(laszlo_locate("foo", 10), 3);
    }

    #[test]
    fn laszlo_collapses_internal_whitespace() {
        // Old: "hello   world", cursor at 13 (end). Non-ws: 10.
        // New (typstyle collapses): "hello world".
        // 10th non-ws is 'd' at byte 10; cursor at 11 (end of "hello world").
        assert_eq!(laszlo_locate("hello world", count_non_ws("hello   world")), 11);
    }

    // ── Line/column strategy ────────────────────────────────────────

    #[test]
    fn line_column_clamps_to_line_end() {
        // Old line 1 is "foo " (column 4). New line 1 is "foo" (length 3).
        // Cursor clamps to column 3 — end of "foo".
        let formatted = "hello\nfoo\nbar\n";
        let (start, end) = nth_line_range(formatted, 1);
        assert_eq!((start, end), (6, 9));
        assert_eq!(end - start, 3);
    }

    #[test]
    fn line_column_handles_missing_line() {
        // n past last line returns the final line range (last char of file).
        let (start, end) = nth_line_range("hello\nworld", 5);
        assert_eq!(start, 6);
        assert_eq!(end, 11);
    }

    #[test]
    fn line_column_no_trailing_newline() {
        let (start, end) = nth_line_range("foo", 0);
        assert_eq!((start, end), (0, 3));
    }

    // ── Virtual strategy primitives ─────────────────────────────────

    #[test]
    fn locate_unique_handles_duplicates_and_misses() {
        assert_eq!(locate_unique("aXbXc", "X"), None);
        assert_eq!(locate_unique("aXb", "X"), Some(1));
        assert_eq!(locate_unique("abc", "X"), None);
    }
}

/// Recursively collect every `.typ` file under `dir`, skipping hidden
/// directories (e.g. `.git`, `.typwriter`).
fn collect_typ_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return files;
    };
    for entry in entries.flatten() {
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
