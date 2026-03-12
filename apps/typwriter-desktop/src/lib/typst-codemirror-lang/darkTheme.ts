/**
 * src/themes/dark.js
 *
 * "Tokyo Night" dark theme for the Typst CodeMirror language.
 *
 * Palette reference:
 *   https://github.com/enkia/tokyo-night-vscode-theme
 *
 * Every colour maps to a specific Typst semantic tag so the theme can be
 * used as a reference implementation for writing other themes.
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { typstTags } from "./highlight";

// ── Palette ──────────────────────────────────────────────────────────────────

const TN = {
    bg: "#1a1b26",
    bgDark: "#16161e",
    bgHighlight: "#1e2030",
    bgSelection: "#2e3c64",
    border: "#292e42",

    fg: "#c0caf5",
    fgGutter: "#3b4261",
    fgComment: "#565f89",

    // Syntax colours
    red: "#f7768e",
    orange: "#ff9e64",
    yellow: "#e0af68",
    green: "#9ece6a",
    teal: "#73daca",
    cyan: "#89dceb",
    blue: "#7aa2f7",
    blue2: "#2ac3de",
    purple: "#9d7cd8",
    magenta: "#bb9af7",
    pink: "#c0caf5",

    // Special
    invalid: "#f7768e",
};

// ── Editor chrome ─────────────────────────────────────────────────────────────

export const tokyoNightDarkTheme = EditorView.theme(
    {
        "&": {
            color: TN.fg,
            backgroundColor: TN.bg,
        },
        ".cm-content": { caretColor: TN.blue },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: TN.blue },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: TN.bgSelection,
        },
        ".cm-panels": { backgroundColor: TN.bgDark, color: TN.fg },
        ".cm-panels.cm-panels-top": { borderBottom: `2px solid ${TN.border}` },
        ".cm-panels.cm-panels-bottom": { borderTop: `2px solid ${TN.border}` },
        ".cm-searchMatch": {
            backgroundColor: "#72a1ff59",
            outline: `1px solid ${TN.blue}`,
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: TN.bgSelection,
        },
        ".cm-activeLine": { backgroundColor: TN.bgHighlight },
        ".cm-selectionMatch": { backgroundColor: "#aafe661a" },
        "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
            backgroundColor: "#17c1a430",
        },
        ".cm-gutters": {
            backgroundColor: TN.bgDark,
            color: TN.fgGutter,
            border: "none",
            borderRight: `1px solid ${TN.border}`,
        },
        ".cm-activeLineGutter": {
            backgroundColor: TN.bgHighlight,
            color: TN.fgComment,
        },
        ".cm-foldPlaceholder": {
            backgroundColor: "transparent",
            border: "none",
            color: TN.fgComment,
        },
        ".cm-tooltip": {
            border: `1px solid ${TN.border}`,
            backgroundColor: TN.bgDark,
        },
        ".cm-tooltip .cm-tooltip-arrow:before": {
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
        },
        ".cm-tooltip .cm-tooltip-arrow:after": {
            borderTopColor: TN.bgDark,
            borderBottomColor: TN.bgDark,
        },
        ".cm-tooltip.cm-completionInfo": {
            padding: "8px",
            fontSize: "0.875rem",
        },
        ".cm-completionMatchedText": {
            textDecoration: "none",
            color: TN.blue,
            fontWeight: "bold",
        },
        ".cm-typst-heading": {
            color: TN.blue,
            fontWeight: "bold",
        },
        ".cm-typst-strong": {
            color: TN.yellow,
            fontWeight: "bold",
        },
        ".cm-typst-emph": {
            color: TN.yellow,
            fontStyle: "italic",
        },
        ".cm-typst-heading.cm-typst-strong": {
            color: TN.blue,
            fontWeight: "bold",
        },
        ".cm-typst-heading.cm-typst-emph": {
            color: TN.blue,
            fontWeight: "bold",
            fontStyle: "italic",
        },
    },
    { dark: true }
);

// ── Syntax colours ────────────────────────────────────────────────────────────

export const tokyoNightDarkHighlightStyle = HighlightStyle.define([

    // ── Trivia ──────────────────────────────────────────────────────────────────
    {
        tag: t.comment,
        color: TN.fgComment, fontStyle: "italic"
    },

    // ── Markup ──────────────────────────────────────────────────────────────────
    {
        tag: typstTags.heading,
        color: TN.blue, fontWeight: "bold"
    },
    {
        tag: typstTags.strong,
        color: TN.yellow, fontWeight: "bold"
    },
    {
        tag: typstTags.emph,
        color: TN.yellow, fontStyle: "italic"
    },
    {
        tag: typstTags.raw,
        color: TN.cyan,
        backgroundColor: TN.bgHighlight,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace"
    },
    {
        tag: typstTags.escape,
        color: TN.magenta
    },
    {
        tag: typstTags.link,
        color: TN.teal, textDecoration: "underline"
    },
    {
        tag: typstTags.label,
        color: TN.yellow
    },
    {
        tag: typstTags.ref,
        color: TN.yellow
    },
    {
        tag: typstTags.listMarker,
        color: TN.orange
    },
    {
        tag: typstTags.listTerm,
        color: TN.blue2, fontWeight: "bold"
    },

    // ── Math ────────────────────────────────────────────────────────────────────
    {
        tag: typstTags.mathDelimiter,
        color: TN.magenta
    },
    {
        tag: typstTags.mathOperator,
        color: TN.cyan
    },

    // ── Code — keywords ─────────────────────────────────────────────────────────
    {
        tag: typstTags.keyword,
        color: TN.purple
    },
    {
        tag: t.keyword,
        color: TN.purple
    },
    {
        tag: t.operatorKeyword,
        color: TN.purple
    },

    // ── Code — operators & punctuation ───────────────────────────────────────────
    {
        tag: typstTags.operator,
        color: TN.cyan
    },
    {
        tag: t.operator,
        color: TN.cyan
    },
    {
        tag: t.compareOperator,
        color: TN.cyan
    },
    {
        tag: t.updateOperator,
        color: TN.cyan
    },
    {
        tag: typstTags.punctuation,
        color: TN.cyan
    },
    {
        tag: t.punctuation,
        color: TN.cyan
    },
    {
        tag: typstTags.hash,
        color: TN.magenta
    },
    {
        tag: t.meta,
        color: TN.magenta
    },

    // ── Code — literals ─────────────────────────────────────────────────────────
    {
        tag: typstTags.number,
        color: TN.orange
    },
    {
        tag: t.number,
        color: TN.orange
    },
    {
        tag: typstTags.string,
        color: TN.green
    },
    {
        tag: t.string,
        color: TN.green
    },
    {
        tag: t.escape,
        color: TN.magenta
    },

    // ── Code — identifiers ──────────────────────────────────────────────────────
    {
        tag: typstTags.function,
        color: TN.blue
    },
    {
        tag: t.function(t.variableName),
        color: TN.blue
    },
    {
        tag: typstTags.interpolated,
        color: TN.teal
    },
    {
        tag: t.special(t.variableName),
        color: TN.teal
    },
    {
        tag: t.definition(t.variableName),
        color: TN.teal
    },
    {
        tag: t.propertyName,
        color: TN.teal
    },
    {
        tag: t.variableName,
        color: TN.fg
    },

    // ── Brackets ────────────────────────────────────────────────────────────────
    {
        tag: t.bracket,
        color: TN.blue
    },
    {
        tag: t.paren,
        color: TN.fg
    },
    {
        tag: t.squareBracket,
        color: TN.fg
    },
    {
        tag: t.brace,
        color: TN.fg
    },

    // ── Errors ─────────────────────────────────────────────────────────────────
    {
        tag: typstTags.error,
        color: TN.invalid,
        textDecoration: "underline wavy"
    },
    {
        tag: t.invalid,
        color: TN.invalid,
        textDecoration: "underline wavy"
    },
]);

/**
 * Convenience export — pass directly to `EditorView.extensions`.
 *
 * @example
 * import { tokyoNightDark } from "@codemirror/lang-typst/themes/dark";
 * new EditorView({ extensions: [basicSetup, typst(), tokyoNightDark] })
 */
export const tokyoNightDark = [
    tokyoNightDarkTheme,
    syntaxHighlighting(tokyoNightDarkHighlightStyle),
];

export default tokyoNightDark;