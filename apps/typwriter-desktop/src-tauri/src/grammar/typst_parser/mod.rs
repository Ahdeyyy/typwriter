//! A Harper [`Parser`] for Typst source.
//!
//! Written against the `typst-syntax` version this app pins rather than
//! depending on `harper-typst`, so upgrading Typst here never waits on an
//! upstream release. See [`translator`] for the node-by-node mapping.

mod offsets;
mod translator;

use harper_core::parsers::Parser;
use harper_core::Token;
use typst_syntax::ast::{AstNode, Markup};
use typst_syntax::Source;

use translator::Translator;

/// Lexes Typst markup into Harper tokens, treating code, math, and raw blocks
/// as unlintable holes.
pub struct Typst;

impl Parser for Typst {
    fn parse(&self, source: &[char]) -> Vec<Token> {
        let text: String = source.iter().collect();
        let document = Source::detached(text);

        // `parse` always yields a `Markup` root, but the cast is fallible and
        // this runs on half-typed buffers — degrade to "nothing to check"
        // rather than panicking in a Tauri command.
        let Some(markup) = Markup::from_untyped(document.root()) else {
            return Vec::new();
        };

        Translator::new(&document).translate(markup)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use harper_core::parsers::StrParser;
    use harper_core::{Punctuation, TokenKind};

    fn kinds(source: &str) -> Vec<TokenKind> {
        Typst
            .parse_str(source)
            .into_iter()
            .map(|t| t.kind)
            .collect()
    }

    fn text_of(source: &str) -> Vec<String> {
        let chars: Vec<char> = source.chars().collect();
        Typst
            .parse(&chars)
            .into_iter()
            .filter(|t| t.kind.is_word())
            .map(|t| t.span.get_content_string(&chars))
            .collect()
    }

    /// Every token must sit at or after the end of the one before it: Harper
    /// segments the stream positionally and silently misbehaves otherwise.
    fn assert_ordered(source: &str) {
        let tokens = Typst.parse_str(source);
        for pair in tokens.windows(2) {
            assert!(
                pair[0].span.end <= pair[1].span.start,
                "tokens out of order in {source:?}: {:?} then {:?}",
                pair[0],
                pair[1],
            );
        }
    }

    /// No token may point past the end of the source.
    fn assert_in_bounds(source: &str) {
        let len = source.chars().count();
        for token in Typst.parse_str(source) {
            assert!(
                token.span.end <= len,
                "token {token:?} out of bounds in {source:?} (len {len})",
            );
        }
    }

    #[test]
    fn plain_markup_is_prose() {
        assert_eq!(text_of("Hello world"), vec!["Hello", "world"]);
    }

    #[test]
    fn strong_and_emph_bodies_are_prose() {
        assert_eq!(
            text_of("*Bold* and _italic_ text"),
            vec!["Bold", "and", "italic", "text"]
        );
    }

    #[test]
    fn code_and_math_are_holes() {
        // Neither the identifier nor the equation should reach the linters.
        assert_eq!(text_of("Value $x^2 + 1$ here"), vec!["Value", "here"]);
        assert_eq!(text_of("Before `raw code` after"), vec!["Before", "after"]);
    }

    #[test]
    fn contractions_survive_smart_quote_splitting() {
        // Typst lexes `don't` as Text/SmartQuote/Text; without the contraction
        // path Harper would see "don" and "t" as two misspelled words.
        assert_eq!(text_of("I don't know"), vec!["I", "don't", "know"]);
    }

    #[test]
    fn double_quotes_stay_punctuation() {
        assert!(kinds(r#"He said "hi""#)
            .iter()
            .any(|kind| matches!(kind, TokenKind::Punctuation(Punctuation::Quote(_)))));
    }

    #[test]
    fn headings_are_fenced() {
        let kinds = kinds("= Introduction\n\nBody text.");
        assert_eq!(kinds.first(), Some(&TokenKind::HeadingStart));
        assert!(kinds.contains(&TokenKind::ParagraphBreak));
    }

    #[test]
    fn string_literals_are_checked_but_paths_are_not() {
        assert_eq!(
            text_of(r#"#let greeting = "Hello there""#),
            vec!["Hello", "there"]
        );
        // First positional argument of `#link` is a URL.
        assert_eq!(
            text_of(r#"#link("https://ex.com")[Read more]"#),
            vec!["Read", "more"]
        );
        // Colours and data loading are opaque all the way through.
        assert!(text_of(r##"#text(fill: rgb("#aabbcc"))[Body]"##).contains(&"Body".to_string()));
        assert_eq!(
            text_of(r#"#json("data with words.json")"#),
            Vec::<String>::new()
        );
    }

    #[test]
    fn named_arguments_carry_prose() {
        assert_eq!(
            text_of(r#"#figure(image("cat.png"), caption: [A sleeping cat])"#),
            vec!["A", "sleeping", "cat"]
        );
    }

    #[test]
    fn shorthands_map_to_punctuation() {
        assert!(kinds("one --- two").contains(&TokenKind::Punctuation(Punctuation::EmDash)));
        assert!(kinds("a~b").contains(&TokenKind::Space(1)));
    }

    #[test]
    fn multibyte_sources_keep_their_offsets() {
        let source = "Café — naïve *bold* here";
        let chars: Vec<char> = source.chars().collect();
        let tokens = Typst.parse(&chars);
        let bold = tokens
            .iter()
            .find(|t| t.span.get_content_string(&chars) == "bold")
            .expect("bold word token");
        assert_eq!(&source[..0], "");
        assert_eq!(bold.span.get_content_string(&chars), "bold");
        assert_in_bounds(source);
    }

    #[test]
    fn show_rules_keep_source_order() {
        assert_ordered(r#"#show "a": "b""#);
    }

    /// Mirrors harper's issue 1898: the parser must not panic on garbage.
    #[test]
    fn malformed_input_does_not_panic() {
        for source in [
            "#for ",
            "#(.$#$$$. ",
            "=#{m\"\".'m\"\"#p#",
            "#let",
            "$",
            "[[[[[[",
            "#(",
            "*unclosed",
            "#link(",
        ] {
            Typst.parse_str(source);
            assert_ordered(source);
            assert_in_bounds(source);
        }
    }

    #[test]
    fn deep_nesting_terminates() {
        let source = "[".repeat(1000) + &"]".repeat(1000);
        Typst.parse_str(&source);
        assert_in_bounds(&source);
    }

    #[test]
    fn realistic_document_is_ordered_and_in_bounds() {
        let source = r#"#set page(width: 10cm)
#let name = "World"

= Hello, #name!

Some *bold* and _emphatic_ text with a link: #link("https://typst.app")[the site].

- First item
- Second item

/ Term: A definition of the term.

$ sum_(i=1)^n i = (n(n+1))/2 $

#figure(
  image("chart.png", alt: "A bar chart"),
  caption: [Quarterly results],
)

```rust
fn main() {}
```
"#;
        assert_ordered(source);
        assert_in_bounds(source);
        let words = text_of(source);
        assert!(words.contains(&"emphatic".to_string()));
        assert!(words.contains(&"Quarterly".to_string()));
        // Code fence contents never reach the linters.
        assert!(!words.contains(&"main".to_string()));
    }
}
