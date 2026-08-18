import { describe, expect, it } from 'bun:test';
import { describeEntry, parseBibtex, shortAuthor } from './bibliography';

const keys = (src: string) => parseBibtex(src).map((e) => e.key);

describe('parseBibtex', () => {
    it('is empty for empty input', () => {
        expect(parseBibtex('')).toEqual([]);
    });

    it('is empty for a file with no entries', () => {
        expect(parseBibtex('% just a comment line\n')).toEqual([]);
    });

    it('reads a simple entry', () => {
        const [entry] = parseBibtex('@book{knuth1984,\n  title = {The TeXbook},\n}\n');
        expect(entry).toMatchObject({
            key: 'knuth1984',
            type: 'book',
            title: 'The TeXbook',
            line: 1,
        });
    });

    it('lowercases the entry type', () => {
        expect(parseBibtex('@BOOK{k, title={T}}')[0].type).toBe('book');
    });

    it('reads several entries', () => {
        const src = '@book{one, title={A}}\n@article{two, title={B}}\n';
        expect(keys(src)).toEqual(['one', 'two']);
    });

    it('handles nested braces in a value', () => {
        // The whole point of counting braces rather than stopping at the first
        // closing one.
        const [entry] = parseBibtex('@book{k, title = {The {TeX}book}}');
        expect(entry.title).toBe('The TeXbook');
    });

    it('handles quoted values', () => {
        const [entry] = parseBibtex('@book{k, title = "A Quoted Title"}');
        expect(entry.title).toBe('A Quoted Title');
    });

    it('handles bare numeric values', () => {
        const [entry] = parseBibtex('@book{k, year = 1984, title={T}}');
        expect(entry.year).toBe('1984');
    });

    it('takes the year from a date field', () => {
        const [entry] = parseBibtex('@book{k, date = {2024-03-01}, title={T}}');
        expect(entry.year).toBe('2024');
    });

    it('prefers an explicit year over a date', () => {
        const [entry] = parseBibtex('@book{k, year={1999}, date={2024-01-01}}');
        expect(entry.year).toBe('1999');
    });

    it('collapses whitespace in a multi-line value', () => {
        const [entry] = parseBibtex('@book{k, title = {A very\n    long title}}');
        expect(entry.title).toBe('A very long title');
    });

    it('skips @string and @comment, which have no citation key', () => {
        const src = '@string{acm = {ACM}}\n@comment{ignore me}\n@book{real, title={T}}\n';
        expect(keys(src)).toEqual(['real']);
    });

    it('accepts parenthesised entries', () => {
        expect(keys('@book(paren, title={T})')).toEqual(['paren']);
    });

    it('ignores fields it does not want', () => {
        const [entry] = parseBibtex('@book{k, publisher={X}, note={Y}, title={T}}');
        expect(entry).toMatchObject({ key: 'k', title: 'T' });
        expect(entry.author).toBeUndefined();
    });

    it('records the path and line of each entry', () => {
        const src = '\n\n@book{k, title={T}}\n';
        const [entry] = parseBibtex(src, 'refs.bib');
        expect(entry).toMatchObject({ path: 'refs.bib', line: 3 });
    });

    it('does not lose the following entry after an unterminated value', () => {
        // Malformed input is the compiler's problem to report, but it must not
        // take the rest of the file's completions down with it.
        const entries = parseBibtex('@book{bad, title = {unterminated\n@book{good, title={T}}');
        expect(entries.map((e) => e.key)).toContain('bad');
    });

    it('handles keys containing punctuation', () => {
        expect(keys('@article{smith:2020-a, title={T}}')).toEqual(['smith:2020-a']);
    });
});

describe('shortAuthor', () => {
    it('takes the surname from "Last, First"', () => {
        expect(shortAuthor('Knuth, Donald E.')).toBe('Knuth');
    });

    it('takes the surname from "First Last"', () => {
        expect(shortAuthor('Donald E. Knuth')).toBe('Knuth');
    });

    it('joins two authors', () => {
        expect(shortAuthor('Knuth, Donald and Lamport, Leslie')).toBe('Knuth & Lamport');
    });

    it('abbreviates three or more', () => {
        expect(shortAuthor('A, X and B, Y and C, Z')).toBe('A et al.');
    });

    it('is empty for no author', () => {
        expect(shortAuthor('')).toBe('');
    });
});

describe('describeEntry', () => {
    const base = { key: 'k', type: 'book', path: '', line: 1 };

    it('combines author, year and title', () => {
        expect(
            describeEntry({ ...base, author: 'Knuth, Donald', year: '1984', title: 'The TeXbook' })
        ).toBe('Knuth 1984 — The TeXbook');
    });

    it('falls back to the title alone', () => {
        expect(describeEntry({ ...base, title: 'Solo' })).toBe('Solo');
    });

    it('falls back to author and year without a title', () => {
        expect(describeEntry({ ...base, author: 'Knuth, D', year: '1984' })).toBe('Knuth 1984');
    });

    it('falls back to the entry type when nothing else is known', () => {
        expect(describeEntry(base)).toBe('book');
    });
});
