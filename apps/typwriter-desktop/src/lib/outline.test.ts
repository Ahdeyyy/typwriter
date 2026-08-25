import { describe, expect, it } from 'bun:test';
import { activeOutlineIndex, extractOutline, outlineBreadcrumb } from './outline';

const titles = (src: string) => extractOutline(src).map((i) => i.title);
const levels = (src: string) => extractOutline(src).map((i) => i.level);

describe('extractOutline', () => {
    it('returns nothing for empty input', () => {
        expect(extractOutline('')).toEqual([]);
    });

    it('returns nothing for a document with no headings', () => {
        expect(extractOutline('Just some prose.\n\nMore prose.')).toEqual([]);
    });

    it('extracts a single heading', () => {
        const items = extractOutline('= Introduction\n');
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Introduction');
        expect(items[0].level).toBe(1);
        expect(items[0].line).toBe(1);
    });

    it('reads the level from the marker length', () => {
        expect(levels('= One\n\n== Two\n\n=== Three\n')).toEqual([1, 2, 3]);
    });

    it('reports 1-based line numbers', () => {
        const items = extractOutline('intro\n\n= First\n\ntext\n\n== Second\n');
        expect(items.map((i) => i.line)).toEqual([3, 7]);
    });

    it('strips a trailing label from the title', () => {
        // The label is an anchor for @refs, not part of the visible title.
        expect(titles('= Introduction <intro>\n')).toEqual(['Introduction']);
    });

    it('keeps angle brackets that are not a trailing label', () => {
        expect(titles('= Comparing <a> and <b> values\n')).toEqual([
            'Comparing <a> and <b> values',
        ]);
    });

    it('does not treat an = inside a raw block as a heading', () => {
        // This is the reason the outline goes through the parser rather than
        // scanning lines for a leading "=".
        const src = '= Real\n\n```\n= not a heading\n```\n\n== Also real\n';
        expect(titles(src)).toEqual(['Real', 'Also real']);
    });

    it('does not treat an = inside a comment as a heading', () => {
        expect(titles('= Real\n\n// = commented out\n')).toEqual(['Real']);
    });

    it('labels an empty heading rather than dropping it', () => {
        // Dropping it would make the outline disagree with the document.
        expect(titles('=\n')).toEqual(['(untitled)']);
    });

    it('returns items in document order', () => {
        const items = extractOutline('= A\n\n== B\n\n= C\n');
        const offsets = items.map((i) => i.from);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
        expect(items.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    });

    it('offsets point at the heading start in the source', () => {
        const src = 'text\n\n= Target\n';
        const [item] = extractOutline(src);
        expect(src.slice(item.from, item.from + 8)).toBe('= Target');
    });

    it('handles a heading after code without losing it', () => {
        expect(titles('#let x = 1\n\n= After code\n')).toEqual(['After code']);
    });

    it('handles CRLF line endings', () => {
        const items = extractOutline('= One\r\n\r\n== Two\r\n');
        expect(items.map((i) => i.title)).toEqual(['One', 'Two']);
    });
});

describe('activeOutlineIndex', () => {
    const items = extractOutline('= A\n\ntext\n\n== B\n\nmore\n\n= C\n');

    it('is -1 above the first heading', () => {
        expect(activeOutlineIndex(items, 0)).toBe(0);
        expect(activeOutlineIndex([], 5)).toBe(-1);
    });

    it('tracks the cursor into later sections', () => {
        expect(activeOutlineIndex(items, items[1].from)).toBe(1);
        expect(activeOutlineIndex(items, items[2].from + 1)).toBe(2);
    });

    it('stays on the last heading past the end', () => {
        expect(activeOutlineIndex(items, 9999)).toBe(items.length - 1);
    });
});

describe('outlineBreadcrumb', () => {
    const items = extractOutline('= Book\n\n== Chapter\n\n=== Section\n\n== Other\n');

    it('is empty for an out-of-range index', () => {
        expect(outlineBreadcrumb(items, -1)).toEqual([]);
        expect(outlineBreadcrumb(items, 99)).toEqual([]);
    });

    it('walks up to the outermost ancestor', () => {
        expect(outlineBreadcrumb(items, 2).map((i) => i.title)).toEqual([
            'Book',
            'Chapter',
            'Section',
        ]);
    });

    it('skips siblings at the same level', () => {
        // "Other" is level 2; "Chapter" is also level 2 and must not appear.
        expect(outlineBreadcrumb(items, 3).map((i) => i.title)).toEqual(['Book', 'Other']);
    });

    it('is just the heading itself at level 1', () => {
        expect(outlineBreadcrumb(items, 0).map((i) => i.title)).toEqual(['Book']);
    });
});
