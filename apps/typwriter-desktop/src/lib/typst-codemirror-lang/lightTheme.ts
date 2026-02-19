/**
 * src/themes/light.js
 *
 * "GitHub Light" theme for the Typst CodeMirror language.
 *
 * Palette reference:
 *   https://github.com/primer/github-vscode-theme  (light default)
 *
 * Matches the exact same semantic token assignments as dark.js so
 * the two files can be used as a reference pair.
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { typstTags } from "./highlight";

// ── Palette ──────────────────────────────────────────────────────────────────

const GH = {
    bg: "#ffffff",
    bgDark: "#f6f8fa",
    bgHighlight: "#f0f3f9",
    bgSelection: "#add6ff40",
    border: "#d0d7de",

    fg: "#24292f",
    fgGutter: "#8c959f",
    fgComment: "#6e7781",

    // Syntax colours
    red: "#cf222e",
    orange: "#953800",
    orangeBright: "#e16f24",
    yellow: "#9a6700",
    green: "#116329",
    teal: "#0550ae",
    cyan: "#0969da",
    blue: "#0550ae",
    blue2: "#218bff",
    purple: "#6639ba",
    magenta: "#8250df",
    pink: "#bf3989",

    // Special
    invalid: "#cf222e",
};

// ── Editor chrome ─────────────────────────────────────────────────────────────

export const githubLightTheme = EditorView.theme(
    {
        "&": {
            color: GH.fg,
            backgroundColor: GH.bg,
        },
        ".cm-content": { caretColor: GH.teal },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: GH.teal },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: GH.bgSelection,
        },
        ".cm-panels": { backgroundColor: GH.bgDark, color: GH.fg },
        ".cm-panels.cm-panels-top": { borderBottom: `2px solid ${GH.border}` },
        ".cm-panels.cm-panels-bottom": { borderTop: `2px solid ${GH.border}` },
        ".cm-searchMatch": {
            backgroundColor: "#ffd33d80",
            outline: `1px solid ${GH.yellow}`,
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: "#ffa7aa80",
        },
        ".cm-activeLine": { backgroundColor: GH.bgHighlight },
        ".cm-selectionMatch": { backgroundColor: "#add6ff40" },
        "&.cm-focused .cm-matchingBracket": {
            backgroundColor: "#34d05840",
            outline: `1px solid #34d05880`,
        },
        "&.cm-focused .cm-nonmatchingBracket": {
            backgroundColor: "#ffa7aa40",
        },
        ".cm-gutters": {
            backgroundColor: GH.bgDark,
            color: GH.fgGutter,
            border: "none",
            borderRight: `1px solid ${GH.border}`,
        },
        ".cm-activeLineGutter": {
            backgroundColor: GH.bgHighlight,
            color: GH.fgComment,
        },
        ".cm-foldPlaceholder": {
            backgroundColor: "transparent",
            border: "none",
            color: GH.fgComment,
        },
        ".cm-tooltip": {
            border: `1px solid ${GH.border}`,
            backgroundColor: GH.bgDark,
        },
        ".cm-completionMatchedText": {
            textDecoration: "none",
            color: GH.blue,
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
        color: GH.fgComment, fontStyle: "italic"
    },

    // ── Markup ──────────────────────────────────────────────────────────────────
    {
        tag: typstTags.heading,
        color: GH.cyan, fontWeight: "bold"
    },
    {
        tag: typstTags.strong,
        color: GH.orange, fontWeight: "bold"
    },
    {
        tag: typstTags.emph,
        color: GH.orange, fontStyle: "italic"
    },
    {
        tag: typstTags.raw,
        color: GH.red,
        backgroundColor: "#f6f8fa",
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        borderRadius: "3px",
        padding: "0 2px"
    },
    {
        tag: typstTags.escape,
        color: GH.magenta
    },
    {
        tag: typstTags.link,
        color: GH.blue, textDecoration: "underline"
    },
    {
        tag: typstTags.label,
        color: GH.yellow
    },
    {
        tag: typstTags.ref,
        color: GH.yellow
    },
    {
        tag: typstTags.listMarker,
        color: GH.orangeBright, fontWeight: "bold"
    },
    {
        tag: typstTags.listTerm,
        color: GH.cyan, fontWeight: "bold"
    },

    // ── Math ────────────────────────────────────────────────────────────────────
    {
        tag: typstTags.mathDelimiter,
        color: GH.magenta, fontWeight: "bold"
    },
    {
        tag: typstTags.mathOperator,
        color: GH.blue2
    },

    // ── Code — keywords ─────────────────────────────────────────────────────────
    {
        tag: typstTags.keyword,
        color: GH.red
    },
    {
        tag: t.keyword,
        color: GH.red
    },
    {
        tag: t.operatorKeyword,
        color: GH.red
    },

    // ── Code — operators & punctuation ───────────────────────────────────────────
    {
        tag: typstTags.operator,
        color: GH.fg
    },
    {
        tag: t.operator,
        color: GH.fg
    },
    {
        tag: t.compareOperator,
        color: GH.fg
    },
    {
        tag: t.updateOperator,
        color: GH.fg
    },
    {
        tag: typstTags.punctuation,
        color: GH.fg
    },
    {
        tag: t.punctuation,
        color: GH.fg
    },
    {
        tag: typstTags.hash,
        color: GH.red
    },
    {
        tag: t.meta,
        color: GH.red
    },

    // ── Code — literals ─────────────────────────────────────────────────────────
    {
        tag: typstTags.number,
        color: GH.orange
    },
    {
        tag: t.number,
        color: GH.orange
    },
    {
        tag: typstTags.string,
        color: GH.green
    },
    {
        tag: t.string,
        color: GH.green
    },
    {
        tag: t.escape,
        color: GH.magenta
    },

    // ── Code — identifiers ──────────────────────────────────────────────────────
    {
        tag: typstTags.function,
        color: GH.purple
    },
    {
        tag: t.function(t.variableName),
        color: GH.purple
    },
    {
        tag: typstTags.interpolated,
        color: GH.cyan
    },
    {
        tag: t.special(t.variableName),
        color: GH.cyan
    },
    {
        tag: t.definition(t.variableName),
        color: GH.cyan
    },
    {
        tag: t.propertyName,
        color: GH.teal
    },
    {
        tag: t.variableName,
        color: GH.fg
    },

    // ── Brackets ────────────────────────────────────────────────────────────────
    {
        tag: t.bracket,
        color: GH.fg
    },
    {
        tag: t.paren,
        color: GH.fg
    },
    {
        tag: t.squareBracket,
        color: GH.fg
    },
    {
        tag: t.brace,
        color: GH.fg
    },

    // ── Errors ─────────────────────────────────────────────────────────────────
    {
        tag: typstTags.error,
        color: GH.invalid,
        textDecoration: "underline wavy"
    },
    {
        tag: t.invalid,
        color: GH.invalid,
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