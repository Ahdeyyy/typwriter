import { describe, expect, it } from 'bun:test';
import { describeEntry, shortAuthor } from './bibliography';

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
