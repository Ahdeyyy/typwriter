import { describe, expect, it } from 'bun:test';
import {
    danglingRefs,
    duplicateLabels,
    extractLabels,
    extractRefs,
    indexLabels,
    labelName,
    refName,
    refPrefixAt,
} from './references';

const names = (items: { name: string }[]) => items.map((i) => i.name);

describe('refName', () => {
    it('strips the marker', () => {
        expect(refName('@intro')).toBe('intro');
    });

    it('stops at a supplement', () => {
        // The parser includes `[Figure]` in the Ref node; the name does not.
        expect(refName('@fig-one[Figure]')).toBe('fig-one');
    });

    it('drops trailing sentence punctuation', () => {
        // `@intro.` at the end of a sentence refers to `intro`.
        expect(refName('@intro.')).toBe('intro');
    });

    it('keeps an interior colon', () => {
        expect(refName('@eq:one')).toBe('eq:one');
    });

    it('keeps an interior dot', () => {
        expect(refName('@sec.two')).toBe('sec.two');
    });

    it('handles a bare marker', () => {
        expect(refName('@')).toBe('');
    });
});

describe('labelName', () => {
    it('strips the angle brackets', () => {
        expect(labelName('<intro>')).toBe('intro');
    });

    it('passes through text that is not bracketed', () => {
        expect(labelName('intro')).toBe('intro');
    });
});

describe('extractLabels', () => {
    it('is empty for no labels', () => {
        expect(extractLabels('Just prose.')).toEqual([]);
    });

    it('finds a heading label', () => {
        const [label] = extractLabels('= Title <intro>\n');
        expect(label).toMatchObject({ name: 'intro', line: 1 });
    });

    it('finds several labels with line numbers', () => {
        const src = '= A <one>\n\ntext\n\n= B <two>\n';
        expect(extractLabels(src).map((l) => [l.name, l.line])).toEqual([
            ['one', 1],
            ['two', 5],
        ]);
    });

    it('ignores a label inside a raw block', () => {
        // Same reason the outline goes through the parser.
        expect(extractLabels('```\n<not-a-label>\n```\n')).toEqual([]);
    });

    it('ignores a label inside a comment', () => {
        expect(extractLabels('// <not-a-label>\n')).toEqual([]);
    });

    it('records the path it was given', () => {
        const [label] = extractLabels('= A <x>\n', 'chapters/one.typ');
        expect(label.path).toBe('chapters/one.typ');
    });

    it('offsets point at the label in the source', () => {
        const src = '= Title <intro>\n';
        const [label] = extractLabels(src);
        expect(src.slice(label.from, label.to)).toBe('<intro>');
    });
});

describe('extractRefs', () => {
    it('finds references', () => {
        expect(names(extractRefs('See @one and @two.'))).toEqual(['one', 'two']);
    });

    it('normalises a reference with a supplement', () => {
        expect(names(extractRefs('See @fig-one[Figure] here.'))).toEqual(['fig-one']);
    });

    it('normalises a reference ending a sentence', () => {
        expect(names(extractRefs('As shown in @intro.'))).toEqual(['intro']);
    });

    it('bounds the range to the name, not the supplement', () => {
        const src = 'See @fig-one[Figure].';
        const [ref] = extractRefs(src);
        expect(src.slice(ref.from, ref.to)).toBe('@fig-one');
    });

    it('ignores a reference inside a raw block', () => {
        expect(extractRefs('```\n@not-a-ref\n```\n')).toEqual([]);
    });

    it('does not treat an email-looking string as a reference', () => {
        // There is no `@` -started Ref node here for the parser to emit.
        expect(extractRefs('Write to me at once.')).toEqual([]);
    });
});

describe('indexLabels / duplicateLabels', () => {
    const labels = [
        ...extractLabels('= A <one>\n', 'a.typ'),
        ...extractLabels('= B <two>\n', 'b.typ'),
        ...extractLabels('= C <one>\n', 'c.typ'),
    ];

    it('groups definitions by name', () => {
        const index = indexLabels(labels);
        expect(index.get('one')).toHaveLength(2);
        expect(index.get('two')).toHaveLength(1);
    });

    it('reports only names defined more than once', () => {
        const duplicates = duplicateLabels(labels);
        expect([...duplicates.keys()]).toEqual(['one']);
    });

    it('names every file a duplicate came from', () => {
        const duplicates = duplicateLabels(labels);
        expect(duplicates.get('one')!.map((d) => d.path)).toEqual(['a.typ', 'c.typ']);
    });

    it('reports nothing when every label is unique', () => {
        expect(duplicateLabels(extractLabels('= A <x>\n\n= B <y>\n')).size).toBe(0);
    });
});

describe('danglingRefs', () => {
    const refs = extractRefs('See @known and @unknown.');

    it('keeps only references with no definition', () => {
        expect(names(danglingRefs(refs, new Set(['known'])))).toEqual(['unknown']);
    });

    it('is empty when everything resolves', () => {
        expect(danglingRefs(refs, new Set(['known', 'unknown']))).toEqual([]);
    });

    it('reports everything when nothing is defined', () => {
        expect(danglingRefs(refs, new Set())).toHaveLength(2);
    });
});

describe('refPrefixAt', () => {
    it('detects a bare marker so the full list is offered', () => {
        const src = 'See @';
        expect(refPrefixAt(src, src.length)).toEqual({ from: 4, prefix: '' });
    });

    it('detects a partial name', () => {
        const src = 'See @fig-';
        expect(refPrefixAt(src, src.length)).toEqual({ from: 4, prefix: 'fig-' });
    });

    it('reports the marker offset so the completion can replace from there', () => {
        const src = 'text @intro';
        const hit = refPrefixAt(src, src.length)!;
        expect(src.slice(hit.from)).toBe('@intro');
    });

    it('is null in plain prose', () => {
        expect(refPrefixAt('just some words', 15)).toBeNull();
    });

    it('is null at the very start of a document', () => {
        expect(refPrefixAt('', 0)).toBeNull();
    });

    it('is null when the caret is before the marker', () => {
        expect(refPrefixAt('see @intro', 3)).toBeNull();
    });

    it('does not run past whitespace to an earlier marker', () => {
        // "@one two" with the caret after "two" is not a reference in progress.
        expect(refPrefixAt('@one two', 8)).toBeNull();
    });
});
