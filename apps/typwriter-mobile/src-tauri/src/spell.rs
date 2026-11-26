//! Spell checking for the editor.
//!
//! The frontend pulls the prose out of a Typst buffer, a paragraph at a time,
//! and sends only paragraphs it has no answer cached for. Spelling is always
//! checked here, with the bundled en_US Hunspell dictionary (`spellbook`), so
//! it behaves the same on every device. Grammar, which the dictionary can't
//! do, comes from Android's own spellchecker service (the local `spellcheck`
//! plugin) when the device has one that reports it; its spelling flags are
//! ignored.
//!
//! The dictionary is parsed on first use, on a blocking thread.

use std::num::NonZeroUsize;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use lru::LruCache;
use parking_lot::Mutex;
use serde::Serialize;
use spellbook::Dictionary;
use tauri_plugin_spellcheck::{NativeIssue, NativeIssueKind};

const AFF: &str = include_str!("../dictionaries/en_US/en_US.aff");
const DIC: &str = include_str!("../dictionaries/en_US/en_US.dic");

/// How long to stop asking a service that failed or timed out for grammar. A
/// broken service would otherwise cost every check its full timeout.
const NATIVE_BACKOFF: Duration = Duration::from_secs(60);
pub const SUGGESTION_LIMIT: usize = 5;
const SUGGESTION_CACHE: usize = 256;

/// One flagged range, in UTF-16 code units of the text it was found in.
#[derive(Debug, Clone, Serialize)]
pub struct SpellIssue {
    pub start: usize,
    pub end: usize,
    pub kind: NativeIssueKind,
    /// `None` when suggestions weren't computed up front (the bundled
    /// dictionary's are slow enough to fetch only for the word the caret is
    /// in, through `spell_suggest`).
    pub suggestions: Option<Vec<String>>,
}

impl From<NativeIssue> for SpellIssue {
    fn from(issue: NativeIssue) -> Self {
        Self {
            start: issue.start,
            end: issue.end,
            kind: issue.kind,
            suggestions: Some(issue.suggestions),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellReport {
    /// One list per text sent, in order.
    pub results: Vec<Vec<SpellIssue>>,
    /// Whether the device's service checked grammar. The settings pane says so.
    pub device_grammar: bool,
}

pub struct SpellState {
    dictionary: OnceLock<Option<Dictionary>>,
    native_paused_until: Mutex<Option<Instant>>,
    suggestions: Mutex<LruCache<String, Vec<String>>>,
}

impl Default for SpellState {
    fn default() -> Self {
        Self {
            dictionary: OnceLock::new(),
            native_paused_until: Mutex::new(None),
            suggestions: Mutex::new(LruCache::new(
                NonZeroUsize::new(SUGGESTION_CACHE).expect("non-zero"),
            )),
        }
    }
}

impl SpellState {
    pub fn native_paused(&self) -> bool {
        let mut until = self.native_paused_until.lock();
        match *until {
            Some(at) if Instant::now() < at => true,
            Some(_) => {
                *until = None;
                false
            }
            None => false,
        }
    }

    pub fn pause_native(&self) {
        *self.native_paused_until.lock() = Some(Instant::now() + NATIVE_BACKOFF);
    }

    /// Blocking: parses the dictionary on first use.
    fn dictionary(&self) -> Option<&Dictionary> {
        self.dictionary
            .get_or_init(|| match Dictionary::new(AFF, DIC) {
                Ok(dictionary) => Some(dictionary),
                Err(err) => {
                    log::error!("spell: bundled dictionary failed to load: {err}");
                    None
                }
            })
            .as_ref()
    }

    /// Check `texts` against the bundled dictionary. Blocking.
    pub fn check_bundled(&self, texts: &[String]) -> Vec<Vec<SpellIssue>> {
        let Some(dictionary) = self.dictionary() else {
            return vec![Vec::new(); texts.len()];
        };
        texts
            .iter()
            .map(|text| {
                words(text)
                    .filter(|word| !dictionary.check(&word.normalized))
                    .map(|word| SpellIssue {
                        start: word.start,
                        end: word.end,
                        kind: NativeIssueKind::Spelling,
                        suggestions: None,
                    })
                    .collect()
            })
            .collect()
    }

    /// Suggestions for one word from the bundled dictionary. Blocking, and
    /// slow enough (Hunspell tries many edits) to be worth caching.
    pub fn suggest(&self, word: &str) -> Vec<String> {
        let word = word.trim().replace('\u{2019}', "'");
        if word.is_empty() {
            return Vec::new();
        }
        if let Some(hit) = self.suggestions.lock().get(&word) {
            return hit.clone();
        }
        let Some(dictionary) = self.dictionary() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        dictionary.suggest(&word, &mut out);
        out.truncate(SUGGESTION_LIMIT);
        self.suggestions.lock().put(word, out.clone());
        out
    }
}

/// A word the bundled checker should look up.
#[derive(Debug, PartialEq, Eq)]
struct Word {
    /// UTF-16 offsets into the text.
    start: usize,
    end: usize,
    /// The word as the dictionary spells it (curly apostrophes made straight).
    normalized: String,
}

/// The words in `text` worth checking: runs of letters, with apostrophes
/// inside a word kept (`don't`, `dog's`). Skipped as almost always deliberate:
/// anything with a digit or underscore, single letters, ALL-CAPS acronyms,
/// and words with a capital after the first letter (`iPhone`, `camelCase`).
fn words(text: &str) -> impl Iterator<Item = Word> + '_ {
    let mut chars = text.char_indices().peekable();
    let mut utf16 = 0usize;
    std::iter::from_fn(move || loop {
        // Skip to the start of a word.
        let (start_byte, start16) = loop {
            let &(index, c) = chars.peek()?;
            if is_word_char(c) && !is_apostrophe(c) {
                break (index, utf16);
            }
            utf16 += c.len_utf16();
            chars.next();
        };
        let mut end_byte = start_byte;
        let mut end16 = start16;
        while let Some(&(index, c)) = chars.peek() {
            if !is_word_char(c) {
                break;
            }
            utf16 += c.len_utf16();
            chars.next();
            // An apostrophe only counts if a letter follows it.
            if !is_apostrophe(c) {
                end_byte = index + c.len_utf8();
                end16 = utf16;
            }
        }
        let raw = &text[start_byte..end_byte];
        if worth_checking(raw) {
            return Some(Word {
                start: start16,
                end: end16,
                normalized: raw.replace('\u{2019}', "'"),
            });
        }
    })
}

fn is_apostrophe(c: char) -> bool {
    c == '\'' || c == '\u{2019}'
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || is_apostrophe(c)
}

fn worth_checking(word: &str) -> bool {
    let mut letters = 0;
    let mut upper = 0;
    for (i, c) in word.chars().enumerate() {
        if c.is_numeric() || c == '_' {
            return false;
        }
        if c.is_uppercase() {
            if i > 0 && upper == 0 {
                return false; // camelCase, iPhone
            }
            upper += 1;
        }
        if c.is_alphabetic() {
            letters += 1;
        }
    }
    // Single letters and ALL-CAPS acronyms.
    letters >= 2 && !(upper > 1 && upper == letters)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spans(text: &str) -> Vec<&str> {
        let units: Vec<u16> = text.encode_utf16().collect();
        words(text)
            .map(|w| {
                let s = String::from_utf16(&units[w.start..w.end]).unwrap();
                Box::leak(s.into_boxed_str()) as &str
            })
            .collect()
    }

    #[test]
    fn splits_words_and_keeps_inner_apostrophes() {
        assert_eq!(
            spans("Don't stop—the dog’s 'quoted' bone."),
            ["Don't", "stop", "the", "dog’s", "quoted", "bone"]
        );
    }

    #[test]
    fn skips_codes_acronyms_and_mixed_case() {
        assert_eq!(spans("NASA iPhone x2 a_b I go"), ["go"]);
    }

    #[test]
    fn offsets_are_utf16() {
        let w: Vec<Word> = words("😀 héllo").collect();
        assert_eq!(w.len(), 1);
        assert_eq!((w[0].start, w[0].end), (3, 8));
    }

    #[test]
    fn bundled_dictionary_flags_typos_only() {
        let state = SpellState::default();
        let started = Instant::now();
        let results = state.check_bundled(&["Teh quick brown fox isn't jumpping.".to_string()]);
        eprintln!("first bundled check (incl. load): {:?}", started.elapsed());
        let flagged: Vec<(usize, usize)> = results[0].iter().map(|i| (i.start, i.end)).collect();
        assert_eq!(flagged, [(0, 3), (26, 34)]);
        assert!(state.suggest("jumpping").iter().any(|s| s == "jumping"));
    }
}
