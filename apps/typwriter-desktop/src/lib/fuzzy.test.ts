import { describe, expect, it } from 'bun:test';
import { fuzzyMatch, fuzzyRank, fuzzySegments } from './fuzzy';

const score = (text: string, query: string) => fuzzyMatch(text, query)?.score ?? null;
const positions = (text: string, query: string) => fuzzyMatch(text, query)?.positions ?? null;

describe('fuzzyMatch', () => {
    it('matches an exact prefix', () => {
        expect(positions('Save file', 'sav')).toEqual([0, 1, 2]);
    });

    it('is case-insensitive both ways', () => {
        expect(positions('Save File', 'SAVE')).toEqual([0, 1, 2, 3]);
        expect(positions('SAVE FILE', 'save')).toEqual([0, 1, 2, 3]);
    });

    it('matches a non-contiguous subsequence', () => {
        expect(positions('Toggle the sidebar', 'tsb')).not.toBeNull();
    });

    it('returns null when the query is not a subsequence', () => {
        expect(fuzzyMatch('Save file', 'xyz')).toBeNull();
        // Right characters, wrong order.
        expect(fuzzyMatch('Save file', 'evas')).toBeNull();
    });

    it('treats an empty query as a match with no positions', () => {
        expect(fuzzyMatch('anything', '')).toEqual({ score: 0, positions: [] });
    });

    it('returns null for empty text with a non-empty query', () => {
        expect(fuzzyMatch('', 'a')).toBeNull();
    });

    it('prefers the contiguous run over an earlier split one', () => {
        // Greedy left-to-right would take a@0 then b@3; the tighter match is 2,3.
        expect(positions('a-ab', 'ab')).toEqual([2, 3]);
    });

    it('ranks word-start matches above mid-word ones', () => {
        const wordStart = score('Toggle Bold', 'tb');
        const midWord = score('Tabbed', 'tb');
        expect(wordStart).toBeGreaterThan(midWord!);
    });

    it('ranks a shorter label above a longer one for the same query', () => {
        expect(score('Save', 'save')).toBeGreaterThan(score('Save all open files', 'save')!);
    });

    it('rewards camelCase boundaries', () => {
        expect(fuzzyMatch('toggleSidebar', 'ts')).not.toBeNull();
        expect(positions('toggleSidebar', 'ts')).toEqual([0, 6]);
    });

    it('handles a query longer than the text', () => {
        expect(fuzzyMatch('ab', 'abc')).toBeNull();
    });

    it('handles repeated characters in the query', () => {
        expect(positions('aab', 'aa')).toEqual([0, 1]);
        expect(fuzzyMatch('ab', 'aa')).toBeNull();
    });
});

describe('fuzzySegments', () => {
    it('returns one unmarked run when nothing matched', () => {
        expect(fuzzySegments('hello', [])).toEqual([{ text: 'hello', hit: false }]);
    });

    it('returns nothing for empty text', () => {
        expect(fuzzySegments('', [])).toEqual([]);
    });

    it('coalesces adjacent positions into a single run', () => {
        // One span per character would make the highlight flicker between
        // letters at most font sizes.
        expect(fuzzySegments('save', [0, 1, 2])).toEqual([
            { text: 'sav', hit: true },
            { text: 'e', hit: false },
        ]);
    });

    it('marks disjoint runs separately', () => {
        expect(fuzzySegments('a-ab', [0, 2, 3])).toEqual([
            { text: 'a', hit: true },
            { text: '-', hit: false },
            { text: 'ab', hit: true },
        ]);
    });

    it('reconstructs the original text exactly', () => {
        const text = 'Toggle the sidebar';
        const match = fuzzyMatch(text, 'tsb')!;
        const joined = fuzzySegments(text, match.positions)
            .map((s) => s.text)
            .join('');
        expect(joined).toBe(text);
    });
});

describe('fuzzyRank', () => {
    const items = [
        { label: 'Save current file', path: 'a.typ' },
        { label: 'Save all files', path: 'b.typ' },
        { label: 'Format document', path: 'chapter/save-notes.typ' },
        { label: 'Open preview', path: 'c.typ' },
    ];

    it('returns everything for an empty query', () => {
        expect(fuzzyRank(items, '', (i) => i.label)).toHaveLength(4);
    });

    it('drops non-matches', () => {
        const out = fuzzyRank(items, 'save', (i) => i.label);
        expect(out.map((o) => o.item.label)).toEqual([
            'Save all files',
            'Save current file',
        ]);
    });

    it('matches secondary text but ranks it below a label hit', () => {
        const out = fuzzyRank(
            items,
            'save',
            (i) => i.label,
            (i) => i.path
        );
        const labels = out.map((o) => o.item.label);
        expect(labels).toContain('Format document');
        // The label hits come first; the path-only hit trails them.
        expect(labels.indexOf('Format document')).toBe(labels.length - 1);
    });

    it('gives no positions for a secondary-text hit', () => {
        // Positions index the secondary string, so applying them to the label
        // would highlight the wrong characters.
        const out = fuzzyRank(
            items,
            'notes',
            (i) => i.label,
            (i) => i.path
        );
        expect(out).toHaveLength(1);
        expect(out[0].match.positions).toEqual([]);
    });

    it('breaks score ties by label, so ordering is stable', () => {
        const tied = [{ label: 'beta' }, { label: 'alpha' }];
        const out = fuzzyRank(tied, '', (i) => i.label);
        expect(out.map((o) => o.item.label)).toEqual(['alpha', 'beta']);
    });
});
