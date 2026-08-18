// Completion for `@references` from the `<labels>` defined across the project.
//
// typst-ide completes neither across files, so in a multi-file project —
// chapters plus a shared template, which is what Typst is used for — citing a
// figure defined in another chapter means remembering its exact label.

import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

import { extractLabels, refPrefixAt, type LabelDef } from '$lib/references';

export interface LabelSource {
    /** Buffers to harvest labels from: usually every open `.typ` tab. */
    buffers(): readonly { path: string; text: string }[];
}

/**
 * Labels from a set of buffers, re-extracting only those whose text changed.
 *
 * Parsing every open buffer on every keystroke of a reference would put N full
 * parses on the completion path; in practice only the buffer being typed in
 * has changed, so the rest come back from the cache.
 */
export function createLabelIndex(source: LabelSource): () => LabelDef[] {
    const cache = new Map<string, { text: string; labels: LabelDef[] }>();

    return () => {
        const buffers = source.buffers();
        const seen = new Set<string>();
        const all: LabelDef[] = [];

        for (const buffer of buffers) {
            seen.add(buffer.path);
            const cached = cache.get(buffer.path);
            if (cached && cached.text === buffer.text) {
                all.push(...cached.labels);
                continue;
            }
            const labels = extractLabels(buffer.text, buffer.path);
            cache.set(buffer.path, { text: buffer.text, labels });
            all.push(...labels);
        }

        // Drop buffers that are no longer open, so closing a big file releases
        // both its text and its labels.
        for (const path of [...cache.keys()]) {
            if (!seen.has(path)) cache.delete(path);
        }
        return all;
    };
}

/** Deduplicate by name, keeping the first definition and noting the rest. */
function toOptions(labels: readonly LabelDef[]) {
    const byName = new Map<string, LabelDef[]>();
    for (const label of labels) {
        const existing = byName.get(label.name);
        if (existing) existing.push(label);
        else byName.set(label.name, [label]);
    }

    return [...byName.entries()].map(([name, defs]) => ({
        label: name,
        type: 'reference',
        // Where it comes from is the disambiguating information when several
        // chapters define similar-looking labels.
        detail:
            defs.length > 1
                ? `${defs.length} definitions`
                : (defs[0].path || `line ${defs[0].line}`),
    }));
}

/**
 * A completion source for reference names.
 *
 * Fires only inside an `@…` in progress, and is authoritative there: the merged
 * typst-ide source defers to it so the two do not offer competing lists
 * anchored at different offsets.
 */
export function referenceCompletionSource(labelsOf: () => LabelDef[]) {
    return (context: CompletionContext): CompletionResult | null => {
        const text = context.state.doc.toString();
        const hit = refPrefixAt(text, context.pos);
        if (!hit) return null;

        const options = toOptions(labelsOf());
        if (options.length === 0) return null;

        return {
            // `from` is the `@` itself, so accepting replaces the marker too
            // and the result is exactly one `@name`.
            from: hit.from,
            options: options.map((option) => ({ ...option, apply: `@${option.label}` })),
            // Let CodeMirror re-filter as the user types instead of asking us
            // again for every character.
            validFor: /^@[\p{L}\p{N}_:.-]*$/u,
        };
    };
}
