import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// ── Palette (Catppuccin Mocha) ────────────────────────────────────────────────

const MD = {
    // ── Chrome ────────────────────────────────────────────────────────────────
    bg:          "#1e1e2e",
    bgDark:      "#181825",
    bgHighlight: "#2a2a3c",
    bgSelection: "#4895ef28",
    border:      "#313244",

    fg:          "#cdd6f4",
    fgGutter:    "#585b70",
    fgComment:   "#6c7086",

    // ── Syntax ────────────────────────────────────────────────────────────────
    ink:         "#cdd6f4",
    crimson:     "#f38ba8",
    crimsonDark: "#eba0ac",
    violet:      "#cba6f7",
    cobalt:      "#89b4fa",
    amber:       "#f9e2af",
    green:       "#a6e3a1",
    terracotta:  "#fab387",
    indigo:      "#b4befe",
    navy:        "#89dceb",
    teal:        "#94e2d5",
    muted:       "#9399b2",
    faint:       "#585b70",
};

// ── Editor chrome ─────────────────────────────────────────────────────────────

export const darkTheme = EditorView.theme(
    {
        "&": {
            color: MD.fg,
            backgroundColor: MD.bg,
        },
        ".cm-content": { caretColor: MD.indigo, padding: "0.55rem" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: MD.indigo },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: MD.bgSelection,
        },
        ".cm-panels": { backgroundColor: MD.bgDark, color: MD.fg },
        ".cm-panels.cm-panels-top": { borderBottom: `2px solid ${MD.border}` },
        ".cm-panels.cm-panels-bottom": { borderTop: `2px solid ${MD.border}` },
        ".cm-searchMatch": {
            backgroundColor: "#f9e2af28",
            outline: `1px solid ${MD.amber}`,
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: "#f38ba840",
        },
        ".cm-selectionMatch": { backgroundColor: "#89b4fa28" },
        "&.cm-focused .cm-matchingBracket": {
            backgroundColor: "#a6e3a125",
            outline: `1px solid #a6e3a150`,
        },
        "&.cm-focused .cm-nonmatchingBracket": {
            backgroundColor: "#f38ba825",
        },
        ".cm-gutters": {
            backgroundColor: MD.bg,
            color: MD.fgGutter,
            border: "none",
            width: "1.35rem",
            borderRight: `1px solid ${MD.border}`,
        },
        ".cm-activeLineGutter": {
            backgroundColor: MD.bgHighlight,
            color: MD.fgComment,
        },
        ".cm-foldPlaceholder": {
            backgroundColor: "transparent",
            border: "none",
            color: MD.fgComment,
        },
        ".cm-tooltip": {
            border: `1px solid ${MD.border}`,
            backgroundColor: MD.bgDark,
        },
        ".cm-completionMatchedText": {
            textDecoration: "none",
            color: MD.cobalt,
            fontWeight: "bold",
        },
    },
    { dark: true }
);

// ── Syntax colours ────────────────────────────────────────────────────────────

export const darkHighlightStyle = HighlightStyle.define([

    // ── Trivia & Comments ───────────────────────────────────────────────────────
    { tag: t.comment, color: MD.fgComment, fontStyle: "italic" },

    // ── Markup & Typography ─────────────────────────────────────────────────────
    { tag: t.heading, color: MD.ink, fontWeight: "900" },
    { tag: t.strong, color: MD.crimsonDark, fontWeight: "bold" },
    { tag: t.emphasis, color: MD.violet, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: MD.cobalt, textDecoration: "underline" },

    {
        tag: t.monospace,
        color: MD.terracotta,
        fontFamily: "'Iosevka','JetBrains Mono', 'Fira Code', Consolas, monospace",
        borderRadius: "2px",
        padding: "0 2px",
    },

    // ── Special Typst Markers ──────────────────────────────────────────────────
    { tag: t.escape, color: MD.violet },
    { tag: t.labelName, color: MD.amber },
    { tag: t.meta, color: MD.crimson },
    { tag: t.processingInstruction, color: MD.violet, fontWeight: "bold" },

    // ── Code — keywords & operators ─────────────────────────────────────────────
    { tag: t.keyword, color: MD.crimson },
    { tag: t.operatorKeyword, color: MD.crimson },
    { tag: t.modifier, color: MD.crimson },
    { tag: t.operator, color: MD.muted },
    { tag: t.arithmeticOperator, color: MD.cobalt },
    { tag: t.compareOperator, color: MD.muted },
    { tag: t.updateOperator, color: MD.muted },
    { tag: t.punctuation, color: MD.faint },

    // ── Code — literals ─────────────────────────────────────────────────────────
    { tag: t.number, color: MD.terracotta },
    { tag: t.string, color: MD.green },
    { tag: t.bool, color: MD.crimson },
    { tag: t.null, color: MD.crimson },

    // ── Code — identifiers ──────────────────────────────────────────────────────
    { tag: t.function(t.variableName), color: MD.indigo },
    { tag: t.special(t.variableName), color: MD.navy },
    { tag: t.definition(t.variableName), color: MD.navy },
    { tag: t.propertyName, color: MD.teal },
    { tag: t.variableName, color: MD.fg },

    // ── Brackets ────────────────────────────────────────────────────────────────
    { tag: t.bracket, color: MD.faint },
    { tag: t.paren, color: MD.faint },
    { tag: t.squareBracket, color: MD.faint },
    { tag: t.brace, color: MD.faint },

    // ── Errors ─────────────────────────────────────────────────────────────────
    { tag: t.invalid, color: MD.crimson, textDecoration: "underline wavy" },
]);

export const dark = [
    darkTheme,
    syntaxHighlighting(darkHighlightStyle),
];

export default dark;
