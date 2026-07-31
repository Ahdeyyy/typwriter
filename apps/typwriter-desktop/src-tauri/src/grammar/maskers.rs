//! Maskers that reduce a structured file down to the parts that are actually
//! prose.
//!
//! Typst can pull data straight into a document — `#json("data.json")`,
//! `#yaml(..)`, `#csv(..)`, `#xml(..)`, `#bibliography("refs.bib")` — so the
//! strings inside those files end up rendered and are worth checking. Their
//! *structure* is not: keys, paths, ids, and dates are identifiers, and
//! running a spell checker over them is nothing but noise.
//!
//! Each masker below is a small hand-rolled scanner rather than a real parser.
//! They are deliberately lenient: a file that is half-typed or slightly
//! malformed should still yield sensible regions instead of erroring out.

use harper_core::{Mask, Masker, Span};

/// Which structured format a masker should scan for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DataFormat {
    Json,
    Yaml,
    Toml,
    Csv,
    Xml,
    /// BibTeX / BibLaTeX. Unlike the others this uses an *allowlist* of prose
    /// fields, because a `.bib` entry is mostly names, dates, and identifiers.
    BibTex,
}

/// Key names whose values are identifiers, names, or machine data. Matched
/// after normalizing case and separators, so `serial-number`, `serial_number`,
/// and `serialNumber` all collapse to the same entry.
const NON_PROSE_KEYS: &[&str] = &[
    "address",
    "affiliation",
    "author",
    "authors",
    "background",
    "charset",
    "checksum",
    "class",
    "classname",
    "code",
    "color",
    "colour",
    "country",
    "created",
    "currency",
    "date",
    "datetime",
    "day",
    "dir",
    "directory",
    "doi",
    "edition",
    "editor",
    "editors",
    "email",
    "encoding",
    "file",
    "filename",
    "filepath",
    "font",
    "fontfamily",
    "foreground",
    "format",
    "guid",
    "hash",
    "height",
    "href",
    "id",
    "ids",
    "isbn",
    "issn",
    "issue",
    "key",
    "kind",
    "lang",
    "language",
    "lat",
    "latitude",
    "link",
    "locale",
    "lng",
    "longitude",
    "mail",
    "md5",
    "mime",
    "mimetype",
    "modified",
    "month",
    "name",
    "names",
    "orcid",
    "pagerange",
    "pages",
    "password",
    "path",
    "phone",
    "postcode",
    "publisher",
    "semver",
    "serialnumber",
    "sha",
    "sha1",
    "sha256",
    "size",
    "slug",
    "src",
    "style",
    "tag",
    "tags",
    "telephone",
    "time",
    "timestamp",
    "token",
    "translator",
    "type",
    "uri",
    "url",
    "uuid",
    "version",
    "volume",
    "width",
    "year",
    "zip",
];

/// `.bib` fields that hold prose. Everything else in an entry is a name, a
/// date, or an identifier.
const BIB_PROSE_FIELDS: &[&str] = &[
    "abstract",
    "addendum",
    "annotation",
    "annote",
    "booktitle",
    "comment",
    "maintitle",
    "note",
    "shorttitle",
    "subtitle",
    "title",
];

/// Normalize a key for comparison: lowercase, alphanumerics only.
fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_prose_key(key: &str) -> bool {
    let key = normalize_key(key);
    !key.is_empty() && !NON_PROSE_KEYS.contains(&key.as_str())
}

fn is_bib_prose_field(field: &str) -> bool {
    BIB_PROSE_FIELDS.contains(&normalize_key(field).as_str())
}

pub struct DataMasker {
    format: DataFormat,
}

impl DataMasker {
    pub fn new(format: DataFormat) -> Self {
        Self { format }
    }
}

impl Masker for DataMasker {
    fn create_mask(&self, source: &[char]) -> Mask {
        let mut builder = MaskBuilder::default();
        match self.format {
            DataFormat::Json => mask_json(source, &mut builder),
            DataFormat::Yaml => mask_yaml(source, &mut builder),
            DataFormat::Toml => mask_toml(source, &mut builder),
            DataFormat::Csv => mask_csv(source, &mut builder),
            DataFormat::Xml => mask_xml(source, &mut builder),
            DataFormat::BibTex => mask_bibtex(source, &mut builder),
        }
        builder.finish()
    }
}

/// Collects allowed regions, dropping the ones that could never contain a word
/// and enforcing the sorted, non-overlapping invariant [`Mask`] requires.
#[derive(Default)]
struct MaskBuilder {
    spans: Vec<Span<char>>,
}

impl MaskBuilder {
    fn allow(&mut self, source: &[char], start: usize, end: usize) {
        let end = end.min(source.len());
        if start >= end {
            return;
        }
        // Nothing to lint in a region without a single letter.
        if !source[start..end].iter().any(|c| c.is_alphabetic()) {
            return;
        }
        if let Some(last) = self.spans.last() {
            debug_assert!(start >= last.end, "mask regions must not overlap");
            if start < last.end {
                return;
            }
        }
        self.spans.push(Span::new(start, end));
    }

    fn finish(self) -> Mask {
        self.spans.into_iter().collect()
    }
}

// ── Shared scanning helpers ──────────────────────────────────────────────────

fn at(source: &[char], i: usize) -> Option<char> {
    source.get(i).copied()
}

fn starts_with(source: &[char], i: usize, needle: &str) -> bool {
    needle
        .chars()
        .enumerate()
        .all(|(offset, c)| at(source, i + offset) == Some(c))
}

/// Skip to just past the next newline.
fn skip_line(source: &[char], mut i: usize) -> usize {
    while i < source.len() && source[i] != '\n' {
        i += 1;
    }
    i + 1
}

/// Consume a quoted run starting at the opening `quote`, honouring backslash
/// escapes. Returns `(inner_start, inner_end, index_after_closing_quote)`.
fn scan_quoted(source: &[char], open: usize, quote: char, escapes: bool) -> (usize, usize, usize) {
    let mut i = open + 1;
    while i < source.len() {
        let c = source[i];
        if escapes && c == '\\' {
            i += 2;
            continue;
        }
        if c == quote {
            return (open + 1, i, i + 1);
        }
        i += 1;
    }
    // Unterminated — treat the rest of the input as the string body.
    (open + 1, source.len(), source.len())
}

fn index_of_next_non_space(source: &[char], mut i: usize) -> usize {
    while i < source.len() && source[i].is_whitespace() {
        i += 1;
    }
    i
}

// ── JSON ─────────────────────────────────────────────────────────────────────

/// A JSON string is a *key* when the next significant character after it is a
/// `:`. Everything else is a value, and values are checked unless their key
/// says otherwise.
fn mask_json(source: &[char], out: &mut MaskBuilder) {
    let mut i = 0;
    let mut pending_key: Option<String> = None;

    while i < source.len() {
        if source[i] != '"' {
            i += 1;
            continue;
        }

        let (start, end, next) = scan_quoted(source, i, '"', true);
        let following = index_of_next_non_space(source, next);

        if at(source, following) == Some(':') {
            pending_key = Some(source[start..end].iter().collect());
        } else {
            let allowed = pending_key.as_deref().is_none_or(is_prose_key);
            if allowed {
                out.allow(source, start, end);
            }
            // A key governs its own value only; the next string starts fresh
            // unless it is itself a key.
            if at(source, following) != Some(',') {
                pending_key = None;
            }
        }
        i = next;
    }
}

// ── YAML ─────────────────────────────────────────────────────────────────────

/// Line-oriented: take the scalar to the right of `key:` (or after a `- ` list
/// marker), plus the bodies of `|` / `>` block scalars.
fn mask_yaml(source: &[char], out: &mut MaskBuilder) {
    let mut i = 0;

    while i < source.len() {
        let line_start = i;
        let line_end = {
            let mut j = i;
            while j < source.len() && source[j] != '\n' {
                j += 1;
            }
            j
        };
        i = line_end + 1;

        let mut cursor = line_start;
        let indent = {
            while cursor < line_end && (source[cursor] == ' ' || source[cursor] == '\t') {
                cursor += 1;
            }
            cursor - line_start
        };

        // Strip any number of `- ` list markers.
        while starts_with(source, cursor, "- ") {
            cursor += 2;
            while cursor < line_end && source[cursor] == ' ' {
                cursor += 1;
            }
        }

        if cursor >= line_end || source[cursor] == '#' || starts_with(source, cursor, "---") {
            continue;
        }

        // Find an unquoted `key:` separator.
        let (key, value_start) = match find_yaml_separator(source, cursor, line_end) {
            Some(colon) => (
                source[cursor..colon].iter().collect::<String>(),
                index_of_next_non_space_in_line(source, colon + 1, line_end),
            ),
            // A bare scalar, e.g. an item in a sequence of strings.
            None => (String::new(), cursor),
        };

        if !key.is_empty() && !is_prose_key(key.trim().trim_matches(['"', '\''])) {
            continue;
        }
        if value_start >= line_end {
            continue;
        }

        // `|` / `>` introduce a block scalar: its body is the following, more
        // indented lines.
        if matches!(source[value_start], '|' | '>') {
            i = mask_yaml_block_scalar(source, i, indent, out);
            continue;
        }

        let (start, end) = yaml_scalar_bounds(source, value_start, line_end);
        out.allow(source, start, end);
    }
}

/// The index of the `:` that separates a YAML key from its value, skipping
/// colons inside quotes and requiring the trailing space YAML mandates.
fn find_yaml_separator(source: &[char], start: usize, line_end: usize) -> Option<usize> {
    let mut i = start;
    while i < line_end {
        match source[i] {
            '"' | '\'' => {
                let quote = source[i];
                let (_, _, next) = scan_quoted(source, i, quote, quote == '"');
                i = next.min(line_end);
            }
            ':' => {
                let next = at(source, i + 1);
                if i + 1 >= line_end || next == Some(' ') || next == Some('\t') {
                    return Some(i);
                }
                i += 1;
            }
            '#' => return None,
            _ => i += 1,
        }
    }
    None
}

fn index_of_next_non_space_in_line(source: &[char], mut i: usize, line_end: usize) -> usize {
    while i < line_end && (source[i] == ' ' || source[i] == '\t') {
        i += 1;
    }
    i
}

/// Trim a YAML scalar down to its content: drop surrounding quotes, an inline
/// `#` comment, and trailing whitespace.
fn yaml_scalar_bounds(source: &[char], start: usize, line_end: usize) -> (usize, usize) {
    if matches!(source[start], '"' | '\'') {
        let quote = source[start];
        let (inner_start, inner_end, _) = scan_quoted(source, start, quote, quote == '"');
        return (inner_start, inner_end.min(line_end));
    }

    // Anchors, aliases, tags, and flow collections aren't prose.
    if matches!(source[start], '&' | '*' | '!' | '{' | '[') {
        return (start, start);
    }

    let mut end = start;
    let mut i = start;
    while i < line_end {
        // ` #` starts a comment; a bare `#` mid-word does not.
        if source[i] == '#' && i > start && source[i - 1].is_whitespace() {
            break;
        }
        if !source[i].is_whitespace() {
            end = i + 1;
        }
        i += 1;
    }
    (start, end)
}

/// Consume the indented body of a `|` / `>` block scalar, allowing each line.
/// Returns the index of the first line that is no longer part of the block.
fn mask_yaml_block_scalar(
    source: &[char],
    mut i: usize,
    parent_indent: usize,
    out: &mut MaskBuilder,
) -> usize {
    while i < source.len() {
        let line_start = i;
        let mut line_end = i;
        while line_end < source.len() && source[line_end] != '\n' {
            line_end += 1;
        }

        let mut cursor = line_start;
        while cursor < line_end && (source[cursor] == ' ' || source[cursor] == '\t') {
            cursor += 1;
        }

        let blank = cursor >= line_end;
        if !blank && cursor - line_start <= parent_indent {
            return line_start;
        }

        out.allow(source, cursor, line_end);
        i = line_end + 1;
    }
    i
}

// ── TOML ─────────────────────────────────────────────────────────────────────

/// Scans for string literals and attributes each to the most recent `key =`.
/// Table headers and comments are skipped outright.
fn mask_toml(source: &[char], out: &mut MaskBuilder) {
    let mut i = 0;
    let mut current_key = String::new();
    let mut expect_key = true;

    while i < source.len() {
        let c = source[i];

        match c {
            '\n' => {
                expect_key = true;
                i += 1;
            }
            ' ' | '\t' | '\r' => i += 1,
            '#' => i = skip_line(source, i),
            '[' if expect_key => {
                // Table header — the names inside are keys.
                i = skip_line(source, i);
            }
            _ if expect_key => {
                let key_start = i;
                while i < source.len() && source[i] != '=' && source[i] != '\n' {
                    i += 1;
                }
                if at(source, i) == Some('=') {
                    current_key = source[key_start..i].iter().collect::<String>();
                    current_key = current_key.trim().trim_matches(['"', '\'']).to_string();
                    expect_key = false;
                    i += 1;
                }
            }
            '"' | '\'' => {
                let (start, end, next) = scan_toml_string(source, i);
                if is_prose_key(&current_key) {
                    out.allow(source, start, end);
                }
                i = next;
            }
            _ => i += 1,
        }
    }
}

/// Handles TOML's four string forms: `"""…"""`, `'''…'''`, `"…"`, `'…'`.
fn scan_toml_string(source: &[char], open: usize) -> (usize, usize, usize) {
    let quote = source[open];
    let triple: String = std::iter::repeat_n(quote, 3).collect();

    if starts_with(source, open, &triple) {
        let mut i = open + 3;
        while i < source.len() {
            if quote == '"' && source[i] == '\\' {
                i += 2;
                continue;
            }
            if starts_with(source, i, &triple) {
                return (open + 3, i, i + 3);
            }
            i += 1;
        }
        return (open + 3, source.len(), source.len());
    }

    scan_quoted(source, open, quote, quote == '"')
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/// Every field is data, so every field is checked. Quotes are stripped;
/// doubled `""` escapes are left in place, which costs nothing in practice.
fn mask_csv(source: &[char], out: &mut MaskBuilder) {
    let mut i = 0;
    while i < source.len() {
        match source[i] {
            ',' | '\n' | '\r' => i += 1,
            '"' => {
                let (start, end, next) = scan_quoted(source, i, '"', false);
                out.allow(source, start, end);
                i = next;
            }
            _ => {
                let start = i;
                while i < source.len() && !matches!(source[i], ',' | '\n' | '\r') {
                    i += 1;
                }
                out.allow(source, start, i);
            }
        }
    }
}

// ── XML ──────────────────────────────────────────────────────────────────────

/// Text nodes only. Comments, declarations, and doctypes are skipped; CDATA
/// bodies are treated as text. Attribute values are left alone — in the XML
/// Typst actually reads, prose lives in elements.
fn mask_xml(source: &[char], out: &mut MaskBuilder) {
    let mut i = 0;
    while i < source.len() {
        if source[i] != '<' {
            let start = i;
            while i < source.len() && source[i] != '<' {
                i += 1;
            }
            out.allow(source, start, i);
            continue;
        }

        if starts_with(source, i, "<!--") {
            i = find_after(source, i + 4, "-->");
        } else if starts_with(source, i, "<![CDATA[") {
            let start = i + 9;
            let end = find_before(source, start, "]]>");
            out.allow(source, start, end);
            i = find_after(source, start, "]]>");
        } else if starts_with(source, i, "<?") {
            i = find_after(source, i + 2, "?>");
        } else if starts_with(source, i, "<!") {
            i = find_after(source, i + 2, ">");
        } else {
            i = skip_xml_tag(source, i);
        }
    }
}

/// Walk past a start/end tag, keeping quoted attribute values intact so a `>`
/// inside one doesn't end the tag early.
fn skip_xml_tag(source: &[char], mut i: usize) -> usize {
    i += 1;
    while i < source.len() {
        match source[i] {
            '"' | '\'' => {
                let (_, _, next) = scan_quoted(source, i, source[i], false);
                i = next;
            }
            '>' => return i + 1,
            _ => i += 1,
        }
    }
    i
}

fn find_after(source: &[char], from: usize, needle: &str) -> usize {
    find_before(source, from, needle) + needle.chars().count()
}

fn find_before(source: &[char], from: usize, needle: &str) -> usize {
    let mut i = from;
    while i < source.len() {
        if starts_with(source, i, needle) {
            return i;
        }
        i += 1;
    }
    source.len()
}

// ── BibTeX ───────────────────────────────────────────────────────────────────

/// Allowlist-driven: only the handful of fields that hold prose are checked.
/// Values may be `{braced}` (possibly nested) or `"quoted"`.
fn mask_bibtex(source: &[char], out: &mut MaskBuilder) {
    let mut i = 0;
    while i < source.len() {
        if source[i] == '%' {
            i = skip_line(source, i);
            continue;
        }
        if !source[i].is_alphabetic() {
            i += 1;
            continue;
        }

        let name_start = i;
        while i < source.len() && (source[i].is_alphanumeric() || source[i] == '-') {
            i += 1;
        }
        let name: String = source[name_start..i].iter().collect();

        let eq = index_of_next_non_space(source, i);
        if at(source, eq) != Some('=') {
            continue;
        }
        let value_start = index_of_next_non_space(source, eq + 1);
        let prose = is_bib_prose_field(&name);

        match at(source, value_start) {
            Some('{') => {
                let (start, end, next) = scan_braced(source, value_start);
                if prose {
                    out.allow(source, start, end);
                }
                i = next;
            }
            Some('"') => {
                let (start, end, next) = scan_quoted(source, value_start, '"', true);
                if prose {
                    out.allow(source, start, end);
                }
                i = next;
            }
            _ => i = value_start,
        }
    }
}

/// Consume a `{…}` group, tracking nesting so `{The {TeX}book}` stays whole.
fn scan_braced(source: &[char], open: usize) -> (usize, usize, usize) {
    let mut depth = 0usize;
    let mut i = open;
    while i < source.len() {
        match source[i] {
            '\\' => i += 2,
            '{' => {
                depth += 1;
                i += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return (open + 1, i, i + 1);
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    (open + 1, source.len(), source.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The regions a masker allows, as strings.
    fn allowed(format: DataFormat, source: &str) -> Vec<String> {
        let chars: Vec<char> = source.chars().collect();
        let mask = DataMasker::new(format).create_mask(&chars);
        mask.iter_allowed(&chars)
            .map(|(_, content)| content.iter().collect())
            .collect()
    }

    #[test]
    fn json_checks_values_not_keys() {
        assert_eq!(
            allowed(DataFormat::Json, r#"{"title": "The quick brown fox"}"#),
            vec!["The quick brown fox"]
        );
    }

    #[test]
    fn json_skips_non_prose_keys() {
        // `url` and `id` are identifiers; `caption` is prose.
        assert_eq!(
            allowed(
                DataFormat::Json,
                r#"{"url": "https://exampel.com", "caption": "A caption"}"#
            ),
            vec!["A caption"]
        );
    }

    #[test]
    fn json_handles_escapes_and_arrays() {
        assert_eq!(
            allowed(DataFormat::Json, r#"{"note": "a \"quoted\" word"}"#),
            vec![r#"a \"quoted\" word"#]
        );
        assert_eq!(
            allowed(
                DataFormat::Json,
                r#"{"notes": ["first one", "second one"]}"#
            ),
            vec!["first one", "second one"]
        );
    }

    #[test]
    fn yaml_takes_scalars_after_keys() {
        // `title` is prose; `type` and `isbn` are machine fields, filtered out
        // by key name rather than by content.
        assert_eq!(
            allowed(
                DataFormat::Yaml,
                "title: Harry Potter\ntype: Book\nisbn: 123"
            ),
            vec!["Harry Potter"]
        );
    }

    #[test]
    fn yaml_strips_comments_and_quotes() {
        assert_eq!(
            allowed(DataFormat::Yaml, "note: \"a quoted note\"  # trailing\n"),
            vec!["a quoted note"]
        );
        assert_eq!(
            allowed(DataFormat::Yaml, "note: bare words # trailing\n"),
            vec!["bare words"]
        );
    }

    #[test]
    fn yaml_reads_block_scalars() {
        let source = "abstract: |\n  First line here.\n  Second line here.\nid: xyz\n";
        assert_eq!(
            allowed(DataFormat::Yaml, source),
            vec!["First line here.", "Second line here."]
        );
    }

    #[test]
    fn yaml_handles_sequences() {
        assert_eq!(
            allowed(DataFormat::Yaml, "- first entry\n- second entry\n"),
            vec!["first entry", "second entry"]
        );
    }

    #[test]
    fn toml_attributes_strings_to_their_key() {
        assert_eq!(
            allowed(
                DataFormat::Toml,
                "[package]\nname = \"typwriter\"\ndescription = \"An editor for Typst\"\nversion = \"1.0\"\n"
            ),
            vec!["An editor for Typst"]
        );
    }

    #[test]
    fn toml_reads_multiline_strings() {
        assert_eq!(
            allowed(
                DataFormat::Toml,
                "summary = \"\"\"\nA longer summary.\n\"\"\"\n"
            ),
            vec!["\nA longer summary.\n"]
        );
    }

    #[test]
    fn csv_checks_every_field() {
        assert_eq!(
            allowed(
                DataFormat::Csv,
                "product,notes\nWidget,\"A useful widget\"\n"
            ),
            vec!["product", "notes", "Widget", "A useful widget"]
        );
    }

    #[test]
    fn xml_takes_element_text_only() {
        assert_eq!(
            allowed(
                DataFormat::Xml,
                r#"<?xml version="1.0"?><doc><t class="big">Hello there</t><!-- a comment --></doc>"#
            ),
            vec!["Hello there"]
        );
    }

    #[test]
    fn xml_reads_cdata() {
        assert_eq!(
            allowed(DataFormat::Xml, "<t><![CDATA[Raw text here]]></t>"),
            vec!["Raw text here"]
        );
    }

    #[test]
    fn bibtex_takes_prose_fields_only() {
        let source = r#"@article{key2020,
  author = {Doe, Jane},
  title = {On the {TeX}book and other matters},
  journal = {Journal of Things},
  abstract = "A short abstract.",
  year = {2020}
}"#;
        assert_eq!(
            allowed(DataFormat::BibTex, source),
            vec!["On the {TeX}book and other matters", "A short abstract."]
        );
    }

    #[test]
    fn maskers_survive_truncated_input() {
        // Each of these ends mid-construct; none may panic or loop forever.
        for (format, source) in [
            (DataFormat::Json, r#"{"a": "unterminated"#),
            (DataFormat::Yaml, "key: \"unterminated"),
            (DataFormat::Toml, "key = \"\"\"unterminated"),
            (DataFormat::Csv, "\"unterminated"),
            (DataFormat::Xml, "<t>text<!-- unterminated"),
            (DataFormat::BibTex, "@a{k, title = {unterminated"),
        ] {
            allowed(format, source);
        }
    }
}
