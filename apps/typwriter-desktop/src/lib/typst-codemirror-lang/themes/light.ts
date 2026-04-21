/**
 * src/themes/light.ts
 *
 * "Light" theme for the Typst CodeMirror language.
 *
 * Inspired by the aesthetic of printed technical documents:
 * warm paper background, ink-dark headings, and a carefully
 * balanced semantic colour palette.
 * by gemini
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// ── Palette ──────────────────────────────────────────────────────────────────

const ML = {
    // ── Chrome ────────────────────────────────────────────────────────────────
    bg:          "#fefcf8",
    bgDark:      "#f5f3ee",
    bgHighlight: "#eef2fb",
    bgSelection: "#b8d4ff50",
    border:      "#e8e4dc",

    fg:          "#2c2c2c",
    fgGutter:    "#b0aba1",
    fgComment:   "#9a9690",

    // ── Syntax ────────────────────────────────────────────────────────────────
    ink:         "#0d0d0d",
    crimson:     "#be2626",
    crimsonDark: "#8b1515",
    violet:      "#6b3fa0",
    cobalt:      "#1155cc",
    amber:       "#b56b00",
    green:       "#1a7d2e",
    terracotta:  "#b85c00",
    indigo:      "#6639ba",
    navy:        "#1a55a0",
    teal:        "#1876a0",
    muted:       "#666666",
    faint:       "#999999",
};

// ── Editor chrome ─────────────────────────────────────────────────────────────

export const lightTheme = EditorView.theme(
    {
        "&": {
            color: ML.fg,
            backgroundColor: ML.bg,
        },
        ".cm-content": { caretColor: ML.indigo, padding: "0.55rem" },
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
        // ".cm-activeLine": { backgroundColor: ML. },
        ".cm-selectionMatch": { backgroundColor: "#b8d4ff40" },
        "&.cm-focused .cm-matchingBracket": {
            backgroundColor: "#2e7d3225",
            outline: `1px solid #2e7d3250`,
        },
        "&.cm-focused .cm-nonmatchingBracket": {
            backgroundColor: "#be262625",
        },
        ".cm-gutters": {
            backgroundColor: ML.bg,
            color: ML.fgGutter,
          border: "none",
          width: "1.35rem",
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

export const lightHighlightStyle = HighlightStyle.define([

    // ── Trivia & Comments ───────────────────────────────────────────────────────
    { tag: t.comment, color: ML.fgComment, fontStyle: "italic" },

    // ── Markup & Typography ─────────────────────────────────────────────────────
    { tag: t.heading, color: ML.ink, fontWeight: "900"},
    { tag: t.strong, color: ML.crimsonDark, fontWeight: "bold" },
    { tag: t.emphasis, color: ML.violet, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: ML.cobalt, textDecoration: "underline" },

    // Raw code / monospace mapping
    {
        tag: t.monospace,
        color: ML.terracotta,
        // backgroundColor: "#f4f0e8",
        fontFamily: "'Iosevka','JetBrains Mono', 'Fira Code', Consolas, monospace",
        borderRadius: "2px",
        padding: "0 2px"
    },

    // ── Special Typst Markers (Assuming common tag mappings) ────────────────────
    { tag: t.escape, color: ML.violet },
    { tag: t.labelName, color: ML.amber },
    { tag: t.meta, color: ML.crimson }, // Often used for # hashes
    { tag: t.processingInstruction, color: ML.violet, fontWeight: "bold" }, // Sometimes used for math delimiters

    // ── Code — keywords & operators ─────────────────────────────────────────────
    { tag: t.keyword, color: ML.crimson },
    { tag: t.operatorKeyword, color: ML.crimson },
    { tag: t.modifier, color: ML.crimson },
    { tag: t.operator, color: ML.muted },
    { tag: t.arithmeticOperator, color: ML.cobalt }, // Math operators
    { tag: t.compareOperator, color: ML.muted },
    { tag: t.updateOperator, color: ML.muted },
    { tag: t.punctuation, color: ML.faint },

    // ── Code — literals ─────────────────────────────────────────────────────────
    { tag: t.number, color: ML.terracotta },
    { tag: t.string, color: ML.green },
    { tag: t.bool, color: ML.crimson },
    { tag: t.null, color: ML.crimson },

    // ── Code — identifiers ──────────────────────────────────────────────────────
    { tag: t.function(t.variableName), color: ML.indigo },
    { tag: t.special(t.variableName), color: ML.navy }, // Interpolated/Special
    { tag: t.definition(t.variableName), color: ML.navy },
    { tag: t.propertyName, color: ML.teal },
    { tag: t.variableName, color: ML.fg },

    // ── Brackets ────────────────────────────────────────────────────────────────
    { tag: t.bracket, color: ML.faint },
    { tag: t.paren, color: ML.faint },
    { tag: t.squareBracket, color: ML.faint },
    { tag: t.brace, color: ML.faint },

    // ── Errors ─────────────────────────────────────────────────────────────────
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
 * import { light } from "@codemirror/lang-typst/themes/light";
 * new EditorView({ extensions: [basicSetup, typst(), light] })
 */
export const light = [
    lightTheme,
    syntaxHighlighting(lightHighlightStyle),
];

export default light;
