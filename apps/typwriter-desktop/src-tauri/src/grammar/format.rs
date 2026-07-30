//! Decides which Harper parser — if any — a file gets.
//!
//! The rule is Typst's own import surface: a file is checked when its contents
//! can end up rendered in a document. That covers Typst markup itself, the
//! prose formats a project keeps alongside it, and the data formats Typst can
//! read natively (`#json`, `#yaml`, `#toml`, `#csv`, `#xml`,
//! `#bibliography`). Source code is never checked — a `.rs` or `.py` file in
//! the workspace is tooling, not prose, and running a grammar checker over it
//! produces nothing but noise.

use harper_core::parsers::{Markdown, MarkdownOptions, Mask, Parser, PlainEnglish};

use super::maskers::{DataFormat, DataMasker};
use super::typst_parser::Typst;

/// How a file's text should be read for grammar checking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckedFormat {
    /// Typst markup, via our own parser.
    Typst,
    /// CommonMark.
    Markdown,
    /// The whole file is prose.
    PlainText,
    /// Structured data — only the prose-bearing parts are read.
    Data(DataFormat),
}

impl CheckedFormat {
    /// Resolve a file's format from its path. `None` means "don't check this
    /// file at all".
    pub fn from_path(path: &str) -> Option<Self> {
        let name = path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(path)
            .to_ascii_lowercase();
        let extension = name.rsplit_once('.').map(|(_, ext)| ext)?;

        Some(match extension {
            "typ" => Self::Typst,
            "md" | "markdown" | "mkd" | "mdown" => Self::Markdown,
            "txt" | "text" => Self::PlainText,
            "json" | "jsonc" => Self::Data(DataFormat::Json),
            // `.yml` doubles as Typst's Hayagriva bibliography format; the
            // YAML masker handles both.
            "yaml" | "yml" => Self::Data(DataFormat::Yaml),
            "toml" => Self::Data(DataFormat::Toml),
            "csv" | "tsv" => Self::Data(DataFormat::Csv),
            "xml" => Self::Data(DataFormat::Xml),
            "bib" => Self::Data(DataFormat::BibTex),
            _ => return None,
        })
    }

    /// Build the Harper parser for this format.
    pub fn parser(self) -> Box<dyn Parser> {
        match self {
            Self::Typst => Box::new(Typst),
            Self::Markdown => Box::new(Markdown::new(MarkdownOptions::default())),
            Self::PlainText => Box::new(PlainEnglish),
            Self::Data(format) => Box::new(Mask::new(DataMasker::new(format), PlainEnglish)),
        }
    }

    /// A short label for the UI ("Typst", "JSON", …).
    pub fn label(self) -> &'static str {
        match self {
            Self::Typst => "Typst",
            Self::Markdown => "Markdown",
            Self::PlainText => "Plain text",
            Self::Data(DataFormat::Json) => "JSON",
            Self::Data(DataFormat::Yaml) => "YAML",
            Self::Data(DataFormat::Toml) => "TOML",
            Self::Data(DataFormat::Csv) => "CSV",
            Self::Data(DataFormat::Xml) => "XML",
            Self::Data(DataFormat::BibTex) => "BibTeX",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typst_and_prose_formats_are_recognized() {
        assert_eq!(
            CheckedFormat::from_path("main.typ"),
            Some(CheckedFormat::Typst)
        );
        assert_eq!(
            CheckedFormat::from_path("README.md"),
            Some(CheckedFormat::Markdown)
        );
        assert_eq!(
            CheckedFormat::from_path("notes.TXT"),
            Some(CheckedFormat::PlainText)
        );
    }

    #[test]
    fn typst_readable_data_formats_are_recognized() {
        assert_eq!(
            CheckedFormat::from_path("refs.bib"),
            Some(CheckedFormat::Data(DataFormat::BibTex))
        );
        assert_eq!(
            CheckedFormat::from_path("data/works.yml"),
            Some(CheckedFormat::Data(DataFormat::Yaml))
        );
        assert_eq!(
            CheckedFormat::from_path(r"C:\proj\data\table.csv"),
            Some(CheckedFormat::Data(DataFormat::Csv))
        );
    }

    #[test]
    fn source_code_is_never_checked() {
        for path in [
            "src/lib.rs",
            "script.py",
            "app.ts",
            "index.html",
            "style.css",
            "Makefile",
            "main.c",
            ".gitignore",
        ] {
            assert_eq!(
                CheckedFormat::from_path(path),
                None,
                "{path} should be skipped"
            );
        }
    }

    #[test]
    fn dotfiles_without_an_extension_are_skipped() {
        // `.gitignore`'s "extension" is the whole name — it must not be read
        // as a checkable format.
        assert_eq!(CheckedFormat::from_path(".bashrc"), None);
        assert_eq!(CheckedFormat::from_path("LICENSE"), None);
    }
}
