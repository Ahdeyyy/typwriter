// Fuzzy subsequence matching for the command palette, the outline filter, the
// symbol picker and the package browser.
//
// Free of runes and DOM so it can be unit-tested directly. It differs from
// mobile's `fuzzyScore` in one way that matters here: it returns the matched
// character *positions*, so callers can mark the hits rather than just ranking.

/** Characters after which a match is treated as starting a new "word". */
const SEPARATORS = new Set([' ', '/', '\\', '-', '_', '.', ':']);

// Scoring weights. Tuned so that, for a query like "sav", "Save file" beats
// "Show advanced" (word-start hits) and "Save" beats "Save all" (shorter, so
// proportionally more of it matched).
const SCORE_MATCH = 16;
const BONUS_CONTIGUOUS = 12;
const BONUS_WORD_START = 10;
const BONUS_CAMEL = 8;
const BONUS_FIRST_CHAR = 12;
const PENALTY_GAP = 2;
/** Gap penalty is capped so one distant match can't dominate the ranking. */
const MAX_GAP_PENALTY = 12;

export interface FuzzyMatch {
    score: number;
    /** Indices into the original text, ascending. */
    positions: number[];
}

function isWordStart(text: string, index: number): boolean {
    if (index === 0) return true;
    return SEPARATORS.has(text[index - 1]);
}

function isCamelBoundary(text: string, index: number): boolean {
    if (index === 0) return false;
    const prev = text[index - 1];
    const cur = text[index];
    return prev === prev.toLowerCase() && cur === cur.toUpperCase() && cur !== cur.toLowerCase();
}

/**
 * Greedily match `query` against `text` starting at `from`, returning the
 * score and positions, or `null` if the query is not a subsequence from there.
 */
function matchFrom(
    text: string,
    lowerText: string,
    lowerQuery: string,
    from: number
): FuzzyMatch | null {
    const positions: number[] = [];
    let score = 0;
    let cursor = from;
    let previous = -1;

    for (let qi = 0; qi < lowerQuery.length; qi++) {
        const found = lowerText.indexOf(lowerQuery[qi], cursor);
        if (found === -1) return null;

        const wordStart = isWordStart(text, found);

        score += SCORE_MATCH;
        // `previous !== -1` matters: without it a match at index 0 satisfies
        // `found === previous + 1` and awards itself a contiguity bonus it
        // hasn't earned, which is enough to beat a genuinely tighter match
        // later in the string.
        if (previous !== -1 && found === previous + 1) score += BONUS_CONTIGUOUS;
        if (wordStart) score += BONUS_WORD_START;
        else if (isCamelBoundary(text, found)) score += BONUS_CAMEL;
        if (found === 0) score += BONUS_FIRST_CHAR;

        // Skipping the tail of the previous word to land on the start of the
        // next one is what an acronym match *is* ("tb" for "Toggle Bold"), so
        // it isn't penalised. Without this the gap penalty plus the
        // short-string coverage bonus let "Tabbed" outrank "Toggle Bold".
        if (previous !== -1 && !wordStart) {
            const gap = found - previous - 1;
            score -= Math.min(gap * PENALTY_GAP, MAX_GAP_PENALTY);
        }

        positions.push(found);
        previous = found;
        cursor = found + 1;
    }

    // Favour matches that cover more of a short string: "Save" should outrank
    // "Save all open files" for the query "save".
    score += Math.round((lowerQuery.length / Math.max(text.length, 1)) * 20);
    return { score, positions };
}

/**
 * Match `query` against `text`, case-insensitively, as a subsequence.
 * Returns `null` when it doesn't match. An empty query matches with score 0
 * and no positions, so callers can treat "not filtering" uniformly.
 *
 * Tries every possible starting point rather than committing to the first
 * one, so `ab` against `a-ab` highlights the contiguous pair at the end
 * instead of the split pair at the start.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
    if (!query) return { score: 0, positions: [] };
    if (!text) return null;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const first = lowerQuery[0];

    let best: FuzzyMatch | null = null;
    let start = lowerText.indexOf(first);
    while (start !== -1) {
        const candidate = matchFrom(text, lowerText, lowerQuery, start);
        if (candidate && (!best || candidate.score > best.score)) best = candidate;
        start = lowerText.indexOf(first, start + 1);
    }
    return best;
}

export interface FuzzySegment {
    text: string;
    hit: boolean;
}

/** Split `text` into marked/unmarked runs at `positions`, for rendering. */
export function fuzzySegments(text: string, positions: readonly number[]): FuzzySegment[] {
    if (positions.length === 0) return text ? [{ text, hit: false }] : [];

    const segments: FuzzySegment[] = [];
    let cursor = 0;
    let i = 0;
    while (i < positions.length) {
        const start = positions[i];
        let end = start + 1;
        // Coalesce adjacent positions into one run so a contiguous match
        // renders as a single highlighted span, not one span per character.
        while (i + 1 < positions.length && positions[i + 1] === end) {
            end++;
            i++;
        }
        if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
        segments.push({ text: text.slice(start, end), hit: true });
        cursor = end;
        i++;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
    return segments;
}

/**
 * Rank `items` against `query`, dropping non-matches.
 *
 * `key` supplies the primary text. `extra` may supply secondary text (a path,
 * keywords) that can match but scores lower, so a hit on the visible label
 * always outranks a hit on hidden metadata.
 */
export function fuzzyRank<T>(
    items: readonly T[],
    query: string,
    key: (item: T) => string,
    extra?: (item: T) => string | readonly string[] | undefined
): { item: T; match: FuzzyMatch }[] {
    const q = query.trim();
    const scored: { item: T; match: FuzzyMatch; tiebreak: string }[] = [];

    for (const item of items) {
        const label = key(item);
        let match = fuzzyMatch(label, q);

        if (!match && extra) {
            const secondary = extra(item);
            const parts =
                secondary === undefined
                    ? []
                    : typeof secondary === 'string'
                      ? [secondary]
                      : secondary;
            for (const part of parts) {
                const alt = fuzzyMatch(part, q);
                // Secondary hits never carry positions into the label — the
                // indices belong to a different string and would mis-highlight.
                if (alt && (!match || alt.score - 30 > match.score)) {
                    match = { score: alt.score - 30, positions: [] };
                }
            }
        }

        if (match) scored.push({ item, match, tiebreak: label });
    }

    scored.sort((a, b) => b.match.score - a.match.score || a.tiebreak.localeCompare(b.tiebreak));
    return scored.map(({ item, match }) => ({ item, match }));
}
