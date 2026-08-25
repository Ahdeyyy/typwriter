//! Bibliography parsing for citation completions.
//!
//! Typst reads BibTeX (`.bib`) and Hayagriva YAML (`.yml`/`.yaml`) files, and
//! `@key` resolves against whatever those files contain. Parsing happens here
//! — with the very library the compiler uses (`hayagriva`, pinned through
//! typst) — rather than in a hand-rolled frontend reader, so a file the
//! compiler accepts is exactly a file completions can serve. A file that
//! fails to parse returns an error; it simply contributes no keys.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use hayagriva::io::{from_biblatex_str, from_yaml_str};
use hayagriva::types::Person;
use log::info;
use serde::Serialize;
use tauri::State;

use crate::workspace::WorkspaceState;
use crate::vcs::VcsState;

/// One citation target: what `@key` has to match, plus the few fields worth
/// showing in a completion row.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibEntryDto {
    pub key: String,
    /// Lowercased entry type: `book`, `article`, …
    pub entry_type: String,
    pub title: Option<String>,
    /// `"Last, First and Last2, First2"` — the shape the frontend's
    /// author-abbreviating display code already understands.
    pub author: Option<String>,
    pub year: Option<String>,
}

/// "van der Berg, Jan" style composition: family name first (with its
/// prefix), given name after the comma — the order BiBTeX established and
/// the frontend's abbreviation logic expects.
fn format_person(person: &Person) -> String {
    let family = match &person.prefix {
        Some(prefix) => format!("{prefix} {}", person.name),
        None => person.name.clone(),
    };
    match &person.given_name {
        Some(given) => format!("{family}, {given}"),
        None => family,
    }
}

fn map_entry(entry: &hayagriva::Entry) -> BibEntryDto {
    let entry_type = format!("{:?}", entry.entry_type()).to_ascii_lowercase();
    let title = entry.title().map(|title| title.to_string());
    let author = entry.authors().map(|authors| {
        authors
            .iter()
            .map(format_person)
            .collect::<Vec<_>>()
            .join(" and ")
    });
    let year = entry.date_any().map(|date| date.year.to_string());

    BibEntryDto {
        key: entry.key().to_string(),
        entry_type,
        title,
        author,
        year,
    }
}

/// Decode `content` as a bibliography. Unknown extensions are sniffed in the
/// same order typst-library uses: Hayagriva YAML first, then BibLaTeX.
pub fn parse_content(ext: &str, content: &str) -> Result<Vec<BibEntryDto>, String> {
    let collect =
        |lib: hayagriva::Library| -> Vec<BibEntryDto> { lib.iter().map(map_entry).collect() };

    match ext {
        "yml" | "yaml" => from_yaml_str(content).map(collect).map_err(|e| e.to_string()),
        "bib" => from_biblatex_str(content)
            .map(collect)
            .map_err(|errs| first_biblatex_error(&errs)),
        _ => match from_yaml_str(content) {
            Ok(lib) => Ok(collect(lib)),
            // A file with no valid YAML structure is almost certainly meant
            // as BibLaTeX, whose errors are more actionable than YAML's.
            Err(_) => from_biblatex_str(content)
                .map(collect)
                .map_err(|errs| first_biblatex_error(&errs)),
        },
    }
}

fn first_biblatex_error(errs: &[hayagriva::io::BibLaTeXError]) -> String {
    errs.first()
        .map(|e| e.to_string())
        .unwrap_or_else(|| "invalid bibliography".to_string())
}

/// Parse a bibliography file into completion entries.
///
/// Reads route through the workspace's [`WorkingTreeFs`] like every other
/// file read.
#[tauri::command(async)]
pub fn parse_bibliography(
    path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    vcs: State<'_, Arc<VcsState>>,
) -> Result<Vec<BibEntryDto>, String> {
    let t = Instant::now();

    let abs = Path::new(&path);
    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let root = workspace.root.read().clone().unwrap_or_default();
    let fs = vcs.working_tree_fs_for(&root);

    let bytes = fs.read_file(abs).map_err(|e| e.to_string())?;
    let content = String::from_utf8(bytes).map_err(|e| e.to_string())?;

    let entries = parse_content(&ext, &content)?;
    info!(
        "parse_bibliography: path={path:?} entries={} ({:.1}ms)",
        entries.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaml_entries_map_to_dto() {
        let src = "\
knuth1984:
  type: Book
  title: The TeXbook
  author:
    - Knuth, Donald E.
    - Lamport, Leslie
  date: 1984-01-01
";
        let entries = parse_content("yml", src).expect("parses");
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.key, "knuth1984");
        assert_eq!(entry.entry_type, "book");
        assert_eq!(entry.title.as_deref(), Some("The TeXbook"));
        assert_eq!(
            entry.author.as_deref(),
            Some("Knuth, Donald E. and Lamport, Leslie")
        );
        assert_eq!(entry.year.as_deref(), Some("1984"));
    }

    #[test]
    fn bibtex_entries_map_to_dto() {
        let src = "@book{knuth1984, title={The {TeX}book}, year={1984}}";
        let entries = parse_content("bib", src).expect("parses");
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.key, "knuth1984");
        assert_eq!(entry.title.as_deref(), Some("The TeXbook"));
        assert_eq!(entry.year.as_deref(), Some("1984"));
    }

    #[test]
    fn unknown_extension_sniffs_yaml_then_bibtex() {
        assert_eq!(parse_content("", "k:\n  type: book\n").unwrap().len(), 1);
        assert_eq!(parse_content("", "@book{k, title={T}}").unwrap().len(), 1);
        // A stray scalar is still *valid* YAML — an empty library, exactly
        // like typst-library sees it. Truly broken files are the only errors
        // (`@` is a reserved YAML indicator and the BibLaTeX entry is
        // unterminated).
        assert!(parse_content("", "@book{k, title={T}").is_err());
    }
}
