//! Walks a Typst syntax tree and emits Harper tokens.
//!
//! The shape of the translation follows `harper-typst` upstream — markup
//! becomes prose, code becomes [`TokenKind::Unlintable`] holes — but the
//! mechanics are our own so the checker tracks whichever `typst-syntax` this
//! app pins rather than whichever one Harper happens to release against.
//!
//! Two rules govern everything here:
//!
//! 1. **Tokens are emitted in ascending source order.** Harper's `Document`
//!    condenses and segments the token stream positionally, so a node must
//!    never be visited before one that precedes it in the file.
//! 2. **A node is either summarized or recursed into, never both.** Emitting a
//!    token that spans a region we also descend into produces overlapping
//!    tokens, which corrupts sentence detection.
//!
//! Where we knowingly diverge from upstream it is called out in a comment.

use std::cell::Cell;

use harper_core::parsers::{PlainEnglish, StrParser};
use harper_core::{Punctuation, Quote, Span as CharSpan, Token, TokenKind};
use typst_syntax::ast::{self, AstNode, Expr};
use typst_syntax::{Source, Span};

use super::offsets::SourceMap;

/// Ceiling on AST recursion. Real documents nest a handful of levels deep;
/// this only ever trips on adversarial or half-typed input, where bailing out
/// beats overflowing the stack.
const MAX_DEPTH: u32 = 256;

/// Calls whose arguments never contain prose: colors, data loading, citations,
/// and code-ish builtins. Descending into them is pure false-positive
/// generation, so the whole argument list collapses to one unlintable hole.
const OPAQUE_CALLS: &[&str] = &[
    "assert",
    "bibliography",
    "bytes",
    "cbor",
    "cite",
    "cmyk",
    "color",
    "csv",
    "datetime",
    "decimal",
    "eval",
    "float",
    "gradient",
    "int",
    "label",
    "luma",
    "oklab",
    "oklch",
    "panic",
    "pattern",
    "plugin",
    "raw",
    "read",
    "ref",
    "regex",
    "repr",
    "rgb",
    "str",
    "symbol",
    "tiling",
    "toml",
    "type",
    "version",
    "xml",
    "yaml",
    "json",
];

/// Calls whose *first positional* argument is a path or URL but whose
/// remaining arguments carry prose — `#link("...")[Read more]`,
/// `#image("cat.png", alt: "A cat")`.
const OPAQUE_FIRST_ARG: &[&str] = &["image", "link"];

/// Namespaces whose every member is opaque.
const OPAQUE_NAMESPACES: &[&str] = &["calc", "sys", "std.calc"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArgPolicy {
    /// Recurse into every argument.
    Prose,
    /// Recurse into everything but the first positional argument.
    SkipFirstPositional,
    /// Emit one unlintable token for the entire argument list.
    Opaque,
}

pub struct Translator<'a> {
    map: SourceMap<'a>,
    depth: Cell<u32>,
}

impl<'a> Translator<'a> {
    pub fn new(source: &'a Source) -> Self {
        Self {
            map: SourceMap::new(source),
            depth: Cell::new(0),
        }
    }

    /// Translate a document's top-level markup.
    pub fn translate(&self, markup: ast::Markup<'a>) -> Vec<Token> {
        let mut out = Vec::new();
        self.markup(markup, &mut out);
        out
    }

    // ── Emission helpers ─────────────────────────────────────────────────

    /// Emit one token covering `span`. Silently drops spans we can't resolve
    /// (synthesized or detached nodes), which is how malformed input degrades
    /// instead of panicking.
    fn push(&self, span: Span, kind: TokenKind, out: &mut Vec<Token>) {
        if let Some(span) = self.map.char_span(span) {
            out.push(Token::new(span, kind));
        }
    }

    /// Emit a zero-width marker at the start of `span`.
    fn push_at_start(&self, span: Span, kind: TokenKind, out: &mut Vec<Token>) {
        if let Some(span) = self.map.char_span_at_start(span) {
            out.push(Token::new(span, kind));
        }
    }

    /// Emit a zero-width marker at the end of `span`.
    fn push_at_end(&self, span: Span, kind: TokenKind, out: &mut Vec<Token>) {
        if let Some(span) = self.map.char_span_at_end(span) {
            out.push(Token::new(span, kind));
        }
    }

    /// Run a stretch of raw source text through Harper's English lexer and
    /// rebase the resulting spans onto the whole document.
    fn english(&self, text: &str, char_offset: usize, out: &mut Vec<Token>) {
        for mut token in PlainEnglish.parse_str(text) {
            token.span =
                CharSpan::new(token.span.start + char_offset, token.span.end + char_offset);
            out.push(token);
        }
    }

    /// Parse the source text a span covers as English.
    fn english_span(&self, span: Span, out: &mut Vec<Token>) {
        let Some(range) = self.map.byte_range(span) else {
            return;
        };
        let Some(text) = self.map.slice(range.clone()) else {
            return;
        };
        self.english(text, self.map.char_index(range.start), out);
    }

    // ── Markup ───────────────────────────────────────────────────────────

    fn markup(&self, markup: ast::Markup<'a>, out: &mut Vec<Token>) {
        let exprs: Vec<Expr<'a>> = markup.exprs().collect();
        self.markup_exprs(&exprs, out);
    }

    fn markup_exprs(&self, exprs: &[Expr<'a>], out: &mut Vec<Token>) {
        let mut i = 0;
        while i < exprs.len() {
            // `don't` lexes as Text / SmartQuote / Text. Left alone, Harper
            // sees three tokens and flags "don" and "t" as misspellings, so
            // the run is re-lexed as one English region.
            if self.try_contraction(exprs, i, out) {
                i += 3;
                continue;
            }
            self.expr(exprs[i], out);
            i += 1;
        }
    }

    fn try_contraction(&self, exprs: &[Expr<'a>], i: usize, out: &mut Vec<Token>) -> bool {
        let (Some(&lhs), Some(&quote), Some(&rhs)) =
            (exprs.get(i), exprs.get(i + 1), exprs.get(i + 2))
        else {
            return false;
        };
        let (Expr::Text(lhs), Expr::SmartQuote(quote), Expr::Text(rhs)) = (lhs, quote, rhs) else {
            return false;
        };
        if quote.double() {
            return false;
        }
        if !lhs
            .get()
            .chars()
            .next_back()
            .is_some_and(char::is_alphabetic)
            || !rhs.get().chars().next().is_some_and(char::is_alphabetic)
        {
            return false;
        }

        let (Some(start), Some(end)) = (
            self.map.byte_range(lhs.span()).map(|r| r.start),
            self.map.byte_range(rhs.span()).map(|r| r.end),
        ) else {
            return false;
        };
        let Some(text) = self.map.slice(start..end) else {
            return false;
        };

        self.english(text, self.map.char_index(start), out);
        true
    }

    // ── Expressions ──────────────────────────────────────────────────────

    fn expr(&self, expr: Expr<'a>, out: &mut Vec<Token>) {
        if self.depth.get() >= MAX_DEPTH {
            self.push(expr.span(), TokenKind::Unlintable, out);
            return;
        }
        self.depth.set(self.depth.get() + 1);
        self.expr_inner(expr, out);
        self.depth.set(self.depth.get() - 1);
    }

    fn expr_inner(&self, expr: Expr<'a>, out: &mut Vec<Token>) {
        match expr {
            // ── Prose ────────────────────────────────────────────────────
            Expr::Text(text) => self.english_span(text.span(), out),
            Expr::Space(space) => self.space(space, out),
            Expr::Linebreak(node) => self.push(node.span(), TokenKind::Newline(1), out),
            Expr::Parbreak(node) => self.push(node.span(), TokenKind::ParagraphBreak, out),
            Expr::Shorthand(node) => self.shorthand(node, out),
            Expr::SmartQuote(quote) => {
                let kind = if quote.double() {
                    Punctuation::Quote(Quote { twin_loc: None })
                } else {
                    Punctuation::Apostrophe
                };
                self.push(quote.span(), TokenKind::Punctuation(kind), out);
            }
            Expr::Strong(node) => self.markup(node.body(), out),
            Expr::Emph(node) => self.markup(node.body(), out),
            Expr::Link(node) => self.push(node.span(), TokenKind::Url, out),

            // ── Block-level markup ───────────────────────────────────────
            // Fenced the way Harper's own Markdown parser fences its blocks:
            // a `HeadingStart` marker opens a heading and a zero-width
            // `ParagraphBreak` closes each block. This replaces upstream's
            // trick of rewriting the whitespace around headings and list items
            // into paragraph breaks, and it lets Harper's heading-specific
            // rules (title casing, terminal punctuation) fire on Typst too.
            Expr::Heading(node) => {
                self.push_at_start(node.span(), TokenKind::HeadingStart, out);
                self.markup(node.body(), out);
                self.push_at_end(node.span(), TokenKind::ParagraphBreak, out);
            }
            Expr::ListItem(node) => self.block(node.span(), node.body(), out),
            Expr::EnumItem(node) => self.block(node.span(), node.body(), out),
            Expr::TermItem(node) => {
                self.markup(node.term(), out);
                self.markup(node.description(), out);
                self.push_at_end(node.span(), TokenKind::ParagraphBreak, out);
            }

            // ── Opaque leaves ────────────────────────────────────────────
            // Escapes stand for a single glyph, raw blocks are code, labels
            // and references are identifiers, and math is not English. All
            // collapse to holes the linters step over.
            Expr::Escape(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Raw(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Label(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Ref(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Equation(node) => self.push(node.span(), TokenKind::Unlintable, out),

            // Reachable only through a malformed tree — a well-formed one
            // wraps every math node in an `Equation`, which is already opaque.
            Expr::Math(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathText(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathIdent(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathFieldAccess(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathShorthand(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathAlignPoint(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathCall(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathDelimited(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathAttach(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathPrimes(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathFrac(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::MathRoot(node) => self.push(node.span(), TokenKind::Unlintable, out),

            // Identifiers and literals. Upstream surfaces dictionary keys and
            // field names as `Word`s; we don't — they're API names, and
            // spell-checking them is the loudest source of noise in a Typst
            // file.
            Expr::Ident(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::None(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Auto(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Bool(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Int(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Float(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::Numeric(node) => self.push(node.span(), TokenKind::Unlintable, out),

            // Paths, not prose.
            Expr::ModuleImport(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::ModuleInclude(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::LoopBreak(node) => self.push(node.span(), TokenKind::Unlintable, out),
            Expr::LoopContinue(node) => self.push(node.span(), TokenKind::Unlintable, out),

            // ── Code we descend into ─────────────────────────────────────
            Expr::Str(node) => self.string(node, out),
            Expr::CodeBlock(node) => self.code(node.body(), out),
            Expr::ContentBlock(node) => self.content_block(node, out),
            Expr::Parenthesized(node) => self.expr(node.expr(), out),
            Expr::Array(node) => {
                for item in node.items() {
                    match item {
                        ast::ArrayItem::Pos(expr) => self.expr(expr, out),
                        ast::ArrayItem::Spread(spread) => self.expr(spread.expr(), out),
                    }
                }
            }
            Expr::Dict(node) => {
                for item in node.items() {
                    match item {
                        ast::DictItem::Named(named) => {
                            self.push(named.name().span(), TokenKind::Unlintable, out);
                            self.expr(named.expr(), out);
                        }
                        ast::DictItem::Keyed(keyed) => {
                            self.expr(keyed.key(), out);
                            self.expr(keyed.expr(), out);
                        }
                        ast::DictItem::Spread(spread) => self.expr(spread.expr(), out),
                    }
                }
            }
            // Upstream leaves operators unlintable; descending costs nothing
            // and recovers prose from string concatenation like
            // `"Dear " + name + ","`.
            Expr::Unary(node) => self.expr(node.expr(), out),
            Expr::Binary(node) => {
                self.expr(node.lhs(), out);
                self.expr(node.rhs(), out);
            }
            Expr::FieldAccess(node) => {
                self.expr(node.target(), out);
                self.push(node.field().span(), TokenKind::Unlintable, out);
            }
            Expr::FuncCall(node) => self.func_call(node, out),
            Expr::Closure(node) => {
                if let Some(name) = node.name() {
                    self.push(name.span(), TokenKind::Unlintable, out);
                }
                for param in node.params().children() {
                    match param {
                        ast::Param::Pos(pattern) => self.pattern(pattern, out),
                        ast::Param::Named(named) => {
                            self.push(named.name().span(), TokenKind::Unlintable, out);
                            self.expr(named.expr(), out);
                        }
                        ast::Param::Spread(spread) => self.expr(spread.expr(), out),
                    }
                }
                self.expr(node.body(), out);
            }
            Expr::LetBinding(node) => {
                for binding in node.kind().bindings() {
                    self.push(binding.span(), TokenKind::Unlintable, out);
                }
                if let Some(init) = node.init() {
                    self.expr(init, out);
                }
            }
            Expr::DestructAssignment(node) => {
                self.pattern(node.pattern(), out);
                self.expr(node.value(), out);
            }
            // Source order is `set target(args) if condition`.
            Expr::SetRule(node) => {
                self.expr(node.target(), out);
                self.args(node.args(), ArgPolicy::Prose, out);
                if let Some(condition) = node.condition() {
                    self.expr(condition, out);
                }
            }
            Expr::ShowRule(node) => {
                if let Some(selector) = node.selector() {
                    self.expr(selector, out);
                }
                self.expr(node.transform(), out);
            }
            Expr::Contextual(node) => self.expr(node.body(), out),
            Expr::Conditional(node) => {
                self.expr(node.condition(), out);
                self.expr(node.if_body(), out);
                if let Some(else_body) = node.else_body() {
                    self.expr(else_body, out);
                }
            }
            Expr::WhileLoop(node) => {
                self.expr(node.condition(), out);
                self.expr(node.body(), out);
            }
            Expr::ForLoop(node) => {
                self.pattern(node.pattern(), out);
                self.expr(node.iterable(), out);
                self.expr(node.body(), out);
            }
            Expr::FuncReturn(node) => {
                if let Some(body) = node.body() {
                    self.expr(body, out);
                }
            }
        }
    }

    // ── Individual node kinds ────────────────────────────────────────────

    fn block(&self, span: Span, body: ast::Markup<'a>, out: &mut Vec<Token>) {
        self.markup(body, out);
        self.push_at_end(span, TokenKind::ParagraphBreak, out);
    }

    fn space(&self, space: ast::Space<'a>, out: &mut Vec<Token>) {
        let Some(range) = self.map.byte_range(space.span()) else {
            return;
        };
        let Some(text) = self.map.slice(range.clone()) else {
            return;
        };

        let newlines = text.chars().filter(|c| *c == '\n').count();
        let kind = if newlines > 0 {
            TokenKind::Newline(newlines)
        } else {
            TokenKind::Space(text.chars().count())
        };
        out.push(Token::new(self.map.char_span_of_bytes(range), kind));
    }

    /// Typst shorthands stand for a single Unicode codepoint. Mapping the ones
    /// that matter for prose — rather than blanking them like upstream does —
    /// keeps sentence and dash rules working across `~` and `---`.
    fn shorthand(&self, node: ast::Shorthand<'a>, out: &mut Vec<Token>) {
        let kind = match self.map.source_text(node.span()) {
            Some("~") => TokenKind::Space(1),
            Some("--") => TokenKind::Punctuation(Punctuation::EnDash),
            Some("---") => TokenKind::Punctuation(Punctuation::EmDash),
            Some("...") => TokenKind::Punctuation(Punctuation::Ellipsis),
            _ => TokenKind::Unlintable,
        };
        self.push(node.span(), kind, out);
    }

    /// Bracketed content is fenced off as its own paragraph. Without this a
    /// `#figure(caption: [A cat])` caption runs into the prose around the call
    /// and produces bogus sentence-level lints.
    fn content_block(&self, node: ast::ContentBlock<'a>, out: &mut Vec<Token>) {
        self.push_at_start(node.span(), TokenKind::ParagraphBreak, out);
        self.markup(node.body(), out);
        self.push_at_end(node.span(), TokenKind::ParagraphBreak, out);
    }

    fn code(&self, code: ast::Code<'a>, out: &mut Vec<Token>) {
        for expr in code.exprs() {
            self.expr(expr, out);
        }
    }

    /// String literals hold user-facing text often enough to be worth
    /// checking. The *raw* source slice is used rather than [`ast::Str::get`]
    /// because escape resolution changes the length, which would desync every
    /// span after it.
    fn string(&self, node: ast::Str<'a>, out: &mut Vec<Token>) {
        let Some(range) = self.map.byte_range(node.span()) else {
            return;
        };
        let Some(raw) = self.map.slice(range.clone()) else {
            return;
        };

        let open = usize::from(raw.starts_with('"'));
        let close = usize::from(raw.len() > open && raw.ends_with('"'));
        let inner = (range.start + open)..(range.end - close);
        if inner.start >= inner.end {
            return;
        }
        let Some(text) = self.map.slice(inner.clone()) else {
            return;
        };

        self.english(text, self.map.char_index(inner.start), out);
    }

    fn pattern(&self, pattern: ast::Pattern<'a>, out: &mut Vec<Token>) {
        match pattern {
            ast::Pattern::Normal(expr) => self.expr(expr, out),
            ast::Pattern::Placeholder(node) => self.push(node.span(), TokenKind::Unlintable, out),
            ast::Pattern::Parenthesized(node) => self.expr(node.expr(), out),
            ast::Pattern::Destructuring(node) => {
                for binding in node.bindings() {
                    self.push(binding.span(), TokenKind::Unlintable, out);
                }
            }
        }
    }

    fn func_call(&self, call: ast::FuncCall<'a>, out: &mut Vec<Token>) {
        let callee = call.callee();
        self.push(callee.span(), TokenKind::Unlintable, out);

        let policy = self
            .map
            .source_text(callee.span())
            .map_or(ArgPolicy::Prose, arg_policy);
        self.args(call.args(), policy, out);
    }

    fn args(&self, args: ast::Args<'a>, policy: ArgPolicy, out: &mut Vec<Token>) {
        if policy == ArgPolicy::Opaque {
            self.push(args.span(), TokenKind::Unlintable, out);
            return;
        }

        let mut seen_positional = false;
        for arg in args.items() {
            match arg {
                ast::Arg::Pos(expr) => {
                    let skip = policy == ArgPolicy::SkipFirstPositional && !seen_positional;
                    seen_positional = true;
                    if skip {
                        self.push(expr.span(), TokenKind::Unlintable, out);
                    } else {
                        self.expr(expr, out);
                    }
                }
                ast::Arg::Named(named) => {
                    self.push(named.name().span(), TokenKind::Unlintable, out);
                    self.expr(named.expr(), out);
                }
                ast::Arg::Spread(spread) => self.expr(spread.expr(), out),
            }
        }
    }
}

/// Decide how to treat a call's arguments from the callee's source text
/// (`rgb`, `calc.abs`, `std.image`, …).
fn arg_policy(callee: &str) -> ArgPolicy {
    let callee = callee.trim();
    if OPAQUE_NAMESPACES
        .iter()
        .any(|ns| callee.strip_prefix(ns).is_some_and(|r| r.starts_with('.')))
    {
        return ArgPolicy::Opaque;
    }

    // `std.rgb` and `rgb` are the same function; match on the last segment.
    let name = callee.rsplit('.').next().unwrap_or(callee);
    if OPAQUE_CALLS.contains(&name) {
        ArgPolicy::Opaque
    } else if OPAQUE_FIRST_ARG.contains(&name) {
        ArgPolicy::SkipFirstPositional
    } else {
        ArgPolicy::Prose
    }
}
