import { describe, expect, it } from 'bun:test';
import { groupHits, totalHits } from './search-results';
import type { SearchHit } from './types';

const hit = (path: string, line: number): SearchHit => ({
    path,
    line,
    preview: `line ${line}`,
    matchStart: 0,
    matchEnd: 4,
    offset: line * 10,
});

describe('groupHits', () => {
    it('is empty for no hits', () => {
        expect(groupHits([])).toEqual([]);
    });

    it('groups consecutive hits from one file', () => {
        const groups = groupHits([hit('a.typ', 1), hit('a.typ', 5)]);
        expect(groups).toHaveLength(1);
        expect(groups[0].hits.map((h) => h.line)).toEqual([1, 5]);
    });

    it('keeps files in the order the backend returned them', () => {
        // Rust already sorts by path then line; re-sorting thousands of rows
        // here would be wasted work and could disagree with the backend.
        const groups = groupHits([hit('z.typ', 1), hit('a.typ', 1)]);
        expect(groups.map((g) => g.path)).toEqual(['z.typ', 'a.typ']);
    });

    it('splits the basename out for the header', () => {
        const [group] = groupHits([hit('chapters/one.typ', 1)]);
        expect(group).toMatchObject({ name: 'one.typ', dir: 'chapters' });
    });

    it('leaves dir empty for a root file', () => {
        const [group] = groupHits([hit('main.typ', 1)]);
        expect(group.dir).toBe('');
    });

    it('handles a nested path', () => {
        const [group] = groupHits([hit('a/b/c.typ', 1)]);
        expect(group).toMatchObject({ name: 'c.typ', dir: 'a/b' });
    });

    it('regroups hits for the same file that arrive apart', () => {
        // Defensive: if the backend ever interleaved, the panel must still show
        // one header per file rather than two.
        const groups = groupHits([hit('a.typ', 1), hit('b.typ', 1), hit('a.typ', 9)]);
        expect(groups).toHaveLength(2);
        expect(groups[0].hits.map((h) => h.line)).toEqual([1, 9]);
    });
});

describe('totalHits', () => {
    it('is zero for no groups', () => {
        expect(totalHits([])).toBe(0);
    });

    it('sums across groups', () => {
        const groups = groupHits([hit('a.typ', 1), hit('a.typ', 2), hit('b.typ', 1)]);
        expect(totalHits(groups)).toBe(3);
    });
});
