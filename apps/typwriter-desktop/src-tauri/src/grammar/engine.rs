//! Owns the Harper dictionary and lint configuration, and turns lints into
//! something the frontend can render.
//!
//! One [`GrammarEngine`] lives in Tauri managed state for the life of the app.
//! Building the curated lint group is expensive (it constructs several hundred
//! linters and loads the dictionary), so it is built once and rebuilt only
//! when the dialect or user dictionary changes — plain rule toggles just mutate
//! the group's config in place.

use std::collections::BTreeMap;
use std::sync::Arc;

use harper_core::linting::{Lint, LintKind, Suggestion};
use harper_core::spell::{FstDictionary, MergedDictionary, MutableDictionary};
use harper_core::{Dialect, DictWordMetadata, Document};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::format::CheckedFormat;

/// English dialect to check against. Mirrors [`Dialect`] so the frontend never
/// has to know Harper's own type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum GrammarDialect {
    #[default]
    American,
    British,
    Canadian,
    Australian,
    Indian,
}

impl From<GrammarDialect> for Dialect {
    fn from(dialect: GrammarDialect) -> Self {
        match dialect {
            GrammarDialect::American => Dialect::American,
            GrammarDialect::British => Dialect::British,
            GrammarDialect::Canadian => Dialect::Canadian,
            GrammarDialect::Australian => Dialect::Australian,
            GrammarDialect::Indian => Dialect::Indian,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GrammarConfig {
    /// Master switch. When off, checking is skipped entirely — no document is
    /// built and no lints are produced.
    pub enabled: bool,
    pub dialect: GrammarDialect,
    /// Per-rule overrides, keyed by Harper's linter name. A rule absent from
    /// this map keeps its curated default.
    pub rules: BTreeMap<String, bool>,
    /// Words the user has added; treated as correctly spelled.
    pub user_dictionary: Vec<String>,
    /// Workspace-relative paths the user has switched checking off for.
    pub disabled_files: Vec<String>,
}

impl Default for GrammarConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            dialect: GrammarDialect::default(),
            rules: BTreeMap::new(),
            user_dictionary: Vec::new(),
            disabled_files: Vec::new(),
        }
    }
}

impl GrammarConfig {
    /// Whether `path` (workspace-relative, forward slashes) is opted out.
    fn is_file_disabled(&self, path: &str) -> bool {
        let path = normalize_path(path);
        self.disabled_files
            .iter()
            .any(|disabled| normalize_path(disabled) == path)
    }
}

/// Compare paths case-insensitively with `\` folded to `/`, so a file opted out
/// on Windows stays opted out however the path reaches us.
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

// ─── Frontend-facing results ────────────────────────────────────────────────

/// A suggested edit. Offsets come from the owning [`GrammarLint`]; the frontend
/// turns these into a CodeMirror change.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum GrammarSuggestion {
    /// Replace the lint's span with `text`.
    Replace { text: String },
    /// Insert `text` immediately after the lint's span.
    InsertAfter { text: String },
    /// Delete the lint's span.
    Remove,
}

impl GrammarSuggestion {
    fn from_harper(suggestion: &Suggestion) -> Self {
        match suggestion {
            Suggestion::ReplaceWith(chars) => Self::Replace {
                text: chars.iter().collect(),
            },
            Suggestion::InsertAfter(chars) => Self::InsertAfter {
                text: chars.iter().collect(),
            },
            Suggestion::Remove => Self::Remove,
        }
    }
}

/// One problem found in a file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarLint {
    /// Start offset, in UTF-16 code units — CodeMirror's coordinate system.
    pub start: usize,
    /// End offset, in UTF-16 code units.
    pub end: usize,
    /// The text the lint covers, for display in the problems list.
    pub text: String,
    pub message: String,
    /// Harper's category (`spelling`, `grammar`, `style`, …).
    pub kind: String,
    /// The rule that produced this lint. Lets the UI offer "disable this rule".
    pub rule: String,
    /// Lower is more important.
    pub priority: u8,
    pub suggestions: Vec<GrammarSuggestion>,
}

/// The outcome of checking one file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarReport {
    pub file_path: String,
    /// `None` when the file's type isn't checkable at all.
    pub format: Option<CheckedFormat>,
    /// Human-readable name of `format` ("Typst", "BibTeX", …), for the
    /// per-file toggle's tooltip.
    pub format_label: Option<&'static str>,
    /// Why nothing was checked, when `lints` is empty and `format` is `Some`.
    pub skipped: Option<SkipReason>,
    pub lints: Vec<GrammarLint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    /// Grammar checking is switched off app-wide.
    Disabled,
    /// The user switched checking off for this file.
    FileDisabled,
    /// The file's type has no parser.
    UnsupportedFormat,
}

// ─── Engine ─────────────────────────────────────────────────────────────────

pub struct GrammarEngine {
    state: Mutex<State>,
}

struct State {
    config: GrammarConfig,
    /// Built on first use and dropped whenever the dialect or user dictionary
    /// changes. Construction loads the curated dictionary and instantiates
    /// several hundred linters — far too slow to sit on the startup path, and
    /// wasted entirely if the user never opens a checkable file.
    built: Option<Built>,
}

struct Built {
    dictionary: Arc<MergedDictionary>,
    group: harper_core::linting::LintGroup,
}

impl GrammarEngine {
    pub fn new(config: GrammarConfig) -> Self {
        Self {
            state: Mutex::new(State {
                config,
                built: None,
            }),
        }
    }

    pub fn config(&self) -> GrammarConfig {
        self.state.lock().config.clone()
    }

    /// Swap in a new configuration. The lint group is thrown away — and so
    /// rebuilt on the next check — only when the dialect or dictionary
    /// changed; plain rule toggles are applied in place.
    pub fn set_config(&self, config: GrammarConfig) {
        let mut state = self.state.lock();
        let needs_rebuild = state.config.dialect != config.dialect
            || state.config.user_dictionary != config.user_dictionary;

        state.config = config;
        if needs_rebuild {
            state.built = None;
        } else {
            let State { config, built } = &mut *state;
            if let Some(built) = built {
                apply_rules(&mut built.group, config);
            }
        }
    }

    /// Add a word to the user dictionary, returning the updated config so the
    /// caller can persist it. No-op if the word is already there.
    pub fn add_dictionary_word(&self, word: &str) -> GrammarConfig {
        let word = word.trim().to_string();
        let mut config = self.config();
        if !word.is_empty() && !config.user_dictionary.iter().any(|w| w == &word) {
            config.user_dictionary.push(word);
            config.user_dictionary.sort();
            self.set_config(config.clone());
        }
        config
    }

    /// Turn checking on or off for one file, returning the updated config.
    pub fn set_file_enabled(&self, path: &str, enabled: bool) -> GrammarConfig {
        let mut config = self.config();
        let normalized = normalize_path(path);
        config
            .disabled_files
            .retain(|disabled| normalize_path(disabled) != normalized);
        if !enabled {
            config.disabled_files.push(path.to_string());
        }
        self.set_config(config.clone());
        config
    }

    /// Every rule Harper knows about, with its description and current state.
    /// Drives the rule list in Settings.
    pub fn rule_catalog(&self) -> Vec<GrammarRuleInfo> {
        let mut state = self.state.lock();
        let built = state.ensure_built();

        let descriptions = built.group.all_descriptions();
        let mut catalog: Vec<GrammarRuleInfo> = built
            .group
            .iter_keys()
            .map(|name| GrammarRuleInfo {
                name: name.to_string(),
                description: descriptions
                    .get(name)
                    .map(|d| (*d).to_string())
                    .unwrap_or_default(),
                enabled: built.group.config.is_rule_enabled(name),
            })
            .collect();
        catalog.sort_by(|a, b| a.name.cmp(&b.name));
        catalog
    }

    /// Check one file. `path` is workspace-relative and only used to pick a
    /// parser and honour per-file opt-outs.
    pub fn check(&self, path: &str, text: &str) -> GrammarReport {
        let format = CheckedFormat::from_path(path);
        let mut state = self.state.lock();

        let skipped = if !state.config.enabled {
            Some(SkipReason::Disabled)
        } else if format.is_none() {
            Some(SkipReason::UnsupportedFormat)
        } else if state.config.is_file_disabled(path) {
            Some(SkipReason::FileDisabled)
        } else {
            None
        };

        let (Some(format), None) = (format, skipped) else {
            return GrammarReport {
                file_path: path.to_string(),
                format,
                format_label: format.map(CheckedFormat::label),
                skipped,
                lints: Vec::new(),
            };
        };

        let built = state.ensure_built();
        let document = Document::new(text, &format.parser(), built.dictionary.as_ref());
        let organized = built.group.organized_lints(&document);

        let source = document.get_source();
        let offsets = Utf16Offsets::new(source);
        let mut lints: Vec<GrammarLint> = organized
            .into_iter()
            .flat_map(|(rule, lints)| lints.into_iter().map(move |lint| (rule.clone(), lint)))
            .map(|(rule, lint)| to_grammar_lint(rule, lint, source, &offsets))
            .collect();

        // Most important first, then by position, so the problems pane and the
        // inline chip agree on which lint wins a given line.
        lints.sort_by_key(|lint| (lint.priority, lint.start, lint.end));

        GrammarReport {
            file_path: path.to_string(),
            format: Some(format),
            format_label: Some(format.label()),
            skipped: None,
            lints,
        }
    }
}

impl State {
    fn ensure_built(&mut self) -> &mut Built {
        if self.built.is_none() {
            self.built = Some(Built::new(&self.config));
        }
        self.built.as_mut().expect("just built")
    }
}

impl Built {
    fn new(config: &GrammarConfig) -> Self {
        let mut dictionary = MergedDictionary::new();
        dictionary.add_dictionary(FstDictionary::curated());

        if !config.user_dictionary.is_empty() {
            let mut user = MutableDictionary::new();
            for word in &config.user_dictionary {
                let word = word.trim();
                if !word.is_empty() {
                    user.append_word_str(word, DictWordMetadata::default());
                }
            }
            dictionary.add_dictionary(Arc::new(user));
        }

        let dictionary = Arc::new(dictionary);
        let mut group =
            harper_core::linting::LintGroup::new_curated(dictionary.clone(), config.dialect.into());
        apply_rules(&mut group, config);

        Self { dictionary, group }
    }
}

fn apply_rules(group: &mut harper_core::linting::LintGroup, config: &GrammarConfig) {
    // Reset to the curated defaults first, so a rule dropped from the
    // overrides map returns to its default instead of keeping its last value.
    group.config = harper_core::linting::FlatConfig::new_curated();
    for (rule, enabled) in &config.rules {
        group.config.set_rule_enabled(rule.clone(), *enabled);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarRuleInfo {
    pub name: String,
    pub description: String,
    pub enabled: bool,
}

fn to_grammar_lint(
    rule: String,
    lint: Lint,
    source: &[char],
    offsets: &Utf16Offsets,
) -> GrammarLint {
    GrammarLint {
        start: offsets.at(lint.span.start),
        end: offsets.at(lint.span.end),
        text: lint.get_str(source),
        message: lint.message,
        kind: lint_kind_name(lint.lint_kind).to_string(),
        rule,
        priority: lint.priority,
        suggestions: lint
            .suggestions
            .iter()
            .map(GrammarSuggestion::from_harper)
            .collect(),
    }
}

fn lint_kind_name(kind: LintKind) -> &'static str {
    match kind {
        LintKind::Agreement => "agreement",
        LintKind::BoundaryError => "boundary",
        LintKind::Capitalization => "capitalization",
        LintKind::Eggcorn => "eggcorn",
        LintKind::Enhancement => "enhancement",
        LintKind::Formatting => "formatting",
        LintKind::Grammar => "grammar",
        LintKind::Malapropism => "malapropism",
        LintKind::Nonstandard => "nonstandard",
        LintKind::Punctuation => "punctuation",
        LintKind::Readability => "readability",
        LintKind::Redundancy => "redundancy",
        LintKind::Regionalism => "regionalism",
        LintKind::Repetition => "repetition",
        LintKind::Spelling => "spelling",
        LintKind::Style => "style",
        LintKind::Typo => "typo",
        LintKind::WordChoice => "word-choice",
        LintKind::Miscellaneous => "miscellaneous",
        // `LintKind` is explicitly open to new variants upstream; anything we
        // don't know yet lands in the catch-all bucket rather than failing the
        // build's exhaustiveness check.
        _ => "miscellaneous",
    }
}

/// Character index → UTF-16 code-unit index.
///
/// Harper counts in Unicode scalar values; CodeMirror counts in UTF-16 code
/// units, like every JS string. The two agree until a document contains an
/// astral character (emoji, some CJK extensions, most maths alphanumerics),
/// at which point every offset after it would be off by one per such
/// character — so the conversion is not optional.
struct Utf16Offsets {
    /// `None` when every character is a single UTF-16 unit, i.e. the indices
    /// coincide. Otherwise entry `i` is the UTF-16 offset of character `i`,
    /// with one extra entry for the end.
    prefix: Option<Vec<u32>>,
    len: usize,
}

impl Utf16Offsets {
    fn new(source: &[char]) -> Self {
        if source.iter().all(|c| c.len_utf16() == 1) {
            return Self {
                prefix: None,
                len: source.len(),
            };
        }

        let mut prefix = Vec::with_capacity(source.len() + 1);
        let mut units = 0u32;
        for c in source {
            prefix.push(units);
            units += c.len_utf16() as u32;
        }
        prefix.push(units);

        Self {
            len: units as usize,
            prefix: Some(prefix),
        }
    }

    fn at(&self, char_index: usize) -> usize {
        match &self.prefix {
            None => char_index.min(self.len),
            Some(prefix) => prefix.get(char_index).copied().unwrap_or(self.len as u32) as usize,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_offsets_are_identity_for_bmp_text() {
        let source: Vec<char> = "café".chars().collect();
        let offsets = Utf16Offsets::new(&source);
        assert!(offsets.prefix.is_none());
        assert_eq!(offsets.at(4), 4);
    }

    #[test]
    fn utf16_offsets_account_for_surrogate_pairs() {
        // The emoji is one char but two UTF-16 units.
        let source: Vec<char> = "a🎉b".chars().collect();
        let offsets = Utf16Offsets::new(&source);
        assert_eq!(offsets.at(0), 0);
        assert_eq!(offsets.at(1), 1);
        assert_eq!(offsets.at(2), 3);
        assert_eq!(offsets.at(3), 4);
        // Out-of-range indices clamp instead of panicking.
        assert_eq!(offsets.at(99), 4);
    }

    #[test]
    fn disabled_files_match_across_separator_and_case() {
        let config = GrammarConfig {
            disabled_files: vec!["Chapters/Intro.typ".into()],
            ..Default::default()
        };
        assert!(config.is_file_disabled("chapters/intro.typ"));
        assert!(config.is_file_disabled(r"chapters\intro.typ"));
        assert!(!config.is_file_disabled("chapters/outro.typ"));
    }

    #[test]
    fn checking_reports_why_it_skipped() {
        let engine = GrammarEngine::new(GrammarConfig {
            disabled_files: vec!["skip.typ".into()],
            ..Default::default()
        });

        assert_eq!(
            engine.check("main.rs", "fn main() {}").skipped,
            Some(SkipReason::UnsupportedFormat)
        );
        assert_eq!(
            engine.check("skip.typ", "Some text.").skipped,
            Some(SkipReason::FileDisabled)
        );

        let off = GrammarEngine::new(GrammarConfig {
            enabled: false,
            ..Default::default()
        });
        assert_eq!(
            off.check("main.typ", "Some text.").skipped,
            Some(SkipReason::Disabled)
        );
    }

    #[test]
    fn a_misspelling_in_typst_markup_is_found() {
        let engine = GrammarEngine::new(GrammarConfig::default());
        let report = engine.check("main.typ", "This sentence has a mispelled word.\n");

        assert_eq!(report.format, Some(CheckedFormat::Typst));
        // Harper may raise more than one rule against the same word (spelling
        // and word-boundary, say), so look across all of them for the fix.
        let suggestions: Vec<&GrammarSuggestion> = report
            .lints
            .iter()
            .filter(|lint| lint.text == "mispelled")
            .flat_map(|lint| &lint.suggestions)
            .collect();
        assert!(!suggestions.is_empty(), "the misspelling should be caught");
        assert!(
            suggestions
                .iter()
                .any(|s| matches!(s, GrammarSuggestion::Replace { text } if text == "misspelled")),
            "expected a spelling suggestion, got {suggestions:?}",
        );
    }

    #[test]
    fn code_and_math_produce_no_lints() {
        let engine = GrammarEngine::new(GrammarConfig::default());
        let report = engine.check("main.typ", "#let mispelled = 1\n$ mispelled $\n");
        assert!(
            report.lints.is_empty(),
            "code and math should be invisible to the linters, got {:?}",
            report.lints
        );
    }

    #[test]
    fn the_user_dictionary_silences_a_word() {
        let text = "The zorbulator is ready.\n";
        let plain = GrammarEngine::new(GrammarConfig::default());
        assert!(plain
            .check("a.typ", text)
            .lints
            .iter()
            .any(|l| l.text == "zorbulator"));

        let with_word = GrammarEngine::new(GrammarConfig {
            user_dictionary: vec!["zorbulator".into()],
            ..Default::default()
        });
        assert!(
            !with_word
                .check("a.typ", text)
                .lints
                .iter()
                .any(|l| l.text == "zorbulator"),
            "the user dictionary should suppress the word"
        );
    }

    /// End-to-end proof that each file type reaches the right reader: the same
    /// misspelling is found in prose but not in the surrounding structure.
    #[test]
    fn each_format_routes_to_its_reader() {
        let engine = GrammarEngine::new(GrammarConfig::default());
        let has_lint = |path: &str, text: &str, word: &str| {
            engine
                .check(path, text)
                .lints
                .iter()
                .any(|l| l.text == word)
        };

        assert!(has_lint(
            "a.md",
            "# Heading\n\nA mispelled word.\n",
            "mispelled"
        ));
        assert!(has_lint("a.txt", "A mispelled word.\n", "mispelled"));
        assert!(has_lint(
            "refs.bib",
            "@book{k, title = {A mispelled title}, publisher = {Nowhere}}",
            "mispelled"
        ));
        assert!(has_lint(
            "d.json",
            r#"{"caption": "A mispelled caption"}"#,
            "mispelled"
        ));
        assert!(has_lint("d.yml", "title: A mispelled title\n", "mispelled"));

        // Structure around the prose is invisible: a BibTeX field name, a JSON
        // key, and a source file are all left alone.
        assert!(!has_lint(
            "refs.bib",
            "@book{k, publisher = {A mispelled publisher}}",
            "mispelled"
        ));
        assert!(!has_lint(
            "d.json",
            r#"{"mispelled": "fine text here"}"#,
            "mispelled"
        ));
        assert!(!has_lint("code.rs", "let mispelled = 1;", "mispelled"));
    }

    #[test]
    fn offsets_survive_a_multibyte_prefix() {
        let engine = GrammarEngine::new(GrammarConfig::default());
        let text = "🎉 A mispelled word.\n";
        let report = engine.check("a.typ", text);
        let lint = report
            .lints
            .iter()
            .find(|l| l.text == "mispelled")
            .expect("the misspelling should be caught");

        // The reported offsets must index the JS string, not the char array.
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let sliced = String::from_utf16(&utf16[lint.start..lint.end]).unwrap();
        assert_eq!(sliced, "mispelled");
    }
}
