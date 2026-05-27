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
