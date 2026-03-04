/**
 * src/themes/light.ts
 *
 * "Manuscript Light" theme for the Typst CodeMirror language.
 *
 * Inspired by the aesthetic of printed technical documents:
 * warm paper background, ink-dark headings, and a carefully
 * balanced semantic colour palette.
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { typstTags } from "./highlight";

// ── Palette ──────────────────────────────────────────────────────────────────

const ML = {
    // ── Chrome ────────────────────────────────────────────────────────────────
    bg:          "#fefcf8",   // warm paper white
    bgDark:      "#f5f3ee",   // cream — gutters, panels
    bgHighlight: "#eef2fb",   // cool blue wash — active line
    bgSelection: "#b8d4ff50",
    border:      "#e8e4dc",

    fg:          "#2c2c2c",   // warm charcoal
    fgGutter:    "#b0aba1",
    fgComment:   "#9a9690",

    // ── Syntax ────────────────────────────────────────────────────────────────
    ink:         "#0d0d0d",   // near-black  — headings, list terms
    crimson:     "#be2626",   // keyword red — keywords, hash, errors
    crimsonDark: "#8b1515",   // deep crimson — bold markup
    violet:      "#6b3fa0",   // purple      — emph, math delimiter, escape
    cobalt:      "#1155cc",   // web blue    — links, math operators
    amber:       "#b56b00",   // amber       — labels, refs
    green:       "#1a7d2e",   // forest green — strings, list markers
    terracotta:  "#b85c00",   // terracotta  — numbers, raw code
    indigo:      "#6639ba",   // deep violet — functions
    navy:        "#1a55a0",   // navy        — interpolated, definitions
    teal:        "#1876a0",   // teal blue   — property names
    muted:       "#666666",   // neutral gray — operators
    faint:       "#999999",   // light gray  — punctuation, brackets
};

// ── Editor chrome ─────────────────────────────────────────────────────────────

export const githubLightTheme = EditorView.theme(
    {
        "&": {
            color: ML.fg,
            backgroundColor: ML.bg,
        },
        ".cm-content": { caretColor: ML.indigo },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: ML.indigo },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: ML.bgSelection,
        },
        ".cm-panels": { backgroundColor: ML.bgDark, color: ML.fg },
        ".cm-panels.cm-panels-top": { borderBottom: `2px solid ${ML.border}` },
        ".cm-panels.cm-panels-bottom": { borderTop: `2px solid ${ML.border}` },
        ".cm-searchMatch": {
            backgroundColor: "#ffd70050",
            outline: `1px solid ${ML.amber}`,
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: "#ffaa8080",
        },
        ".cm-activeLine": { backgroundColor: ML.bgHighlight },
        ".cm-selectionMatch": { backgroundColor: "#b8d4ff40" },
        "&.cm-focused .cm-matchingBracket": {
            backgroundColor: "#2e7d3225",
            outline: `1px solid #2e7d3250`,
        },
        "&.cm-focused .cm-nonmatchingBracket": {
            backgroundColor: "#be262625",
        },
        ".cm-gutters": {
            backgroundColor: ML.bgDark,
            color: ML.fgGutter,
            border: "none",
            borderRight: `1px solid ${ML.border}`,
        },
        ".cm-activeLineGutter": {
            backgroundColor: ML.bgHighlight,
            color: ML.fgComment,
        },
        ".cm-foldPlaceholder": {
            backgroundColor: "transparent",
            border: "none",
            color: ML.fgComment,
        },
        ".cm-tooltip": {
            border: `1px solid ${ML.border}`,
            backgroundColor: ML.bgDark,
        },
        ".cm-completionMatchedText": {
            textDecoration: "none",
            color: ML.cobalt,
            fontWeight: "bold",
        },
    },
    { dark: false }
);

// ── Syntax colours ────────────────────────────────────────────────────────────

export const githubLightHighlightStyle = HighlightStyle.define([

    // ── Trivia ──────────────────────────────────────────────────────────────────
    {
        tag: t.comment,
        color: ML.fgComment, fontStyle: "italic"
    },

    // ── Markup ──────────────────────────────────────────────────────────────────
    {
        // Headings: bold and near-black (as requested)
        tag: typstTags.heading,
        color: ML.ink, fontWeight: "bold"
    },
    {
        tag: typstTags.strong,
        color: ML.crimsonDark, fontWeight: "bold"
    },
    {
        tag: typstTags.emph,
        color: ML.violet, fontStyle: "italic"
    },
    {
        tag: typstTags.raw,
        color: ML.terracotta,
        backgroundColor: "#f4f0e8",
        fontFamily: "'Iosevka','JetBrains Mono', 'Fira Code', Consolas, monospace",
        borderRadius: "2px",
        padding: "0 2px"
    },
    {
        tag: typstTags.escape,
        color: ML.violet
    },
    {
        // Links: blue with underline (as requested)
        tag: typstTags.link,
        color: ML.cobalt, textDecoration: "underline"
    },
    {
        tag: typstTags.label,
        color: ML.amber
    },
    {
        tag: typstTags.ref,
        color: ML.amber
    },
    {
        tag: typstTags.listMarker,
        color: ML.green, fontWeight: "bold"
    },
    {
        tag: typstTags.listTerm,
        color: ML.ink, fontWeight: "bold"
    },

    // ── Math ────────────────────────────────────────────────────────────────────
    {
        tag: typstTags.mathDelimiter,
        color: ML.violet, fontWeight: "bold"
    },
    {
        tag: typstTags.mathOperator,
        color: ML.cobalt
    },

    // ── Code — keywords ─────────────────────────────────────────────────────────
    {
        tag: typstTags.keyword,
        color: ML.crimson
    },
    {
        tag: t.keyword,
        color: ML.crimson
    },
    {
        tag: t.operatorKeyword,
        color: ML.crimson
    },

    // ── Code — operators & punctuation ───────────────────────────────────────────
    {
        tag: typstTags.operator,
        color: ML.muted
    },
    {
        tag: t.operator,
        color: ML.muted
    },
    {
        tag: t.compareOperator,
        color: ML.muted
    },
    {
        tag: t.updateOperator,
        color: ML.muted
    },
    {
        tag: typstTags.punctuation,
        color: ML.faint
    },
    {
        tag: t.punctuation,
        color: ML.faint
    },
    {
        tag: typstTags.hash,
        color: ML.crimson
    },
    {
        tag: t.meta,
        color: ML.crimson
    },

    // ── Code — literals ─────────────────────────────────────────────────────────
    {
        tag: typstTags.number,
        color: ML.terracotta
    },
    {
        tag: t.number,
        color: ML.terracotta
    },
    {
        tag: typstTags.string,
        color: ML.green
    },
    {
        tag: t.string,
        color: ML.green
    },
    {
        tag: t.escape,
        color: ML.violet
    },

    // ── Code — identifiers ──────────────────────────────────────────────────────
    {
        tag: typstTags.function,
        color: ML.indigo
    },
    {
        tag: t.function(t.variableName),
        color: ML.indigo
    },
    {
        tag: typstTags.interpolated,
        color: ML.navy
    },
    {
        tag: t.special(t.variableName),
        color: ML.navy
    },
    {
        tag: t.definition(t.variableName),
        color: ML.navy
    },
    {
        tag: t.propertyName,
        color: ML.teal
    },
    {
        tag: t.variableName,
        color: ML.fg
    },

    // ── Brackets ────────────────────────────────────────────────────────────────
    {
        tag: t.bracket,
        color: ML.faint
    },
    {
        tag: t.paren,
        color: ML.faint
    },
    {
        tag: t.squareBracket,
        color: ML.faint
    },
    {
        tag: t.brace,
        color: ML.faint
    },

    // ── Errors ─────────────────────────────────────────────────────────────────
    {
        tag: typstTags.error,
        color: ML.crimson,
        textDecoration: "underline wavy"
    },
    {
        tag: t.invalid,
        color: ML.crimson,
        textDecoration: "underline wavy"
    },
]);

/**
 * Convenience export — pass directly to `EditorView.extensions`.
 *
 * @example
 * import { githubLight } from "@codemirror/lang-typst/themes/light";
 * new EditorView({ extensions: [basicSetup, typst(), githubLight] })
 */
export const githubLight = [
    githubLightTheme,
    syntaxHighlighting(githubLightHighlightStyle),
];

export default githubLight;
