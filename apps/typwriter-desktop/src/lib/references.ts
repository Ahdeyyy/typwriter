// Labels and references across a Typst project.
//
// `<label>` defines an anchor; `@label` refers to it. typst-ide completes
// neither across files, so in a multi-file project — the case Typst is
// actually used for — referencing a figure defined in another chapter means
// remembering the exact label name.
//
// Extraction goes through the grammar, so a `<not-a-label>` inside a raw block
// or a comment is correctly ignored.

import { parser } from '$lib/typst-codemirror-lang/lezer-typst';
import { lineAt, lineStarts } from '$lib/text-position';

export interface LabelDef {
    name: string;
    /** File the label was found in. Empty when extracted from a bare string. */
    path: string;
    from: number;
    to: number;
    line: number;
}

export interface RefUse {
    name: string;
    path: string;
    from: number;
    to: number;
    line: number;
}

/**
 * Characters Typst allows inside a label name.
 *
 * The parser is deliberately lenient about where a `Ref` node ends — it
 * includes a trailing `.` (`@intro.` at the end of a sentence) and any
 * `[supplement]` — so the name has to be re-extracted rather than taken from
 * the node's own bounds.
 */
const LABEL_CHARS = /^[\p{L}\p{N}_:.-]*/u;

/** Single-character form of [`LABEL_CHARS`], for scanning backwards.
 *
 *  It has to be its own pattern: `LABEL_CHARS` ends in `*`, so `.test()` on it
 *  matches the empty string and therefore returns true for *any* character. */
const LABEL_CHAR = /[\p{L}\p{N}_:.-]/u;

/** Trailing punctuation that reads as sentence punctuation, not part of the name. */
const TRAILING_PUNCT = /[.:-]+$/;

/** The label name inside a `Ref` node's text, which starts with `@`. */
export function refName(raw: string): string {
    const body = raw.startsWith('@') ? raw.slice(1) : raw;
    return (body.match(LABEL_CHARS)?.[0] ?? '').replace(TRAILING_PUNCT, '');
}

/** The label name inside a `Label` node's text, which is wrapped in `<>`. */
export function labelName(raw: string): string {
    return raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
}

export function extractLabels(text: string, path = ''): LabelDef[] {
    if (!text) return [];
    const tree = parser.parse(text);
    const starts = lineStarts(text);
    const out: LabelDef[] = [];

    tree.iterate({
        enter(node) {
            if (node.name !== 'Label') return;
            const name = labelName(text.slice(node.from, node.to));
            if (!name) return;
            out.push({
                name,
                path,
                from: node.from,
                to: node.to,
                line: lineAt(starts, node.from),
            });
        },
    });
    return out;
}

export function extractRefs(text: string, path = ''): RefUse[] {
    if (!text) return [];
    const tree = parser.parse(text);
    const starts = lineStarts(text);
    const out: RefUse[] = [];

    tree.iterate({
        enter(node) {
            if (node.name !== 'Ref') return;
            const raw = text.slice(node.from, node.to);
            const name = refName(raw);
            if (!name) return;
            out.push({
                name,
                path,
                from: node.from,
                // Bound the range to the name so a "jump to definition" or a
                // squiggle covers `@intro`, not `@intro[Chapter].`
                to: node.from + 1 + name.length,
                line: lineAt(starts, node.from),
            });
        },
    });
    return out;
}

/** Index label definitions by name. A name may legitimately appear once per
 *  project; more than one entry is a duplicate, which Typst rejects. */
export function indexLabels(labels: readonly LabelDef[]): Map<string, LabelDef[]> {
    const index = new Map<string, LabelDef[]>();
    for (const label of labels) {
        const existing = index.get(label.name);
        if (existing) existing.push(label);
        else index.set(label.name, [label]);
    }
    return index;
}

/** Names defined more than once, with every definition. */
export function duplicateLabels(labels: readonly LabelDef[]): Map<string, LabelDef[]> {
    const duplicates = new Map<string, LabelDef[]>();
    for (const [name, defs] of indexLabels(labels)) {
        if (defs.length > 1) duplicates.set(name, defs);
    }
    return duplicates;
}

/** References with no matching definition in `known`. */
export function danglingRefs(
    refs: readonly RefUse[],
    known: ReadonlySet<string>
): RefUse[] {
    return refs.filter((ref) => !known.has(ref.name));
}

/**
 * Whether `offset` sits inside a reference the user is still typing, and if so
 * what they have typed — the completion source's trigger test.
 *
 * Works on the raw text before the caret rather than the tree, because the
 * text mid-typing (`@fig-`) frequently does not parse as a `Ref` yet.
 */
export function refPrefixAt(text: string, offset: number): { from: number; prefix: string } | null {
    let i = offset;
    while (i > 0 && LABEL_CHAR.test(text[i - 1])) i--;
    if (i === 0 || text[i - 1] !== '@') return null;

    // A bare `@` yields an empty prefix and still triggers, so the full list
    // is offered before the user has typed anything.
    return { from: i - 1, prefix: text.slice(i, offset) };
}
