import { describe, expect, test } from 'bun:test';

import { highlightSegments, queryTerms, textMatches } from './search-text';

describe('queryTerms', () => {
    test('lowercases and splits on runs of whitespace', () => {
        expect(queryTerms('  Line   Numbers ')).toEqual(['line', 'numbers']);
    });

    test('an empty or blank query has no terms', () => {
        expect(queryTerms('')).toEqual([]);
        expect(queryTerms('   ')).toEqual([]);
    });
});

describe('textMatches', () => {
    const row = ['Editor font size', 'Between 8 and 32 pixels.', ['text size', 'zoom']];

    test('matches a substring of the title', () => {
        expect(textMatches(queryTerms('font'), row)).toBe(true);
    });

    test('matches case-insensitively', () => {
        expect(textMatches(queryTerms('FONT SIZE'), row)).toBe(true);
    });

    test('matches on keywords the visible copy does not contain', () => {
        expect(textMatches(queryTerms('zoom'), row)).toBe(true);
    });

    test('every word must appear — extra words narrow the result', () => {
        expect(textMatches(queryTerms('font pixels'), row)).toBe(true);
        expect(textMatches(queryTerms('font wrap'), row)).toBe(false);
    });

    test('words may come from different fields, in any order', () => {
        expect(textMatches(queryTerms('pixels editor'), row)).toBe(true);
    });

    test('skips absent fields instead of matching them', () => {
        expect(textMatches(queryTerms('font'), ['Word wrap', undefined, null])).toBe(false);
    });

    test('an empty query matches nothing — "not searching" is the caller\'s case', () => {
        expect(textMatches([], row)).toBe(false);
    });
});

describe('highlightSegments', () => {
    test('returns one unmarked run when there is no query', () => {
        expect(highlightSegments('Word wrap', [])).toEqual([{ text: 'Word wrap', hit: false }]);
    });

    test('returns one unmarked run when nothing matches', () => {
        expect(highlightSegments('Word wrap', ['zoom'])).toEqual([
            { text: 'Word wrap', hit: false },
        ]);
    });

    test('marks the hit and keeps the original casing', () => {
        expect(highlightSegments('Word Wrap', ['wrap'])).toEqual([
            { text: 'Word ', hit: false },
            { text: 'Wrap', hit: true },
        ]);
    });

    test('marks every occurrence of a term', () => {
        expect(highlightSegments('tab and tab', ['tab'])).toEqual([
            { text: 'tab', hit: true },
            { text: ' and ', hit: false },
            { text: 'tab', hit: true },
        ]);
    });

    test('merges overlapping terms into one run', () => {
        expect(highlightSegments('line width', ['line width', 'line', 'width'])).toEqual([
            { text: 'line width', hit: true },
        ]);
    });

    test('reassembles into the original text', () => {
        const text = 'Maximum line width in columns';
        const segments = highlightSegments(text, queryTerms('line columns'));
        expect(segments.map((s) => s.text).join('')).toBe(text);
        expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['line', 'columns']);
    });
});
