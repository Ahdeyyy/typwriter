import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { dimmedRanges, paragraphAt } from './focus-mode';

/** A real CodeMirror `Text`, so the helper is exercised against the same line
 *  index the plugin will hand it. */
const docOf = (text: string) => EditorState.create({ doc: text }).doc;

/** The paragraph text at `offset`, for readable assertions. */
function paragraphText(text: string, offset: number): string {
    const doc = docOf(text);
    const { from, to } = paragraphAt(doc, offset);
    return text.slice(from, to);
}

describe('paragraphAt', () => {
    const doc = 'First para line one.\nStill first para.\n\nSecond para.\n\nThird para.';

    it('covers a single-line document', () => {
        expect(paragraphText('only line', 3)).toBe('only line');
    });

    it('handles an empty document', () => {
        expect(paragraphAt(docOf(''), 0)).toEqual({ from: 0, to: 0 });
    });

    it('joins consecutive non-blank lines', () => {
        expect(paragraphText(doc, 5)).toBe('First para line one.\nStill first para.');
    });

    it('finds the same paragraph from its second line', () => {
        const offset = doc.indexOf('Still');
        expect(paragraphText(doc, offset)).toBe('First para line one.\nStill first para.');
    });

    it('stops at a blank line above', () => {
        expect(paragraphText(doc, doc.indexOf('Second'))).toBe('Second para.');
    });

    it('stops at a blank line below', () => {
        expect(paragraphText(doc, doc.indexOf('Third'))).toBe('Third para.');
    });

    it('lights only the blank line when the caret is between paragraphs', () => {
        // The caret is in no paragraph; picking a neighbour would be arbitrary.
        const blank = doc.indexOf('\n\n') + 1;
        expect(paragraphText(doc, blank)).toBe('');
    });

    it('covers the whole document when there are no blank lines', () => {
        const solid = 'a\nb\nc';
        expect(paragraphText(solid, 2)).toBe(solid);
    });

    it('handles the very first offset', () => {
        expect(paragraphText(doc, 0)).toBe('First para line one.\nStill first para.');
    });

    it('handles the very last offset', () => {
        expect(paragraphText(doc, doc.length)).toBe('Third para.');
    });

    it('treats a whitespace-only line as blank', () => {
        // A line of spaces still separates paragraphs to the reader's eye.
        const spaced = 'one\n   \ntwo';
        expect(paragraphText(spaced, 0)).toBe('one');
    });
});

describe('dimmedRanges', () => {
    it('dims nothing when the paragraph is the whole document', () => {
        expect(dimmedRanges({ from: 0, to: 10 }, 10)).toEqual([]);
    });

    it('dims only after when the paragraph starts the document', () => {
        expect(dimmedRanges({ from: 0, to: 5 }, 20)).toEqual([{ from: 5, to: 20 }]);
    });

    it('dims only before when the paragraph ends the document', () => {
        expect(dimmedRanges({ from: 15, to: 20 }, 20)).toEqual([{ from: 0, to: 15 }]);
    });

    it('dims both sides for a paragraph in the middle', () => {
        expect(dimmedRanges({ from: 5, to: 10 }, 20)).toEqual([
            { from: 0, to: 5 },
            { from: 10, to: 20 },
        ]);
    });

    it('never emits an empty range', () => {
        // CodeMirror rejects a zero-length mark decoration, so an empty range
        // here would throw rather than simply render nothing.
        for (const active of [
            { from: 0, to: 0 },
            { from: 0, to: 20 },
            { from: 20, to: 20 },
        ]) {
            for (const range of dimmedRanges(active, 20)) {
                expect(range.to).toBeGreaterThan(range.from);
            }
        }
    });

    it('handles an empty document', () => {
        expect(dimmedRanges({ from: 0, to: 0 }, 0)).toEqual([]);
    });
});
