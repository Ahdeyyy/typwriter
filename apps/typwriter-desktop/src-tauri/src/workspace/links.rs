// Keeping path links between project files alive across a rename or move.
//
// Typst projects point at each other through string literals: `#include
// "ch1.typ"`, `#image("figs/a.png")`, `#bibliography("refs.bib")`. Moving any
// of those files — or the file that holds the literal, since a relative path
// is resolved from its own directory — breaks the link. This module answers
// "which literals have to change, and to what?", nothing more: it never
// touches disk, so it is pure and testable, and the caller decides whether the
// edits are written, shown for review first, or dropped.
//
// Only literals in a *path position* are considered: the source of an
// `import`/`include`, the first argument of a file-loading function, and the
// few named arguments that take a path (`style:`, `theme:`, `syntaxes:`). A
// string bound with `#let` and passed on later is deliberately left alone —
// matching on any string that happens to name the moved file would be broader
// than the user asked for.
//
// The cost model matters as much as correctness: none of this runs until a
// rename happens, and a file is only parsed when it was itself moved or its
// bytes mention the name of something that was (see [`MoveSet::may_reference`]).

use std::collections::HashSet;
use std::ops::Range;

use serde::{Deserialize, Serialize};
use typst_syntax::ast::{self, AstNode, Expr};
use typst_syntax::{LinkedNode, SyntaxKind, SyntaxNode};

/// One entry moved from `from` to `to`, both workspace-relative with forward
/// slashes. A folder moves everything beneath it.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathMove {
    pub from: String,
    pub to: String,
    pub is_dir: bool,
}

/// One literal to replace, in the UTF-16 offsets the editor works in. The
/// texts are the literal's full source, quotes included (`"figs/a.png"`).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkEdit {
    pub start: usize,
    pub end: usize,
    pub old_text: String,
    pub new_text: String,
}

/// The edits for one file, keyed by its *current* (post-move) path.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileLinkUpdate {
    pub path: String,
    pub edits: Vec<LinkEdit>,
}

// ─── Moves ────────────────────────────────────────────────────────────────────

/// A sequence of moves, applied in order. Several moves arrive together when
/// the watcher reports a folder rename alongside the renames of its files, or
/// when more external renames land while a prompt for the first is still
/// open; composing them keeps every literal mapped to where its target ended
/// up rather than to an intermediate stop.
#[derive(Clone, Debug)]
pub struct MoveSet {
    moves: Vec<PathMove>,
}

impl MoveSet {
    pub fn new(moves: &[PathMove]) -> Self {
        let moves = moves
            .iter()
            .filter_map(|m| {
                let from = normalize(&m.from)?;
                let to = normalize(&m.to)?;
                (!from.is_empty() && !to.is_empty() && from != to).then_some(PathMove {
                    from,
                    to,
                    is_dir: m.is_dir,
                })
            })
            .collect();
        Self { moves }
    }

    pub fn is_empty(&self) -> bool {
        self.moves.is_empty()
    }

    /// Where something that used to live at `old` lives now.
    pub fn forward(&self, old: &str) -> String {
        self.moves
            .iter()
            .fold(old.to_string(), |path, m| remap(&path, &m.from, &m.to, m.is_dir))
    }

    /// Where something that lives at `current` used to live.
    pub fn backward(&self, current: &str) -> String {
        self.moves
            .iter()
            .rev()
            .fold(current.to_string(), |path, m| remap(&path, &m.to, &m.from, m.is_dir))
    }

    /// Whether `text` can hold a literal pointing at a moved entry.
    ///
    /// A literal reaching a moved file, or anything inside a moved folder, has
    /// to spell out that entry's old name: a relative path can only get into a
    /// folder through its name. The one exception is a file that moved itself
    /// — its relative literals change meaning without naming anything moved —
    /// which is why the caller checks that case first.
    ///
    /// A plain substring test, so the parse is skipped for nearly every file.
    pub fn may_reference(&self, text: &str) -> bool {
        self.moves
            .iter()
            .any(|m| text.contains(basename(&m.from)))
    }
}

/// `path` with the `from` prefix swapped for `to`, or unchanged when the move
/// doesn't cover it.
fn remap(path: &str, from: &str, to: &str, is_dir: bool) -> String {
    if path == from {
        return to.to_string();
    }
    if is_dir {
        if let Some(rest) = path.strip_prefix(from).and_then(|r| r.strip_prefix('/')) {
            return format!("{to}/{rest}");
        }
    }
    path.to_string()
}

// ─── Paths ────────────────────────────────────────────────────────────────────

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn dirname(path: &str) -> &str {
    path.rfind('/').map(|i| &path[..i]).unwrap_or("")
}

/// Collapse `.`, `..` and empty segments. `None` when the path climbs out of
/// the project — Typst refuses those, so they can never name a project file.
fn normalize(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    Some(parts.join("/"))
}

/// Resolve a literal the way Typst does: from the project root with a leading
/// `/`, otherwise from the directory of the file holding it.
///
/// Returns `None` for anything that isn't a project path: packages
/// (`@preview/…`), backslashes or drive letters (not portable, and never what
/// Typst means), and paths escaping the root.
fn resolve(file_dir: &str, literal: &str) -> Option<String> {
    if literal.is_empty()
        || literal.starts_with('@')
        || literal.contains('\\')
        || literal.contains(':')
    {
        return None;
    }
    let joined = match literal.strip_prefix('/') {
        Some(rooted) => rooted.to_string(),
        None if file_dir.is_empty() => literal.to_string(),
        None => format!("{file_dir}/{literal}"),
    };
    normalize(&joined).filter(|p| !p.is_empty())
}

/// The shortest relative path from directory `from_dir` to `target`.
fn relative(from_dir: &str, target: &str) -> String {
    let from: Vec<&str> = from_dir.split('/').filter(|s| !s.is_empty()).collect();
    let to: Vec<&str> = target.split('/').filter(|s| !s.is_empty()).collect();
    let shared = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; from.len() - shared];
    parts.extend_from_slice(&to[shared..]);
    parts.join("/")
}

/// Spell `target` for a file in `file_dir`, in the same style the original
/// literal used: rooted stays rooted, relative stays relative, and an explicit
/// `./` is kept.
fn spell_like(original: &str, file_dir: &str, target: &str) -> String {
    if original.starts_with('/') {
        return format!("/{target}");
    }
    let rel = relative(file_dir, target);
    if original.starts_with("./") && !rel.starts_with("../") {
        format!("./{rel}")
    } else {
        rel
    }
}

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

// ─── Finding path literals ────────────────────────────────────────────────────

/// A string literal sitting in a path position.
#[derive(Debug, PartialEq, Eq)]
struct PathLiteral {
    /// Byte range of the literal, quotes included.
    range: Range<usize>,
    /// The literal's value, unescaped.
    value: String,
}

/// Functions whose first positional argument is a path.
const PATH_FUNCTIONS: &[&str] = &[
    "image",
    "read",
    "json",
    "yaml",
    "toml",
    "csv",
    "xml",
    "cbor",
    "plugin",
    "bibliography",
    "pdf.attach",
    "pdf.embed",
];

/// Named arguments that take a path, per function. A built-in name in those
/// slots (`style: "ieee"`) resolves to no moved file, so it is never touched.
fn path_named_args(function: &str) -> &'static [&'static str] {
    match function {
        "bibliography" | "cite" => &["style"],
        "raw" => &["theme", "syntaxes"],
        _ => &[],
    }
}

/// The function a call or set rule targets, as written: `image`,
/// `pdf.attach`. `std.` is transparent.
fn callee_name(callee: Expr<'_>) -> Option<String> {
    match callee {
        Expr::Ident(ident) => Some(ident.as_str().to_string()),
        Expr::FieldAccess(access) => {
            let field = access.field().as_str();
            match access.target() {
                Expr::Ident(target) if target.as_str() == "std" => Some(field.to_string()),
                Expr::Ident(target) => Some(format!("{}.{field}", target.as_str())),
                Expr::FieldAccess(inner) => match (inner.target(), inner.field().as_str()) {
                    (Expr::Ident(std), module) if std.as_str() == "std" => {
                        Some(format!("{module}.{field}"))
                    }
                    _ => None,
                },
                _ => None,
            }
        }
        _ => None,
    }
}

/// Every string literal `expr` holds directly: itself, or the items of an
/// array (`bibliography(("a.bib", "b.bib"))`).
fn mark_strings(expr: Expr<'_>, marked: &mut HashSet<*const SyntaxNode>) {
    match expr {
        Expr::Str(s) => {
            marked.insert(s.to_untyped() as *const SyntaxNode);
        }
        Expr::Array(array) => {
            for item in array.items() {
                if let ast::ArrayItem::Pos(Expr::Str(s)) = item {
                    marked.insert(s.to_untyped() as *const SyntaxNode);
                }
            }
        }
        _ => {}
    }
}

fn mark_args(function: &str, args: ast::Args<'_>, marked: &mut HashSet<*const SyntaxNode>) {
    let named = path_named_args(function);
    let takes_path = PATH_FUNCTIONS.contains(&function);
    let mut first_positional = true;
    for arg in args.items() {
        match arg {
            ast::Arg::Pos(expr) => {
                if first_positional && takes_path {
                    mark_strings(expr, marked);
                }
                first_positional = false;
            }
            ast::Arg::Named(pair) if named.contains(&pair.name().as_str()) => {
                mark_strings(pair.expr(), marked);
            }
            _ => {}
        }
    }
}

/// Every string literal in a path position, in source order.
///
/// One pre-order walk: a call node is always visited before its arguments, so
/// it can mark which `Str` nodes beneath it are paths, and the walk records
/// their offsets when it reaches them. Comments, raw blocks and markup text
/// are never `Str` nodes, so they can't match.
fn path_literals(text: &str) -> Vec<PathLiteral> {
    let root = typst_syntax::parse(text);
    let mut marked = HashSet::new();
    let mut out = Vec::new();
    visit(&LinkedNode::new(&root), &mut marked, &mut out);
    out
}

fn visit(
    node: &LinkedNode<'_>,
    marked: &mut HashSet<*const SyntaxNode>,
    out: &mut Vec<PathLiteral>,
) {
    let raw = node.get();
    match raw.kind() {
        SyntaxKind::ModuleImport => {
            if let Some(import) = raw.cast::<ast::ModuleImport>() {
                mark_strings(import.source(), marked);
            }
        }
        SyntaxKind::ModuleInclude => {
            if let Some(include) = raw.cast::<ast::ModuleInclude>() {
                mark_strings(include.source(), marked);
            }
        }
        SyntaxKind::FuncCall => {
            if let Some(call) = raw.cast::<ast::FuncCall>() {
                if let Some(name) = callee_name(call.callee()) {
                    mark_args(&name, call.args(), marked);
                }
            }
        }
        SyntaxKind::SetRule => {
            if let Some(rule) = raw.cast::<ast::SetRule>() {
                if let Some(name) = callee_name(rule.target()) {
                    mark_args(&name, rule.args(), marked);
                }
            }
        }
        SyntaxKind::Str if marked.contains(&(raw as *const SyntaxNode)) => {
            if let Some(s) = raw.cast::<ast::Str>() {
                out.push(PathLiteral {
                    range: node.range(),
                    value: s.get().to_string(),
                });
            }
            return;
        }
        _ => {}
    }
    for child in node.children() {
        visit(&child, marked, out);
    }
}

// ─── Planning ─────────────────────────────────────────────────────────────────

/// A planned replacement in byte offsets.
#[derive(Debug, PartialEq, Eq)]
pub struct ByteEdit {
    pub range: Range<usize>,
    pub old_text: String,
    pub new_text: String,
}

/// The literals in `text` — the file now at `current_path` — that the moves
/// broke, with their replacements.
///
/// Each literal is resolved against the layout *before* the moves (from the
/// file's old directory), carried through the moves, and re-spelled from the
/// file's new directory. A literal whose target didn't exist is left as it
/// was: this repairs links that were working, it doesn't guess at ones that
/// already weren't. `exists` answers for the current layout.
pub fn plan_file(
    current_path: &str,
    text: &str,
    moves: &MoveSet,
    exists: impl Fn(&str) -> bool,
) -> Vec<ByteEdit> {
    let old_path = moves.backward(current_path);
    let file_moved = old_path != current_path;
    if !file_moved && !moves.may_reference(text) {
        return Vec::new();
    }
    let old_dir = dirname(&old_path);
    let new_dir = dirname(current_path);

    let mut edits = Vec::new();
    for literal in path_literals(text) {
        let source = &text[literal.range.clone()];
        // Escapes would have to be re-encoded exactly; paths never need them,
        // so a literal that has them is someone else's business.
        if source.contains('\\') {
            continue;
        }
        let Some(old_target) = resolve(old_dir, &literal.value) else {
            continue;
        };
        let new_target = moves.forward(&old_target);
        if !file_moved && new_target == old_target {
            continue;
        }
        if !exists(&new_target) {
            continue;
        }
        let replacement = quote(&spell_like(&literal.value, new_dir, &new_target));
        if replacement != source {
            edits.push(ByteEdit {
                range: literal.range,
                old_text: source.to_string(),
                new_text: replacement,
            });
        }
    }
    edits
}

// ─── Offsets ──────────────────────────────────────────────────────────────────

/// Convert byte edits (ascending, non-overlapping — as `plan_file` returns
/// them) into the UTF-16 offsets the frontend uses, in one pass over `text`.
pub fn to_utf16_edits(text: &str, edits: Vec<ByteEdit>) -> Vec<LinkEdit> {
    let mut out = Vec::with_capacity(edits.len());
    let mut byte = 0;
    let mut unit = 0;
    let mut advance = |target: usize| {
        unit += text[byte..target].encode_utf16().count();
        byte = target;
        unit
    };
    for edit in edits {
        let start = advance(edit.range.start);
        let end = advance(edit.range.end);
        out.push(LinkEdit {
            start,
            end,
            old_text: edit.old_text,
            new_text: edit.new_text,
        });
    }
    out
}

/// The byte offset of UTF-16 offset `unit` in `text`, if it falls on a char
/// boundary within the text.
fn utf16_to_byte(text: &str, unit: usize) -> Option<usize> {
    let mut seen = 0;
    for (byte, ch) in text.char_indices() {
        if seen == unit {
            return Some(byte);
        }
        if seen > unit {
            return None;
        }
        seen += ch.len_utf16();
    }
    (seen == unit).then_some(text.len())
}

/// `text` with `edits` applied, or `None` when any edit no longer matches —
/// the range doesn't hold its `old_text` because the file changed after the
/// plan was made. All or nothing: half a file's links updated is worse than
/// none, because the user can no longer tell which ones still need fixing.
pub fn apply_edits(text: &str, edits: &[LinkEdit]) -> Option<String> {
    let mut ranges = Vec::with_capacity(edits.len());
    for edit in edits {
        let start = utf16_to_byte(text, edit.start)?;
        let end = utf16_to_byte(text, edit.end)?;
        if start > end || text.get(start..end)? != edit.old_text {
            return None;
        }
        ranges.push((start, end, edit.new_text.as_str()));
    }
    ranges.sort_by_key(|(start, _, _)| *start);
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return None;
    }

    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    for (start, end, replacement) in ranges {
        out.push_str(&text[cursor..start]);
        out.push_str(replacement);
        cursor = end;
    }
    out.push_str(&text[cursor..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mv(from: &str, to: &str, is_dir: bool) -> PathMove {
        PathMove {
            from: from.into(),
            to: to.into(),
            is_dir,
        }
    }

    /// Plan against a layout where every path exists, and apply the result.
    fn rewrite(current_path: &str, text: &str, moves: &[PathMove]) -> String {
        let moves = MoveSet::new(moves);
        let edits = to_utf16_edits(text, plan_file(current_path, text, &moves, |_| true));
        apply_edits(text, &edits).expect("planned edits apply")
    }

    #[test]
    fn finds_literals_only_in_path_positions() {
        let text = r#"#import "a.typ": x
#include "b.typ"
#image("c.png", width: 50%)
#let p = "not-a-path.png"
// #image("commented.png")
`#image("raw.png")`
Plain "quoted.png" text.
#bibliography(("d.bib", "e.bib"), style: "f.csl")
#set raw(theme: "g.tmTheme")
#pdf.attach("h.txt")
#figure(image("nested.png"))
"#;
        let values: Vec<String> = path_literals(text).into_iter().map(|l| l.value).collect();
        assert_eq!(
            values,
            [
                "a.typ",
                "b.typ",
                "c.png",
                "d.bib",
                "e.bib",
                "f.csl",
                "g.tmTheme",
                "h.txt",
                "nested.png"
            ]
        );
    }

    #[test]
    fn only_the_first_positional_argument_is_a_path() {
        let values: Vec<String> = path_literals(r#"#image("a.png", alt: "b.png")"#)
            .into_iter()
            .map(|l| l.value)
            .collect();
        assert_eq!(values, ["a.png"]);
    }

    #[test]
    fn updates_incoming_links_to_a_renamed_file() {
        let text = "#include \"ch1.typ\"\n#include \"ch2.typ\"\n";
        assert_eq!(
            rewrite("main.typ", text, &[mv("ch1.typ", "intro.typ", false)]),
            "#include \"intro.typ\"\n#include \"ch2.typ\"\n"
        );
    }

    #[test]
    fn updates_links_into_a_moved_folder() {
        let text = "#image(\"figs/a.png\")\n#image(\"/figs/b.png\")\n";
        assert_eq!(
            rewrite("main.typ", text, &[mv("figs", "assets/figures", true)]),
            "#image(\"assets/figures/a.png\")\n#image(\"/assets/figures/b.png\")\n"
        );
    }

    #[test]
    fn updates_outgoing_relative_links_of_a_moved_file() {
        // ch1.typ moved into chapters/: its relative links now start one
        // folder deeper, its rooted ones are unaffected.
        let text = "#image(\"figs/a.png\")\n#image(\"/figs/b.png\")\n";
        assert_eq!(
            rewrite("chapters/ch1.typ", text, &[mv("ch1.typ", "chapters/ch1.typ", false)]),
            "#image(\"../figs/a.png\")\n#image(\"/figs/b.png\")\n"
        );
    }

    #[test]
    fn links_inside_a_moved_folder_are_left_alone() {
        let text = "#include \"sibling.typ\"\n#image(\"../figs/a.png\")\n";
        assert_eq!(
            rewrite("book/chapters/a.typ", text, &[mv("chapters", "book/chapters", true)]),
            "#include \"sibling.typ\"\n#image(\"../../figs/a.png\")\n"
        );
    }

    #[test]
    fn keeps_an_explicit_dot_slash() {
        let text = "#include \"./ch1.typ\"";
        assert_eq!(
            rewrite("main.typ", text, &[mv("ch1.typ", "chapters/ch1.typ", false)]),
            "#include \"./chapters/ch1.typ\""
        );
    }

    #[test]
    fn leaves_already_broken_links_alone() {
        let text = "#image(\"missing.png\")";
        let moves = MoveSet::new(&[mv("main.typ", "sub/main.typ", false)]);
        assert!(plan_file("sub/main.typ", text, &moves, |_| false).is_empty());
    }

    #[test]
    fn ignores_packages_and_files_that_dont_mention_the_move() {
        let moves = MoveSet::new(&[mv("ch1.typ", "intro.typ", false)]);
        let text = "#import \"@preview/cetz:0.3.0\": canvas\n#include \"ch2.typ\"";
        assert!(plan_file("main.typ", text, &moves, |_| true).is_empty());
    }

    #[test]
    fn skips_literals_with_escapes() {
        let moves = MoveSet::new(&[mv("a\"b.typ", "c.typ", false)]);
        assert!(plan_file("main.typ", "#include \"a\\\"b.typ\"", &moves, |_| true).is_empty());
    }

    #[test]
    fn composes_sequential_moves() {
        let moves = [mv("a.typ", "b.typ", false), mv("b.typ", "c/b.typ", false)];
        assert_eq!(rewrite("main.typ", "#include \"a.typ\"", &moves), "#include \"c/b.typ\"");
    }

    #[test]
    fn a_folder_move_reported_with_its_files_is_not_applied_twice() {
        let moves = [mv("old", "new", true), mv("old/x.typ", "new/x.typ", false)];
        assert_eq!(rewrite("main.typ", "#include \"old/x.typ\"", &moves), "#include \"new/x.typ\"");
        let set = MoveSet::new(&moves);
        assert_eq!(set.backward("new/x.typ"), "old/x.typ");
    }

    #[test]
    fn offsets_are_utf16() {
        let text = "// é😀\n#image(\"a.png\")";
        let moves = MoveSet::new(&[mv("a.png", "b.png", false)]);
        let edits = to_utf16_edits(text, plan_file("main.typ", text, &moves, |_| true));
        assert_eq!(edits.len(), 1);
        let prefix: usize = "// é😀\n#image(".encode_utf16().count();
        assert_eq!(edits[0].start, prefix);
        assert_eq!(edits[0].end, prefix + "\"a.png\"".len());
        assert_eq!(apply_edits(text, &edits).unwrap(), "// é😀\n#image(\"b.png\")");
    }

    #[test]
    fn stale_edits_are_refused() {
        let edits = [LinkEdit {
            start: 7,
            end: 14,
            old_text: "\"a.png\"".into(),
            new_text: "\"b.png\"".into(),
        }];
        assert!(apply_edits("#image(\"a.png\")", &edits).is_some());
        assert!(apply_edits("#image(\"x.png\")", &edits).is_none());
        assert!(apply_edits("#im", &edits).is_none());
    }

    #[test]
    fn relative_paths() {
        assert_eq!(relative("", "a/b.typ"), "a/b.typ");
        assert_eq!(relative("a", "a/b.typ"), "b.typ");
        assert_eq!(relative("a/c", "a/b.typ"), "../b.typ");
        assert_eq!(relative("x/y", "a.typ"), "../../a.typ");
    }

    #[test]
    fn resolution_follows_typst() {
        assert_eq!(resolve("ch", "a.typ").as_deref(), Some("ch/a.typ"));
        assert_eq!(resolve("ch", "/a.typ").as_deref(), Some("a.typ"));
        assert_eq!(resolve("ch", "../a.typ").as_deref(), Some("a.typ"));
        assert_eq!(resolve("", "../a.typ"), None);
        assert_eq!(resolve("", "@preview/x:1.0.0"), None);
    }
}
