import { describe, expect, test } from 'bun:test';
import {
    applyLinkEdits,
    describeLinkCount,
    invertLinkEdits,
    literalValue,
    type LinkEdit,
} from './link-updates';

const text = '#include "ch1.typ"\n#image("a.png")\n';
const edits: LinkEdit[] = [
    { start: 9, end: 18, oldText: '"ch1.typ"', newText: '"chapters/ch1.typ"' },
    { start: 26, end: 33, oldText: '"a.png"', newText: '"figs/a.png"' },
];

describe('applyLinkEdits', () => {
    test('applies every edit', () => {
        expect(applyLinkEdits(text, edits)).toBe(
            '#include "chapters/ch1.typ"\n#image("figs/a.png")\n'
        );
    });

    test('order of the edits does not matter', () => {
        expect(applyLinkEdits(text, [...edits].reverse())).toBe(applyLinkEdits(text, edits));
    });

    test('refuses edits that no longer line up', () => {
        expect(applyLinkEdits('#include "ch2.typ"\n#image("a.png")\n', edits)).toBeNull();
        expect(applyLinkEdits('#incl', edits)).toBeNull();
    });

    test('refuses overlapping edits', () => {
        const overlapping: LinkEdit[] = [
            { start: 0, end: 4, oldText: '#inc', newText: 'x' },
            { start: 2, end: 5, oldText: 'ncl', newText: 'y' },
        ];
        expect(applyLinkEdits(text, overlapping)).toBeNull();
    });
});

describe('invertLinkEdits', () => {
    test('undoes the edits', () => {
        const edited = applyLinkEdits(text, edits)!;
        expect(applyLinkEdits(edited, invertLinkEdits(edits))).toBe(text);
    });
});

test('literalValue strips quotes', () => {
    expect(literalValue('"figs/a.png"')).toBe('figs/a.png');
});

test('describeLinkCount pluralizes', () => {
    expect(describeLinkCount([{ path: 'a.typ', edits: [edits[0]] }])).toBe('1 link in 1 file');
    expect(describeLinkCount([{ path: 'a.typ', edits }, { path: 'b.typ', edits }])).toBe(
        '4 links in 2 files'
    );
});
