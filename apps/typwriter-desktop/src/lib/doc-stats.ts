// Word and character counts for a Typst buffer.
//
// Counting has to happen over the syntax tree, not the raw string: a writer
// asking "how long is this chapter" means the prose a reader sees, not the
// `#let` bindings, the math, the code fences or the comments that produce it.
// The grammar already separates those — markup prose is exactly the `Text`
// nodes — so this is a tree walk rather than a pile of regexes.

import { parser } from '$lib/typst-codemirror-lang/lezer-typst';

export interface DocStats {
    /** Whitespace-separated prose tokens containing at least one letter or digit. */
    words: number;
    /** Every character in the buffer, markup included. */
    characters: number;
    charactersNoSpaces: number;
    /** Characters inside markup prose only. */
    proseCharacters: number;
    headings: number;
    /** Whole minutes at an average adult silent-reading speed. */
    readingMinutes: number;
}

/** Words per minute used for the reading estimate — the usual figure for adult
 *  silent reading of general prose. */
const WORDS_PER_MINUTE = 220;

export const EMPTY_STATS: DocStats = {
    words: 0,
    characters: 0,
    charactersNoSpaces: 0,
    proseCharacters: 0,
    headings: 0,
    readingMinutes: 0,
};

/**
 * A token counts as a word when it contains a letter or a digit.
 *
 * Typst splits `prose.` into one `Text` node but `]` and a trailing `.` into
 * their own, so without this a stray punctuation node would inflate the count.
 */
function isWord(token: string): boolean {
    return /[\p{L}\p{N}]/u.test(token);
}

function countWords(prose: string): number {
    let count = 0;
    for (const token of prose.split(/\s+/)) {
        if (token && isWord(token)) count++;
    }
    return count;
}

/**
 * Collect the markup prose in `[from, to)`, plus the heading count.
 *
 * Ranges are clipped rather than filtered, so a selection ending mid-word
 * counts the part that is actually selected.
 */
function collect(
    text: string,
    from: number,
    to: number
): { prose: string; headings: number } {
    const tree = parser.parse(text);
    const parts: string[] = [];
    let headings = 0;

    tree.iterate({
        enter(node) {
            if (node.name === 'Heading' && node.from >= from && node.from < to) {
                headings++;
                return;
            }
            if (node.name !== 'Text') return;

            const start = Math.max(node.from, from);
            const end = Math.min(node.to, to);
            if (start < end) parts.push(text.slice(start, end));
        },
    });

    // Joined with spaces because adjacent `Text` nodes are separate words —
    // the `Space` nodes between them are not collected.
    return { prose: parts.join(' '), headings };
}

function statsOver(text: string, from: number, to: number): DocStats {
    if (!text || from >= to) return EMPTY_STATS;

    const slice = text.slice(from, to);
    const { prose, headings } = collect(text, from, to);
    const words = countWords(prose);

    return {
        words,
        characters: slice.length,
        charactersNoSpaces: slice.replace(/\s/g, '').length,
        proseCharacters: prose.replace(/\s/g, '').length,
        headings,
        readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    };
}

/** Stats for a whole buffer. */
export function documentStats(text: string): DocStats {
    return statsOver(text, 0, text.length);
}

/** Stats for a selected range. Returns [`EMPTY_STATS`] for an empty selection. */
export function selectionStats(text: string, from: number, to: number): DocStats {
    const start = Math.max(0, Math.min(from, to));
    const end = Math.min(text.length, Math.max(from, to));
    return statsOver(text, start, end);
}
