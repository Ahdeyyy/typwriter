// The text side of the settings search: turning a query into words, deciding
// whether a setting's copy answers to it, and slicing that copy up so the hits
// can be marked. Kept free of runes so it can be unit-tested on its own —
// `search.svelte.ts` wraps it in the reactive store the panes talk to.

/** Anything callers hand the matcher: visible copy, keyword lists, or the
 *  `undefined` that comes of an optional prop. */
export type Haystack = string | readonly string[] | null | undefined;

/** Split a raw query into the words a setting has to contain. */
export function queryTerms(query: string): string[] {
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when *every* term appears somewhere in `text`, so typing more words
 *  narrows the result rather than widening it. An empty term list matches
 *  nothing — callers treat "not searching" as its own case, since then
 *  everything is visible regardless. */
export function textMatches(terms: readonly string[], text: readonly Haystack[]): boolean {
    if (terms.length === 0) return false;
    const haystack = text
        .flat()
        .filter((part): part is string => !!part)
        .join(' ')
        .toLowerCase();
    return terms.every((term) => haystack.includes(term));
}

export interface HighlightSegment {
    text: string;
    hit: boolean;
}

/** Split `text` around the query words so a caller can mark the hits. Returns a
 *  single unmarked run when nothing matches. */
export function highlightSegments(
    text: string,
    terms: readonly string[],
): HighlightSegment[] {
    if (terms.length === 0) return [{ text, hit: false }];

    const lower = text.toLowerCase();
    const ranges: [number, number][] = [];
    for (const term of terms) {
        let from = lower.indexOf(term);
        while (from !== -1) {
            ranges.push([from, from + term.length]);
            from = lower.indexOf(term, from + term.length);
        }
    }
    if (ranges.length === 0) return [{ text, hit: false }];

    // Two query words can cover the same stretch of text ("line width" against
    // "line" + "width"), so merge the ranges before slicing.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([range[0], range[1]]);
    }

    const segments: HighlightSegment[] = [];
    let cursor = 0;
    for (const [start, end] of merged) {
        if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
        segments.push({ text: text.slice(start, end), hit: true });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
    return segments;
}
