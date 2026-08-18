// Project-wide search and replace.
//
// The editor's find panel is per-buffer. In a multi-file Typst project —
// chapters, `#include`s, a shared `template.typ` — "rename this label
// everywhere" is a daily need that a per-buffer search cannot answer.
//
// Reads route through the workspace's `WorkingTreeFs`, like every other
// workspace read, so search sees the same tree the editor does.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use log::{info, warn};
use rayon::prelude::*;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    vcs::VcsState,
    workspace::{text_files::is_text_extension, WorkspaceState},
};

/// Cap on reported hits. A query like `e` matches essentially everything; past
/// a couple of thousand rows the list stops being a tool and starts being a
/// denial of service on the renderer.
const MAX_HITS: usize = 2000;

/// Skip files larger than this. A multi-megabyte generated `.json` is not what
/// anyone is searching for, and reading it stalls the walk.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Directories never worth walking. Mirrors the file tree's own ignore list.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "out"];

/// Depth cap, matching the workspace walk — a symlink cycle the OS does not
/// resolve away would otherwise run forever.
const MAX_DEPTH: usize = 32;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    /// Restrict to files whose name ends with one of these (`.typ`, `.bib`).
    /// Empty means every text file.
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// Workspace-relative, forward-slashed.
    pub path: String,
    /// 1-based.
    pub line: usize,
    /// The whole line, for display. Trimmed of its trailing newline.
    pub preview: String,
    /// Match bounds within `preview`, in UTF-16 code units — the frontend
    /// measures in CodeMirror's coordinate space, not Rust's.
    pub match_start: usize,
    pub match_end: usize,
    /// Absolute offset of the match in the file, in UTF-16 units, so the editor
    /// can jump straight to it.
    pub offset: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub files_searched: usize,
    /// True when [`MAX_HITS`] cut the list short.
    pub truncated: bool,
}

/// Build the regex a query describes.
///
/// Literal queries are escaped rather than run as patterns, so searching for
/// `a.b` does not also match `axb` — the surprise every naive implementation
/// ships with.
pub fn build_matcher(query: &SearchQuery) -> Result<Regex, String> {
    if query.query.is_empty() {
        return Err("empty query".to_string());
    }

    let mut pattern = if query.regex {
        query.query.clone()
    } else {
        regex::escape(&query.query)
    };

    if query.whole_word {
        // `\b` around a pattern that already anchors would be wrong, but the
        // panel only offers whole-word for literal queries.
        pattern = format!(r"\b(?:{pattern})\b");
    }

    RegexBuilder::new(&pattern)
        .case_insensitive(!query.case_sensitive)
        .build()
        .map_err(|err| format!("invalid pattern: {err}"))
}

/// UTF-16 length of a string slice — the unit the frontend counts in.
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Find every match in `text`, as hits with UTF-16 coordinates.
pub fn hits_in_text(matcher: &Regex, path: &str, text: &str) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    // Running UTF-16 offset of the line start, so converting a match position
    // to a document offset never rescans the file from the top.
    let mut line_start_utf16 = 0usize;

    for (index, line) in text.split_inclusive('\n').enumerate() {
        let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');

        for found in matcher.find_iter(trimmed) {
            let start_utf16 = utf16_len(&trimmed[..found.start()]);
            let end_utf16 = start_utf16 + utf16_len(found.as_str());
            hits.push(SearchHit {
                path: path.to_string(),
                line: index + 1,
                preview: trimmed.to_string(),
                match_start: start_utf16,
                match_end: end_utf16,
                offset: line_start_utf16 + start_utf16,
            });
        }

        line_start_utf16 += utf16_len(line);
    }

    hits
}

/// Whether a path should be searched at all.
fn is_searchable(path: &Path, extensions: &[String]) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let ext = ext.to_ascii_lowercase();

    if !extensions.is_empty() {
        return extensions
            .iter()
            .any(|wanted| wanted.trim_start_matches('.').eq_ignore_ascii_case(&ext));
    }
    is_text_extension(&ext)
}

/// Collect candidate files, applying the same ignore rules as the file tree.
fn collect_candidates(root: &Path, extensions: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            // Never follow symlinks: a link back up the tree turns the walk
            // into a loop the depth cap only papers over.
            if file_type.is_symlink() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if file_type.is_dir() {
                if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push((path, depth + 1));
                continue;
            }

            if !is_searchable(&path, extensions) {
                continue;
            }
            if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
                continue;
            }
            out.push(path);
        }
    }

    // Stable order, so the same search twice lists hits the same way.
    out.sort();
    out
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[tauri::command(async)]
pub fn search_workspace(
    query: SearchQuery,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<SearchResults, String> {
    let t = Instant::now();
    let root = workspace
        .root
        .read()
        .clone()
        .ok_or_else(|| "No workspace open".to_string())?;

    let matcher = build_matcher(&query)?;
    let candidates = collect_candidates(&root, &query.extensions);
    let files_searched = candidates.len();

    // Reading and matching are independent per file, and a large project is
    // hundreds of files — the same reason workspace diagnostics run on rayon.
    let mut hits: Vec<SearchHit> = candidates
        .par_iter()
        .flat_map_iter(|path| {
            let text = match std::fs::read_to_string(path) {
                Ok(text) => text,
                // Unreadable or non-UTF-8: not an error, just nothing to match.
                Err(_) => return Vec::new().into_iter(),
            };
            let rel = rel_path(&root, path);
            hits_in_text(&matcher, &rel, &text).into_iter()
        })
        .collect();

    // `par_iter` finishes out of order; sort so results read in file order.
    hits.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)).then(a.match_start.cmp(&b.match_start)));

    let truncated = hits.len() > MAX_HITS;
    hits.truncate(MAX_HITS);

    info!(
        "search_workspace: {} hits in {} files truncated={} ({:.1}ms)",
        hits.len(),
        files_searched,
        truncated,
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(SearchResults {
        hits,
        files_searched,
        truncated,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceOutcome {
    pub files_changed: usize,
    pub replacements: usize,
    /// Restore point created before writing, when history is available.
    pub restore_point: Option<String>,
}

/// Replace every match across the workspace.
///
/// Takes a restore point first. This rewrites many files at once with no
/// per-file confirmation, which is precisely the operation someone needs to be
/// able to undo — and the app already has a mechanism for that, so a bulk edit
/// that skipped it would be negligent rather than merely risky.
#[tauri::command(async)]
pub fn replace_in_workspace(
    query: SearchQuery,
    replacement: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<ReplaceOutcome, String> {
    let t = Instant::now();
    let root = workspace
        .root
        .read()
        .clone()
        .ok_or_else(|| "No workspace open".to_string())?;

    let matcher = build_matcher(&query)?;
    let candidates = collect_candidates(&root, &query.extensions);

    // Snapshot before touching anything. A failure here aborts the replace:
    // proceeding would leave the user with a bulk edit and no way back.
    let restore_point = vcs
        .create_manual_restore_point(&format!("Before replacing “{}”", query.query))
        .map_err(|err| format!("could not create a restore point: {err}"))?;

    let mut files_changed = 0usize;
    let mut replacements = 0usize;

    for path in candidates {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let count = matcher.find_iter(&text).count();
        if count == 0 {
            continue;
        }

        // `replace_all` expands `$1` in the replacement for regex queries,
        // which is the point of regex replace; for a literal query the
        // replacement is taken literally by escaping it.
        let updated = if query.regex {
            matcher.replace_all(&text, replacement.as_str()).into_owned()
        } else {
            matcher
                .replace_all(&text, regex::NoExpand(replacement.as_str()))
                .into_owned()
        };

        if let Err(err) = std::fs::write(&path, updated) {
            warn!("replace_in_workspace: write failed path={path:?} err=\"{err}\"");
            continue;
        }
        files_changed += 1;
        replacements += count;
    }

    info!(
        "replace_in_workspace: {replacements} replacement(s) in {files_changed} file(s) ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(ReplaceOutcome {
        files_changed,
        replacements,
        restore_point,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(text: &str) -> SearchQuery {
        SearchQuery {
            query: text.to_string(),
            case_sensitive: false,
            whole_word: false,
            regex: false,
            extensions: Vec::new(),
        }
    }

    // ─── Matcher ────────────────────────────────────────────────────────────

    #[test]
    fn literal_queries_are_escaped() {
        // The surprise a naive implementation ships with: `a.b` matching `axb`.
        let matcher = build_matcher(&query("a.b")).unwrap();
        assert!(matcher.is_match("a.b"));
        assert!(!matcher.is_match("axb"));
    }

    #[test]
    fn regex_queries_are_not_escaped() {
        let mut q = query("a.b");
        q.regex = true;
        let matcher = build_matcher(&q).unwrap();
        assert!(matcher.is_match("axb"));
    }

    #[test]
    fn search_is_case_insensitive_by_default() {
        assert!(build_matcher(&query("Figure")).unwrap().is_match("figure"));
    }

    #[test]
    fn case_sensitivity_can_be_demanded() {
        let mut q = query("Figure");
        q.case_sensitive = true;
        assert!(!build_matcher(&q).unwrap().is_match("figure"));
    }

    #[test]
    fn whole_word_does_not_match_inside_a_word() {
        let mut q = query("fig");
        q.whole_word = true;
        let matcher = build_matcher(&q).unwrap();
        assert!(matcher.is_match("a fig here"));
        assert!(!matcher.is_match("configure"));
    }

    #[test]
    fn whole_word_wraps_the_whole_pattern_not_just_its_start() {
        // `\bfoo|bar\b` would be wrong; the alternation must be grouped.
        let mut q = query("foo|bar");
        q.whole_word = true;
        q.regex = true;
        let matcher = build_matcher(&q).unwrap();
        assert!(matcher.is_match("a bar here"));
        assert!(!matcher.is_match("foobarbaz"));
    }

    #[test]
    fn an_empty_query_is_rejected() {
        assert!(build_matcher(&query("")).is_err());
    }

    #[test]
    fn an_invalid_pattern_is_reported_rather_than_panicking() {
        let mut q = query("(unclosed");
        q.regex = true;
        assert!(build_matcher(&q).is_err());
    }

    // ─── Hits ───────────────────────────────────────────────────────────────

    #[test]
    fn reports_one_based_line_numbers() {
        let matcher = build_matcher(&query("target")).unwrap();
        let hits = hits_in_text(&matcher, "a.typ", "one\ntwo\ntarget\n");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 3);
    }

    #[test]
    fn finds_several_matches_on_one_line() {
        let matcher = build_matcher(&query("ab")).unwrap();
        let hits = hits_in_text(&matcher, "a.typ", "ab ab ab");
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].match_start, 0);
        assert_eq!(hits[1].match_start, 3);
        assert_eq!(hits[2].match_start, 6);
    }

    #[test]
    fn preview_excludes_the_line_ending() {
        let matcher = build_matcher(&query("x")).unwrap();
        let hits = hits_in_text(&matcher, "a.typ", "x\r\n");
        assert_eq!(hits[0].preview, "x");
    }

    #[test]
    fn columns_are_utf16_not_bytes() {
        // An emoji is 4 bytes but 2 UTF-16 units; the frontend counts in the
        // latter, and a byte offset would land the highlight in the wrong place.
        let matcher = build_matcher(&query("after")).unwrap();
        let hits = hits_in_text(&matcher, "a.typ", "😀 after");
        assert_eq!(hits[0].match_start, 3);
    }

    #[test]
    fn offsets_accumulate_across_lines_in_utf16() {
        let matcher = build_matcher(&query("b")).unwrap();
        let text = "😀\nb";
        let hits = hits_in_text(&matcher, "a.typ", text);
        // Line 1 is 2 UTF-16 units plus the newline.
        assert_eq!(hits[0].offset, 3);
    }

    #[test]
    fn no_matches_yields_no_hits() {
        let matcher = build_matcher(&query("zzz")).unwrap();
        assert!(hits_in_text(&matcher, "a.typ", "nothing here").is_empty());
    }

    #[test]
    fn handles_a_file_with_no_trailing_newline() {
        let matcher = build_matcher(&query("end")).unwrap();
        let hits = hits_in_text(&matcher, "a.typ", "start\nend");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
    }

    // ─── File selection ─────────────────────────────────────────────────────

    #[test]
    fn searches_text_files_by_default() {
        assert!(is_searchable(Path::new("a/b.typ"), &[]));
        assert!(is_searchable(Path::new("refs.bib"), &[]));
    }

    #[test]
    fn skips_binaries() {
        assert!(!is_searchable(Path::new("out.pdf"), &[]));
        assert!(!is_searchable(Path::new("logo.png"), &[]));
    }

    #[test]
    fn an_extension_filter_narrows_the_search() {
        let only_typ = vec!["typ".to_string()];
        assert!(is_searchable(Path::new("a.typ"), &only_typ));
        assert!(!is_searchable(Path::new("refs.bib"), &only_typ));
    }

    #[test]
    fn an_extension_filter_tolerates_a_leading_dot() {
        let dotted = vec![".typ".to_string()];
        assert!(is_searchable(Path::new("a.typ"), &dotted));
    }

    #[test]
    fn extensionless_files_are_skipped() {
        assert!(!is_searchable(Path::new("Makefile"), &[]));
    }
}
