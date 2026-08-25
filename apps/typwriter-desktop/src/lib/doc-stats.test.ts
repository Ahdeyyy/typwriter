import { describe, expect, it } from 'bun:test';
import { documentStats, selectionStats } from './doc-stats';

const words = (src: string) => documentStats(src).words;

describe('documentStats: what counts as prose', () => {
    it('is zero for an empty buffer', () => {
        expect(documentStats('')).toMatchObject({ words: 0, characters: 0 });
    });

    it('counts plain prose', () => {
        expect(words('Hello world, this is prose.')).toBe(5);
    });

    it('counts heading text', () => {
        // The reader sees it, so it is part of the document's length.
        expect(words('= Introduction\n\nBody text here.')).toBe(4);
    });

    it('counts prose nested inside a function call', () => {
        // See / nested / prose / here. — the `#emph` call itself is not prose.
        expect(words('See #emph[nested prose] here.')).toBe(4);
    });

    it('does not count code', () => {
        // `#let x = 1` is machinery, not something a reader reads.
        expect(words('#let x = 1\n\nOne word.')).toBe(2);
    });

    it('does not count math', () => {
        expect(words('$ a + b = c $\n\nTwo words.')).toBe(2);
    });

    it('does not count raw block contents', () => {
        const src = 'Prose here.\n\n```\nlots of code words in here\n```\n';
        expect(words(src)).toBe(2);
    });

    it('does not count comments', () => {
        expect(words('Real words.\n\n// these words are commented out\n')).toBe(2);
    });

    it('does not count labels or references as words', () => {
        // `<intro>` and `@intro` are anchors, not prose.
        expect(words('= Title <intro>\n\nSee @intro now.')).toBe(3);
    });

    it('does not count bare punctuation as a word', () => {
        // Typst emits `]` and a trailing `.` as their own Text nodes.
        expect(words('#strong[Bold] .')).toBe(1);
    });

    it('counts a number as a word', () => {
        expect(words('There are 42 items.')).toBe(4);
    });

    it('counts non-Latin scripts', () => {
        expect(words('日本語 テキスト')).toBe(2);
    });
});

describe('documentStats: character counts', () => {
    it('counts every character, markup included', () => {
        const src = '= Hi\n\nyo';
        expect(documentStats(src).characters).toBe(src.length);
    });

    it('excludes whitespace from charactersNoSpaces', () => {
        expect(documentStats('a b\nc').charactersNoSpaces).toBe(3);
    });

    it('counts prose characters separately from markup', () => {
        // "Hi" + "yo" = 4 prose characters, while the buffer is longer.
        const stats = documentStats('= Hi\n\nyo');
        expect(stats.proseCharacters).toBe(4);
        expect(stats.characters).toBeGreaterThan(stats.proseCharacters);
    });

    it('counts headings', () => {
        expect(documentStats('= A\n\n== B\n\n=== C\n').headings).toBe(3);
    });
});

describe('documentStats: reading time', () => {
    it('is zero for no words', () => {
        expect(documentStats('#let x = 1').readingMinutes).toBe(0);
    });

    it('rounds up to at least a minute for any prose', () => {
        expect(documentStats('one two three').readingMinutes).toBe(1);
    });

    it('scales with length', () => {
        const long = Array.from({ length: 2200 }, () => 'word').join(' ');
        expect(documentStats(long).readingMinutes).toBe(10);
    });
});

describe('selectionStats', () => {
    const src = '= Title\n\nAlpha beta gamma delta.';

    it('is empty for a collapsed selection', () => {
        expect(selectionStats(src, 5, 5).words).toBe(0);
    });

    it('counts only the selected range', () => {
        const from = src.indexOf('Alpha');
        const to = src.indexOf('gamma');
        expect(selectionStats(src, from, to).words).toBe(2);
    });

    it('normalises a backwards selection', () => {
        // Selecting right-to-left gives head < anchor; both must work.
        const from = src.indexOf('Alpha');
        const to = src.indexOf('gamma');
        expect(selectionStats(src, to, from).words).toBe(2);
    });

    it('clips a selection that ends mid-word', () => {
        const from = src.indexOf('Alpha');
        expect(selectionStats(src, from, from + 3).proseCharacters).toBe(3);
    });

    it('clamps out-of-range bounds instead of throwing', () => {
        expect(selectionStats(src, -50, 9999).words).toBe(5);
    });

    it('matches documentStats when the whole buffer is selected', () => {
        expect(selectionStats(src, 0, src.length)).toEqual(documentStats(src));
    });

    it('counts a heading inside the selection', () => {
        expect(selectionStats(src, 0, src.length).headings).toBe(1);
    });
});
