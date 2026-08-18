// Which files the app treats as text.
//
// Shared by `read_file` (deciding whether a tab gets an editor or a file-info
// card) and project-wide search (deciding what is worth opening at all). One
// list, because two would drift and a file would become searchable but not
// openable, or the reverse.

/// Whether a lowercase extension names a text format.
///
/// Extension-based rather than content-sniffing: it has to answer for every
/// file in a workspace walk, and a mis-classified exotic extension costs a
/// missed search hit, not corruption.
pub fn is_text_extension(ext: &str) -> bool {
    matches!(
        ext,
        // documents / data / config
        "typ" | "txt" | "md" | "markdown" | "rst" | "adoc" | "org" | "bib"
            | "tex" | "sty" | "cls" | "json" | "jsonc" | "json5" | "toml"
            | "yaml" | "yml" | "xml" | "csv" | "tsv" | "ini" | "cfg" | "conf"
            | "env" | "properties" | "log" | "lock" | "diff" | "patch"
            | "gitignore" | "gitattributes" | "editorconfig"
        // web
            | "html" | "htm" | "css" | "scss" | "sass" | "less" | "styl"
            | "js" | "mjs" | "cjs" | "ts" | "mts" | "cts" | "jsx" | "tsx"
            | "vue" | "svelte" | "astro" | "graphql" | "gql"
        // systems / general-purpose
            | "rs" | "c" | "h" | "cpp" | "hpp" | "cc" | "hh" | "cxx" | "hxx"
            | "cs" | "java" | "kt" | "kts" | "go" | "swift" | "m" | "mm"
            | "zig" | "d" | "nim" | "pas" | "asm" | "s"
        // scripting
            | "py" | "pyw" | "rb" | "php" | "pl" | "pm" | "lua" | "sh"
            | "bash" | "zsh" | "fish" | "ps1" | "psm1" | "psd1" | "bat"
            | "cmd" | "r" | "jl" | "tcl" | "groovy" | "gradle"
        // functional
            | "hs" | "ml" | "mli" | "fs" | "fsx" | "fsi" | "clj" | "cljs"
            | "cljc" | "edn" | "elm" | "erl" | "ex" | "exs" | "scala" | "sc"
            | "lisp" | "el" | "scm" | "rkt"
        // query / build / misc
            | "sql" | "proto" | "cmake" | "mk" | "dockerfile" | "nix" | "sol"
            | "vb" | "dart" | "v" | "sv" | "svh" | "vhd" | "vhdl"
    )
}

#[cfg(test)]
mod tests {
    use super::is_text_extension;

    #[test]
    fn recognises_the_formats_typst_projects_are_made_of() {
        for ext in ["typ", "bib", "csv", "json", "toml", "yaml", "md"] {
            assert!(is_text_extension(ext), "{ext} should be text");
        }
    }

    #[test]
    fn rejects_binary_formats() {
        for ext in ["pdf", "png", "jpg", "woff2", "zip", "exe", "docx"] {
            assert!(!is_text_extension(ext), "{ext} should not be text");
        }
    }

    #[test]
    fn rejects_an_empty_extension() {
        // Extensionless files (LICENSE, Makefile) are not opened as text: the
        // allowlist is the whole mechanism, and guessing costs more than it
        // saves.
        assert!(!is_text_extension(""));
    }

    #[test]
    fn is_case_sensitive_and_expects_lowercase() {
        // Callers lowercase first; this documents that they must.
        assert!(is_text_extension("typ"));
        assert!(!is_text_extension("TYP"));
    }
}
