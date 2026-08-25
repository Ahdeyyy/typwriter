// Icons for the autocomplete popup.
//
// CodeMirror draws them with `content:` and a single character — `𝑥` (U+1D465),
// `𝐶` (U+1D436), `𝑡` (U+1D461), `□`, `🔑︎`. Those inherit the *editor* font, and
// the coding fonts we ship (Iosevka, JetBrains Mono, Fira Code) carry none of
// the Mathematical Alphanumeric Symbols block, so much of the list renders as
// tofu boxes. The completion types we invent ourselves (`snippet`, `label`,
// `path`, …) have no built-in rule at all and render as a blank gutter.
//
// So draw them instead: each icon is a Phosphor glyph (bold weight, the 256×256
// viewBox the package ships) inlined as an SVG mask and painted with
// `background-color`. That is font-independent, and it lets every kind carry a
// palette colour so the list is scannable by shape *and* hue.

import type { TokenPalette } from "./semantic-tokens-theme";

type Rule = Record<string, string>;

// ── Phosphor paths (bold weight) ──────────────────────────────────────────────

const P = {
    function:
        "M212,40a12,12,0,0,1-12,12H170.71A20,20,0,0,0,151,68.42L142.38,116H184a12,12,0,0,1,0,24H138l-9.44,51.87A44,44,0,0,1,85.29,228H56a12,12,0,0,1,0-24H85.29A20,20,0,0,0,105,187.58L113.62,140H72a12,12,0,0,1,0-24h46l9.44-51.87A44,44,0,0,1,170.71,28H200A12,12,0,0,1,212,40Z",
    cube: "M225.6,62.64l-88-48.17a19.91,19.91,0,0,0-19.2,0l-88,48.17A20,20,0,0,0,20,80.19v95.62a20,20,0,0,0,10.4,17.55l88,48.17a19.89,19.89,0,0,0,19.2,0l88-48.17A20,20,0,0,0,236,175.81V80.19A20,20,0,0,0,225.6,62.64ZM128,36.57,200,76,128,115.4,56,76ZM44,96.79l72,39.4v76.67L44,173.44Zm96,116.07V136.19l72-39.4v76.65Z",
    plugs: "M137,168l11.52-11.51a12,12,0,0,0-17-17L120,151l-15-15,11.52-11.51a12,12,0,0,0-17-17L88,119,72.49,103.51a12,12,0,0,0-17,17L59,124,38.54,144.49a36,36,0,0,0,0,50.91l2.55,2.54L15.51,223.51a12,12,0,0,0,17,17l25.57-25.58,2.54,2.55a36.06,36.06,0,0,0,50.91,0L132,197l3.51,3.52a12,12,0,0,0,17-17ZM94.54,200.49a12,12,0,0,1-17,0L55.51,178.43a12,12,0,0,1,0-17L76,141l39,39Zm146-185a12,12,0,0,0-17,0L197.94,41.09l-2.54-2.55a36.05,36.05,0,0,0-50.91,0L124,59l-3.51-3.52a12,12,0,0,0-17,17l80,80a12,12,0,0,0,17-17L197,132l20.49-20.49a36,36,0,0,0,0-50.91l-2.55-2.54,25.58-25.57A12,12,0,0,0,240.49,15.51Zm-40,79L180,115,141,76l20.49-20.49a12,12,0,0,1,17,0l22.06,22.06a12,12,0,0,1,0,17Z",
    package:
        "M225.6,62.64l-88-48.17a19.91,19.91,0,0,0-19.2,0l-88,48.17A20,20,0,0,0,20,80.19v95.62a20,20,0,0,0,10.4,17.55l88,48.17a19.89,19.89,0,0,0,19.2,0l88-48.17A20,20,0,0,0,236,175.81V80.19A20,20,0,0,0,225.6,62.64ZM128,36.57,200,76,178.57,87.73l-72-39.42Zm0,78.83L56,76,81.56,62l72,39.41ZM44,96.79l72,39.4v76.67L44,173.44Zm96,116.07V136.19l24-13.13V152a12,12,0,0,0,24,0V109.92l24-13.13v76.65Z",
    sliders:
        "M40,92H70.06a36,36,0,0,0,67.88,0H216a12,12,0,0,0,0-24H137.94a36,36,0,0,0-67.88,0H40a12,12,0,0,0,0,24Zm64-24A12,12,0,1,1,92,80,12,12,0,0,1,104,68Zm112,96H201.94a36,36,0,0,0-67.88,0H40a12,12,0,0,0,0,24h94.06a36,36,0,0,0,67.88,0H216a12,12,0,0,0,0-24Zm-48,24a12,12,0,1,1,12-12A12,12,0,0,1,168,188Z",
    braces: "M54.8,119.49A35.06,35.06,0,0,1,49.05,128a35.06,35.06,0,0,1,5.75,8.51C60,147.24,60,159.83,60,172c0,25.94,1.84,32,20,32a12,12,0,0,1,0,24c-19.14,0-32.2-6.9-38.8-20.51C36,196.76,36,184.17,36,172c0-25.94-1.84-32-20-32a12,12,0,0,1,0-24c18.16,0,20-6.06,20-32,0-12.17,0-24.76,5.2-35.49C47.8,34.9,60.86,28,80,28a12,12,0,0,1,0,24c-18.16,0-20,6.06-20,32C60,96.17,60,108.76,54.8,119.49ZM240,116c-18.16,0-20-6.06-20-32,0-12.17,0-24.76-5.2-35.49C208.2,34.9,195.14,28,176,28a12,12,0,0,0,0,24c18.16,0,20,6.06,20,32,0,12.17,0,24.76,5.2,35.49A35.06,35.06,0,0,0,207,128a35.06,35.06,0,0,0-5.75,8.51C196,147.24,196,159.83,196,172c0,25.94-1.84,32-20,32a12,12,0,0,0,0,24c19.14,0,32.2-6.9,38.8-20.51C220,196.76,220,184.17,220,172c0-25.94,1.84-32,20-32a12,12,0,0,0,0-24Z",
    hash: "M224,84H180.2l7.61-41.85a12,12,0,0,0-23.62-4.3L155.8,84H116.2l7.61-41.85a12,12,0,1,0-23.62-4.3L91.8,84H48a12,12,0,0,0,0,24H87.44l-7.27,40H32a12,12,0,0,0,0,24H75.8l-7.61,41.85a12,12,0,0,0,9.66,14A11.43,11.43,0,0,0,80,228a12,12,0,0,0,11.8-9.86L100.2,172h39.6l-7.61,41.85a12,12,0,0,0,9.66,14,11.43,11.43,0,0,0,2.16.2,12,12,0,0,0,11.8-9.86L164.2,172H208a12,12,0,0,0,0-24H168.56l7.27-40H224a12,12,0,0,0,0-24Zm-79.83,64H104.56l7.27-40h39.61Z",
    key: "M196,76a16,16,0,1,1-16-16A16,16,0,0,1,196,76Zm48,22.74A84.3,84.3,0,0,1,160.11,180H160a83.52,83.52,0,0,1-23.65-3.38l-7.86,7.87A12,12,0,0,1,120,188H108v12a12,12,0,0,1-12,12H84v12a12,12,0,0,1-12,12H40a20,20,0,0,1-20-20V187.31a19.86,19.86,0,0,1,5.86-14.14l53.52-53.52A84,84,0,1,1,244,98.74ZM202.43,53.57A59.48,59.48,0,0,0,158,36c-32,1-58,27.89-58,59.89a59.69,59.69,0,0,0,4.2,22.19,12,12,0,0,1-2.55,13.21L44,189v23H60V200a12,12,0,0,1,12-12H84V176a12,12,0,0,1,12-12h19l9.65-9.65a12,12,0,0,1,13.22-2.55A59.58,59.58,0,0,0,160,156h.08c32,0,58.87-26.07,59.89-58A59.55,59.55,0,0,0,202.43,53.57Z",
    textAa: "M90.86,50.89a12,12,0,0,0-21.72,0l-64,136a12,12,0,0,0,21.71,10.22L42.44,164h75.12l15.58,33.11a12,12,0,0,0,21.72-10.22ZM53.74,140,80,84.18,106.27,140ZM200,84c-13.85,0-24.77,3.86-32.45,11.48a12,12,0,1,0,16.9,17c3-3,8.26-4.52,15.55-4.52,11,0,20,7.18,20,16v4.39A47.28,47.28,0,0,0,200,124c-24.26,0-44,17.94-44,40s19.74,40,44,40a47.18,47.18,0,0,0,22-5.38A12,12,0,0,0,244,192V124C244,101.94,224.26,84,200,84Zm0,96c-11,0-20-7.18-20-16s9-16,20-16,20,7.18,20,16S211,180,200,180Z",
    lightning:
        "M219.71,117.38a12,12,0,0,0-7.25-8.52L161.28,88.39l10.59-70.61a12,12,0,0,0-20.64-10l-112,120a12,12,0,0,0,4.31,19.33l51.18,20.47L84.13,238.22a12,12,0,0,0,20.64,10l112-120A12,12,0,0,0,219.71,117.38ZM113.6,203.55l6.27-41.77a12,12,0,0,0-7.41-12.92L68.74,131.37,142.4,52.45l-6.27,41.77a12,12,0,0,0,7.41,12.92l43.72,17.49Z",
    quotes: "M100,52H40A20,20,0,0,0,20,72v64a20,20,0,0,0,20,20H96v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,100,52Zm-4,80H44V76H96ZM216,52H156a20,20,0,0,0-20,20v64a20,20,0,0,0,20,20h56v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,216,52Zm-4,80H160V76h52Z",
    bookmark:
        "M184,28H72A20,20,0,0,0,52,48V224a12,12,0,0,0,18.36,10.18l57.63-36,57.65,36A12,12,0,0,0,204,224V48A20,20,0,0,0,184,28Zm-4,174.35-45.65-28.53a12,12,0,0,0-12.72,0L76,202.35V52H180Z",
    file: "M216.49,79.52l-56-56A12,12,0,0,0,152,20H56A20,20,0,0,0,36,40V216a20,20,0,0,0,20,20H200a20,20,0,0,0,20-20V88A12,12,0,0,0,216.49,79.52ZM160,57l23,23H160ZM60,212V44h76V92a12,12,0,0,0,12,12h48V212Z",
    textT: "M212,56V88a12,12,0,0,1-24,0V68H140V188h20a12,12,0,0,1,0,24H96a12,12,0,0,1,0-24h20V68H68V88a12,12,0,0,1-24,0V56A12,12,0,0,1,56,44H200A12,12,0,0,1,212,56Z",
    sigma: "M180,72V60H89l48.4,60.5a12,12,0,0,1,0,15L89,196h91V184a12,12,0,0,1,24,0v24a12,12,0,0,1-12,12H64a12,12,0,0,1-9.37-19.5l58-72.5-58-72.5A12,12,0,0,1,64,36H192a12,12,0,0,1,12,12V72a12,12,0,0,1-24,0Z",
    code: "M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44ZM164.1,28.72a12,12,0,0,0-15.38,7.18l-64,176a12,12,0,0,0,7.18,15.37A11.79,11.79,0,0,0,96,228a12,12,0,0,0,11.28-7.9l64-176A12,12,0,0,0,164.1,28.72Z",
    list: "M76,64A12,12,0,0,1,88,52H216a12,12,0,0,1,0,24H88A12,12,0,0,1,76,64Zm140,52H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Zm0,64H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,112a16,16,0,1,0,16,16A16,16,0,0,0,44,112Zm0-64A16,16,0,1,0,60,64,16,16,0,0,0,44,48Zm0,128a16,16,0,1,0,16,16A16,16,0,0,0,44,176Z",
    dot: "M128,90a38,38,0,1,0,38,38A38,38,0,0,0,128,90Z",
} as const;

/** An `::after` rule that paints `path` in `color` through an SVG mask. */
function icon(path: string, color: string): Rule {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="${path}"/></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    return {
        content: "''",
        display: "block",
        width: "1em",
        height: "1em",
        backgroundColor: color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
    };
}

/** Build the `EditorView.theme(...)` selector map for completion icons.
 *
 *  Covers the types `mapBackendCompletionKind` emits for typst-ide, the ones
 *  `@codemirror/lsp-client` emits for tinymist, and our own `snippet` /
 *  `reference` / `citation` sources. */
export function completionIconRules(p: TokenPalette): Record<string, Rule> {
    const kinds: Record<string, readonly [string, string]> = {
        // typst-ide's `CompletionKind`, plus the LSP kinds that land on it.
        function: [P.function, p.indigo],
        method: [P.function, p.indigo],
        type: [P.cube, p.sapphire],
        class: [P.cube, p.sapphire],
        interface: [P.plugs, p.sapphire],
        enum: [P.list, p.sapphire],
        property: [P.sliders, p.teal],
        variable: [P.braces, p.fg],
        constant: [P.hash, p.terracotta],
        keyword: [P.key, p.crimson],
        syntax: [P.code, p.crimson],
        namespace: [P.package, p.violet],
        package: [P.package, p.violet],
        path: [P.file, p.cobalt],
        label: [P.bookmark, p.amber],
        font: [P.textT, p.navy],
        symbol: [P.sigma, p.violet],
        text: [P.textAa, p.muted],
        // Ours: snippets, `@label` targets, `@citation` keys.
        snippet: [P.lightning, p.green],
        reference: [P.bookmark, p.amber],
        citation: [P.quotes, p.navy],
    };

    const rules: Record<string, Rule> = {
        // The base theme sizes the icon as a centred inline-block of *text*; the
        // masks are boxes, so centre them with flex instead, and drop the
        // blanket `opacity: .6` that would mute the palette colours.
        ".cm-completionIcon": {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.1em",
            paddingRight: "0.5em",
            fontSize: "100%",
            opacity: "1",
            boxSizing: "content-box",
        },
        // Fallback for entries with no `type` at all — `@codemirror/lsp-client`
        // leaves tinymist's Snippet/File/Folder/Event/Operator kinds unmapped,
        // and a blank gutter next to iconed neighbours reads as a bug. Listed
        // before the per-kind rules so those (same specificity) override it.
        ".cm-completionIcon::after": icon(P.dot, p.faint),
    };
    for (const [kind, [path, color]] of Object.entries(kinds)) {
        rules[`.cm-completionIcon-${kind}::after`] = icon(path, color);
    }
    return rules;
}
