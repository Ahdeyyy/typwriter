// Completion for `@references` — document labels plus citation keys — and for
// the label argument of `#cite(...)` — citation keys only.
//
// typst-ide completes neither across files, so in a multi-file project —
// chapters plus a shared template, which is what Typst is used for — citing a
// figure defined in another chapter means remembering its exact label.

import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

import { describeEntry, type BibEntry } from '$lib/bibliography';
import {
    citePrefixAt,
    extractLabels,
    refPrefixAt,
    type LabelDef,
} from '$lib/references';
import { referenceCompletionSection } from './completion-sections';

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

/**
 * Project-scan labels combined with open-buffer labels.
 *
 * A label whose file is open as a tab comes from the buffer only: the
 * buffer's unsaved text is what the compiler would see, and counting the
 * stale disk copy too would both duplicate names and fake "N definitions".
 */
export function mergeLabels(
    scanned: readonly LabelDef[],
    buffered: readonly LabelDef[]
): LabelDef[] {
    const openPaths = new Set(buffered.map((label) => label.path));
    return [
        ...scanned.filter((label) => !openPaths.has(label.path)),
        ...buffered,
    ];
}

interface RefOption {
    label: string;
    type: string;
    detail: string;
}

/** Deduplicate by name, keeping the first definition and noting the rest. */
function labelOptions(labels: readonly LabelDef[]): RefOption[] {
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

function citationOptions(entries: readonly BibEntry[]): RefOption[] {
    const seen = new Set<string>();
    const options: RefOption[] = [];
    for (const entry of entries) {
        if (seen.has(entry.key)) continue;
        seen.add(entry.key);
        options.push({ label: entry.key, type: 'citation', detail: describeEntry(entry) });
    }
    return options;
}

/**
 * The merged option list for `@` targets: document labels and citation keys.
 *
 * Both share one list because Typst resolves `@key` against both — a citation
 * is not a separate syntax the user has to remember.
 */
function mergedOptions(
    labels: readonly LabelDef[],
    citations: readonly BibEntry[]
): RefOption[] {
    // Labels first: a name defined in the document itself is the more likely
    // target, and a `.bib` key colliding with a label is the author's own
    // naming collision to resolve.
    const options = labelOptions(labels);
    const taken = new Set(options.map((option) => option.label));
    options.push(
        ...citationOptions(citations).filter((option) => !taken.has(option.label))
    );
    return options;
}

/**
 * A completion source for `@` targets: document labels and citation keys,
 * and for the label argument of `#cite(...)`: citation keys only — `#cite`
 * resolves against a bibliography, not against document labels.
 *
 * Anchoring: `from` sits *after* the trigger character (`@`, `<`). CodeMirror
 * filters the option list by matching the text between `from` and the caret
 * against each option's label, so anchoring on the marker itself (or baking
 * it into `label`) would filter every option out. The marker is left in the
 * document untouched and accepting simply completes the name.
 *
 * Fires only where one of those is in progress, and is authoritative there:
 * the merged typst-ide source defers to it so the two do not offer competing
 * lists anchored at different offsets.
 */
export function referenceCompletionSource(
    labelsOf: () => LabelDef[],
    citationsOf: () => BibEntry[] = () => []
) {
    return (context: CompletionContext): CompletionResult | null => {
        const text = context.state.doc.toString();
        const ref = refPrefixAt(text, context.pos);
        const cite = ref ? null : citePrefixAt(text, context.pos);
        if (!ref && !cite) return null;

        if (ref) {
            // Labels first: a name defined in the document itself is the more
            // likely target, and a `.bib` key colliding with a label is the
            // author's own naming collision to resolve.
            const options = mergedOptions(labelsOf(), citationsOf());
            if (options.length === 0) return null;
            return {
                from: ref.from + 1,
                options: options.map((option) => ({
                    ...option,
                    apply: option.label,
                    section: referenceCompletionSection,
                })),
                // Let CodeMirror re-filter as the user types instead of asking
                // us again for every character.
                validFor: /^[\p{L}\p{N}_:.-]*$/u,
            };
        }

        const options = citationOptions(citationsOf());
        if (options.length === 0) return null;
        return {
            from: cite!.from,
            options: options.map((option) => ({
                ...option,
                apply: cite!.bracketed ? `${option.label}>` : `<${option.label}>`,
                section: referenceCompletionSection,
            })),
            // No closing `>` here: once it is typed the source runs again and
            // stops matching, which closes the list instead of re-filtering.
            validFor: /^[\p{L}\p{N}_:.-]*$/u,
        };
    };
}
