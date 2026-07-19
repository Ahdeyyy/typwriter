// Palette-driven CSS for tinymist semantic tokens.
//
// `semantic-tokens.ts` paints ranges with `cm-tok-<type>` / `cm-tokmod-<mod>`
// classes (the `<type>`/`<mod>` names come straight from the server's token
// legend). These rules colour them. The semantic tokens *supplement* the Lezer
// syntax highlighting: the highlighter runs at higher decoration precedence, so
// its spans nest inside the Lezer ones and win for the text they cover, while
// the always-on Lezer layer colours everything they don't. Selectors are scoped
// under `.cm-content` both to sit above the editor's base rules and to win the
// specificity tie in the case where a semantic class and a Lezer class land on
// the same span.

/** Palette keys both editor themes provide (dark `MD`, light `ML`). */
export interface TokenPalette {
    fg: string;
    ink: string;
    crimson: string;
    crimsonDark: string;
    violet: string;
    cobalt: string;
    amber: string;
    green: string;
    terracotta: string;
    indigo: string;
    navy: string;
    teal: string;
    sapphire: string;
    muted: string;
    faint: string;
    fgComment: string;
}

/** Build the `EditorView.theme(...)` selector map for semantic tokens. Covers
 *  both the generic LSP token-type names and tinymist's Typst-specific ones. */
export function semanticTokenRules(p: TokenPalette): Record<string, Record<string, string>> {
    return {
        // ── Comments & prose ────────────────────────────────────────────────
        ".cm-content .cm-tok-comment": { color: p.fgComment, fontStyle: "italic" },

        // ── Literals ────────────────────────────────────────────────────────
        ".cm-content .cm-tok-string": { color: p.green },
        ".cm-content .cm-tok-number": { color: p.terracotta },
        ".cm-content .cm-tok-bool": { color: p.crimson },

        // ── Keywords & operators ────────────────────────────────────────────
        ".cm-content .cm-tok-keyword": { color: p.crimson },
        ".cm-content .cm-tok-operator": { color: p.muted },
        ".cm-content .cm-tok-punctuation": { color: p.faint },
        ".cm-content .cm-tok-delimiter": { color: p.faint },
        ".cm-content .cm-tok-escape": { color: p.violet },

        // ── Identifiers ─────────────────────────────────────────────────────
        ".cm-content .cm-tok-function": { color: p.indigo },
        ".cm-content .cm-tok-method": { color: p.indigo },
        ".cm-content .cm-tok-decorator": { color: p.violet },
        ".cm-content .cm-tok-type": { color: p.sapphire },
        ".cm-content .cm-tok-class": { color: p.sapphire },
        ".cm-content .cm-tok-namespace": { color: p.sapphire },
        ".cm-content .cm-tok-parameter": { color: p.teal },
        ".cm-content .cm-tok-property": { color: p.teal },
        ".cm-content .cm-tok-variable": { color: p.fg },
        ".cm-content .cm-tok-interpolated": { color: p.navy },

        // ── Typst markup ────────────────────────────────────────────────────
        ".cm-content .cm-tok-heading": { color: p.ink, fontWeight: "900" },
        ".cm-content .cm-tok-marker": { color: p.crimson },
        ".cm-content .cm-tok-listMarker": { color: p.crimson },
        ".cm-content .cm-tok-term": { color: p.crimson },
        ".cm-content .cm-tok-link": { color: p.cobalt, textDecoration: "underline" },
        ".cm-content .cm-tok-raw": {
            color: p.terracotta,
            fontFamily: "'Iosevka','JetBrains Mono', 'Fira Code', Consolas, monospace",
        },
        ".cm-content .cm-tok-label": { color: p.amber },
        ".cm-content .cm-tok-ref": { color: p.amber },
        ".cm-content .cm-tok-pol": { color: p.navy },

        // ── Errors ──────────────────────────────────────────────────────────
        ".cm-content .cm-tok-error": { color: p.crimson, textDecoration: "underline wavy" },

        // ── Modifiers ───────────────────────────────────────────────────────
        ".cm-content .cm-tokmod-strong": { fontWeight: "bold" },
        ".cm-content .cm-tokmod-emph": { fontStyle: "italic" },
        ".cm-content .cm-tokmod-math": { fontStyle: "italic" },
        ".cm-content .cm-tokmod-deprecated": { textDecoration: "line-through" },
    };
}
