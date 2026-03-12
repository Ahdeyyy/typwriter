import { Tag, tags as t, styleTags } from "@lezer/highlight";

// ─── Custom Typst-specific highlight tags ────────────────────────────────────
//
// These mirror the Tag enum in highlight.rs one-to-one, so themes can style
// every Typst-specific concept individually.  They also have explicit parent
// relationships so that generic theme rules still apply as a fallback.

/**
 * All custom Typst tags.
 *
 * @example
 * import { typstTags } from "./highlight.js";
 * // Use in a HighlightStyle:
 * { tag: typstTags.mathDelimiter, color: "#bb9af7" }
 */
export const typstTags = {
    // ── Markup ─────────────────────────────────────────────────────────────────
    /** A section heading (= … ==== …).  Parent: t.heading */
    heading: Tag.define(t.heading),

    /** Strong/bold markup (*…*).  Parent: t.strong */
    strong: Tag.define(t.strong),

    /** Emphasized/italic markup (_…_).  Parent: t.emphasis */
    emph: Tag.define(t.emphasis),

    /** Inline or block raw text (`…` or ```…```).  Parent: t.monospace */
    raw: Tag.define(t.monospace),

    /** Escape sequence or shorthand (\*, ~, ---, …).  Parent: t.escape */
    escape: Tag.define(t.escape),

    /** Hyperlink (https://…).  Parent: t.url */
    link: Tag.define(t.url),

    /** A label (<label-name>).  Parent: t.labelName */
    label: Tag.define(t.labelName),

    /** A reference to a label (@label).  Parent: t.labelName */
    ref: Tag.define(t.labelName),

    /** Bullet / enum / term list marker (-, +, 1., /).  Parent: t.list */
    listMarker: Tag.define(t.list),

    /** Term text in a term list (the part before the colon).  Parent: t.strong */
    listTerm: Tag.define(t.strong),

    // ── Math ───────────────────────────────────────────────────────────────────
    /** The $ delimiters of an equation.  Parent: t.processingInstruction */
    mathDelimiter: Tag.define(t.processingInstruction),

    /** Operators inside math (^, _, /, &, ', √, shorthands).  Parent: t.operator */
    mathOperator: Tag.define(t.operator),

    // ── Code ───────────────────────────────────────────────────────────────────
    /** A keyword (let, set, show, if, for, while, …).  Parent: t.keyword */
    keyword: Tag.define(t.keyword),

    /** An operator in code (+, -, *, ==, !=, =>, …).  Parent: t.operator */
    operator: Tag.define(t.operator),

    /** A punctuation token ({, }, [, ], (, ), , ; : .).  Parent: t.punctuation */
    punctuation: Tag.define(t.punctuation),

    /** A numeric literal (42, 3.14, 12pt, 90deg).  Parent: t.number */
    number: Tag.define(t.number),

    /** A string literal ("…").  Parent: t.string */
    string: Tag.define(t.string),

    /** A function or method name (the identifier before an arg list).  Parent: t.variableName */
    function: Tag.define(t.variableName),

    /**
     * An interpolated variable — an identifier after # in markup/math,
     * or a math identifier (alpha, pi, …).  Parent: t.variableName
     */
    interpolated: Tag.define(t.variableName),

    // ── Meta ───────────────────────────────────────────────────────────────────
    /** The # token itself, coloured like the expression it introduces. */
    hash: Tag.define(t.meta),

    /** A syntax error.  Parent: t.invalid */
    error: Tag.define(t.invalid),
};

// ─── styleTags prop ──────────────────────────────────────────────────────────
//
// Maps every grammar node type (from typst.grammar) to a highlight tag,
// reproducing the match arms in highlight.rs line-by-line, including the
// context-sensitive cases expressed as contextual selectors.
//
// Reference:  highlight.rs  highlight()  function

export const typstHighlighting = styleTags({

    // ── Trivia / meta ──────────────────────────────────────────────────────────
    // SyntaxKind::Shebang | LineComment | BlockComment  →  Tag::Comment
    "shebang LineComment BlockComment": t.comment,

    // SyntaxKind::Error  →  Tag::Error
    "⚠": typstTags.error,

    // ── Markup ─────────────────────────────────────────────────────────────────
    // SyntaxKind::Linebreak | Escape | Shorthand  →  Tag::Escape
    "Linebreak Escape Shorthand": typstTags.escape,

    // Strong/Emph styling is handled by the decoration overlay in markupStyles.ts
    // (LR parsers can't reliably pair *...* / _..._ delimiters)

    // SyntaxKind::Raw  →  Tag::Raw
    "Raw": typstTags.raw,

    // SyntaxKind::Link  →  Tag::Link
    "Link": typstTags.link,

    // SyntaxKind::Label  →  Tag::Label
    "Label": typstTags.label,

    // SyntaxKind::Ref  →  Tag::Ref
    // (RefMarker itself → None, but the whole Ref node gets styled)
    "Ref": typstTags.ref,

    // SyntaxKind::Heading  →  Tag::Heading
    "Heading HeadingMarker": typstTags.heading,

    // SyntaxKind::ListMarker | EnumMarker | TermMarker  →  Tag::ListMarker
    "EnumMarker": typstTags.listMarker,

    // ── Math ───────────────────────────────────────────────────────────────────
    // SyntaxKind::Dollar  →  Tag::MathDelimiter
    "Dollar": typstTags.mathDelimiter,

    // SyntaxKind::MathAlignPoint | MathPrimes  →  Tag::MathOperator
    "MathAlignPoint MathPrimes": typstTags.mathOperator,

    // SyntaxKind::Hat  →  Tag::MathOperator
    "Hat": typstTags.mathOperator,

    // SyntaxKind::Root  →  Tag::MathOperator
    "Root": typstTags.mathOperator,

    // SyntaxKind::MathShorthand  →  Tag::Escape
    "MathShorthand": typstTags.escape,

    // SyntaxKind::Underscore inside MathAttach  →  Tag::MathOperator
    // Outside MathAttach  →  None (no highlight; Star inside Strong is similar)
    "MathAttach/Underscore": typstTags.mathOperator,

    // SyntaxKind::Slash inside MathFrac  →  Tag::MathOperator; else Tag::Operator
    "MathFrac/Slash": typstTags.mathOperator,

    // SyntaxKind::MathIdent  →  highlight_ident() which returns:
    //   - Tag::Function  if directly before ( (args) or [ (content block)
    //   - Tag::Interpolated  always for MathIdent (the else branch)
    // We use the "function" rule for the func-call case and fall back to
    // interpolated for the general case.
    "FuncCall/MathIdent": typstTags.function,
    "MathIdent": typstTags.interpolated,

    // ── Delimiters / punctuation ────────────────────────────────────────────────
    // SyntaxKind::{Left,Right}{Brace,Bracket,Paren} | Comma | Semicolon | Colon | Dot
    //   →  Tag::Punctuation
    "LeftBrace RightBrace": typstTags.punctuation,
    "LeftBracket RightBracket": typstTags.punctuation,
    "LeftParen RightParen": typstTags.punctuation,
    "Comma Semicolon Colon Dot": typstTags.punctuation,

    // SyntaxKind::Star  →  None inside Strong, Operator elsewhere.
    // The contextual selector "Strong/Star" is intentionally absent so that the
    // star gets no styling when it is the delimiter of a Strong span.
    // All other Stars (multiplication, wildcard import) get Operator.
    "Binary/Star": typstTags.operator,
    "StarEq": typstTags.operator,

    // SyntaxKind::Eq inside Heading  →  None; elsewhere  →  Operator.
    // HeadingMarker is the "=...=" token; Eq is the assignment operator.
    // Heading uses HeadingMarker, not Eq, so this distinction is already
    // captured by the node type, but we exclude just in case:
    "Binary/Eq Eq": typstTags.operator,

    // SyntaxKind::{Plus,Minus,Slash,EqEq,ExclEq,Lt,LtEq,Gt,GtEq,
    //              PlusEq,HyphEq,StarEq,SlashEq,Dots,Arrow}  →  Tag::Operator
    "Plus Minus Slash": typstTags.operator,
    "EqEq ExclEq Lt LtEq Gt GtEq": typstTags.operator,
    "PlusEq HyphEq SlashEq Dots Arrow": typstTags.operator,

    // SyntaxKind::Hash  →  highlight_hash() which propagates the next expr's tag.
    // We use Tag::Interpolated as the default (covers #ident, #func() etc.) and
    // let more specific selectors override for keywords (e.g. #let → Keyword).
    "Hash": typstTags.hash,

    // ── Keywords ───────────────────────────────────────────────────────────────
    // SyntaxKind::{Not,And,Or,None,Auto,Let,Set,Show,Context,If,Else,For,In,
    //              While,Break,Continue,Return,Import,Include,As,Bool}  →  Tag::Keyword
    "Not And Or": typstTags.keyword,
    "None Auto": typstTags.keyword,
    "Let Set Show Context": typstTags.keyword,
    "If Else For In While": typstTags.keyword,
    "Break Continue Return": typstTags.keyword,
    "Import Include As": typstTags.keyword,
    // SyntaxKind::Bool  →  Tag::Keyword (matches highlight.rs)
    "Bool": typstTags.keyword,

    // ── Literals ───────────────────────────────────────────────────────────────
    // SyntaxKind::{Int,Float,Numeric}  →  Tag::Number
    "Int Float Numeric": typstTags.number,
    // SyntaxKind::Str  →  Tag::String
    "Str": typstTags.string,

    // ── Identifiers (context-sensitive) ────────────────────────────────────────
    //
    // highlight_ident() logic (from highlight.rs):
    //
    //  1. Ident immediately before ( (Args) or [ (ContentBlock)  →  Function
    //  2. Ident / MathIdent inside math (covered above for MathIdent)
    //  3. Ident after # (ancestor's prev_leaf is Hash)            →  Interpolated
    //  4. Ident in show rule (before or after Colon)              →  Function
    //  5. Behind a dot after another ident                        →  inherit parent
    //  6. Otherwise                                               →  None
    //
    // Lezer lets us express these with contextual selectors:

    // Case 1 – function calls:  f(…) and f[…]
    "FuncCall/Ident": typstTags.function,
    "FuncCall/primary/Ident": typstTags.function,
    // Method calls:  a.f(…)  — the Ident after a Dot inside FuncCall
    "FuncCall/FieldAccess/Ident": typstTags.function,

    // Case 4 – show rule selector / transform ident
    "ShowRule/Ident": typstTags.function,

    // Case 3 – #ident in markup/math (Hash is a sibling in EmbeddedExpr)
    // This covers  #foo  →  Interpolated
    "EmbeddedExpr/Ident": typstTags.interpolated,
    "EmbeddedExpr/FuncCall/Ident": typstTags.function,

    // Definition sites: let x = …,  for x in …,  params
    "LetBinding/Ident": t.definition(t.variableName),
    "Params/Ident": t.definition(t.variableName),
    "ForLoop/Ident": t.definition(t.variableName),
    "Destructuring/Ident": t.definition(t.variableName),

    // Named argument key:  f(size: 12pt)  →  propertyName
    "Named/Ident": t.propertyName,
    // Dict key:  (name: "Alice")
    "Dict/Named/Ident": t.propertyName,

    // Field access last component:  a.b.c  →  propertyName
    "FieldAccess/Ident": t.propertyName,

    // Bare identifier (not covered by any of the above) → variableName
    "Ident": t.variableName,
});

// ─── Re-export for convenience ────────────────────────────────────────────────
export { styleTags };