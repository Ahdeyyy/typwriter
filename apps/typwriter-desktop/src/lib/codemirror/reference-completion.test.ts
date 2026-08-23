import { describe, expect, it } from 'bun:test';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { createLabelIndex, mergeLabels, referenceCompletionSource } from './reference-completion';
import { extractLabels } from '$lib/references';
import type { BibEntry } from '$lib/bibliography';

/** A parsed bibliography entry as the Rust `parse_bibliography` command
 *  would hand it over (path attached, display fields filled). */
const bibEntry = (key: string, path: string, extra: Partial<BibEntry> = {}): BibEntry => ({
    key,
    type: 'book',
    path,
    line: 1,
    ...extra,
});

/** Build a real CompletionContext so the source is exercised as CodeMirror
 *  will call it, rather than against a hand-made stand-in. */
function contextAt(doc: string, pos = doc.length, explicit = false): CompletionContext {
    return new CompletionContext(EditorState.create({ doc }), pos, explicit);
}

const labelsFrom = (files: Record<string, string>) => () =>
    Object.entries(files).flatMap(([path, text]) => extractLabels(text, path));

describe('createLabelIndex', () => {
    it('collects labels from every buffer', () => {
        const index = createLabelIndex({
            buffers: () => [
                { path: 'a.typ', text: '= A <one>\n' },
                { path: 'b.typ', text: '= B <two>\n' },
            ],
        });
        expect(
            index()
                .map((l) => l.name)
                .sort()
        ).toEqual(['one', 'two']);
    });

    it('re-uses cached labels when the text is unchanged', () => {
        let calls = 0;
        const index = createLabelIndex({
            buffers: () => {
                calls++;
                return [{ path: 'a.typ', text: '= A <one>\n' }];
            },
        });
        const first = index();
        const second = index();
        expect(calls).toBe(2);
        // Same object identity means the parse was not repeated.
        expect(second[0]).toBe(first[0]);
    });

    it('re-extracts when the text changes', () => {
        let text = '= A <one>\n';
        const index = createLabelIndex({ buffers: () => [{ path: 'a.typ', text }] });
        expect(index().map((l) => l.name)).toEqual(['one']);
        text = '= A <renamed>\n';
        expect(index().map((l) => l.name)).toEqual(['renamed']);
    });

    it('forgets buffers that are no longer open', () => {
        let buffers = [
            { path: 'a.typ', text: '= A <one>\n' },
            { path: 'b.typ', text: '= B <two>\n' },
        ];
        const index = createLabelIndex({ buffers: () => buffers });
        expect(index()).toHaveLength(2);
        buffers = [{ path: 'a.typ', text: '= A <one>\n' }];
        expect(index().map((l) => l.name)).toEqual(['one']);
    });
});

describe('referenceCompletionSource', () => {
    const source = referenceCompletionSource(
        labelsFrom({
            'main.typ': '= Intro <intro>\n',
            'chapters/one.typ': '#figure()[x] <fig-one>\n',
        })
    );

    it('offers every label after a bare marker', () => {
        const result = source(contextAt('See @'));
        expect(result?.options.map((o) => o.label).sort()).toEqual(['fig-one', 'intro']);
    });

    it('places references after Typst completions and snippets', () => {
        const result = source(contextAt('See @'))!;
        for (const option of result.options) {
            expect(option.section).toMatchObject({ name: 'References', rank: 2 });
        }
    });

    it('anchors after the marker so CodeMirror can filter the list', () => {
        // `from` must sit *after* the `@`: CodeMirror matches the text between
        // `from` and the caret against each option's label, and no label
        // contains an `@`. Anchoring on the marker filtered every option out.
        const doc = 'See @intr';
        const result = source(contextAt(doc))!;
        expect(doc.slice(result.from)).toBe('intr');
        for (const option of result.options) {
            expect(option.apply).toBe(option.label);
        }
    });

    it('does not fire in plain prose', () => {
        expect(source(contextAt('just some words'))).toBeNull();
    });

    it('does not fire when the caret is past the reference', () => {
        expect(source(contextAt('@intro and more text'))).toBeNull();
    });

    it('returns null when the project defines no labels', () => {
        const empty = referenceCompletionSource(() => []);
        expect(empty(contextAt('See @'))).toBeNull();
    });

    it('shows the defining file as the detail', () => {
        const result = source(contextAt('See @'))!;
        const option = result.options.find((o) => o.label === 'fig-one');
        expect(option?.detail).toBe('chapters/one.typ');
    });

    it('collapses a duplicated label into one option and says so', () => {
        // Two files defining the same name is a Typst error; the completion
        // should still offer the name once rather than twice identically.
        const duplicated = referenceCompletionSource(
            labelsFrom({ 'a.typ': '= A <same>\n', 'b.typ': '= B <same>\n' })
        );
        const result = duplicated(contextAt('See @'))!;
        expect(result.options).toHaveLength(1);
        expect(result.options[0].detail).toBe('2 definitions');
    });

    it('keeps the completion open as the name is typed', () => {
        const result = source(contextAt('See @'))!;
        expect(result.validFor).toBeDefined();
        const re = result.validFor as RegExp;
        expect(re.test('fig-one')).toBe(true);
        expect(re.test('fig one')).toBe(false);
    });
});

describe('referenceCompletionSource: citations', () => {
    const bib = () => [
        bibEntry('knuth1984', 'refs.bib', {
            author: 'Knuth, Donald',
            year: '1984',
            title: 'The TeXbook',
        }),
    ];

    it('offers citation keys alongside labels', () => {
        // Typst resolves `@key` against both, so they belong in one list.
        const source = referenceCompletionSource(labelsFrom({ 'a.typ': '= A <lab>\n' }), bib);
        const result = source(contextAt('See @'))!;
        expect(result.options.map((o) => o.label).sort()).toEqual(['knuth1984', 'lab']);
    });

    it('describes a citation with author, year and title', () => {
        const source = referenceCompletionSource(() => [], bib);
        const result = source(contextAt('See @'))!;
        expect(result.options[0].detail).toBe('Knuth 1984 — The TeXbook');
    });

    it('works with citations only', () => {
        const source = referenceCompletionSource(() => [], bib);
        expect(source(contextAt('See @'))?.options).toHaveLength(1);
    });

    it('lets a label win a name collision with a citation key', () => {
        // Only one option may carry a given name; the document's own label is
        // the likelier target and keeps its "where it came from" detail.
        const source = referenceCompletionSource(
            labelsFrom({ 'a.typ': '= A <knuth1984>\n' }),
            bib
        );
        const result = source(contextAt('See @'))!;
        expect(result.options).toHaveLength(1);
        expect(result.options[0].detail).toBe('a.typ');
    });

    it('deduplicates a key defined in two bib files', () => {
        const twice = () => [
            bibEntry('same', 'one.bib', { title: 'A' }),
            bibEntry('same', 'two.bib', { title: 'B' }),
        ];
        const source = referenceCompletionSource(() => [], twice);
        expect(source(contextAt('See @'))?.options).toHaveLength(1);
    });

    it('defaults to no citations when none are supplied', () => {
        const source = referenceCompletionSource(labelsFrom({ 'a.typ': '= A <lab>\n' }));
        expect(source(contextAt('See @'))?.options.map((o) => o.label)).toEqual(['lab']);
    });
});

describe('referenceCompletionSource: #cite', () => {
    const bib = () => [
        bibEntry('knuth1984', 'refs.bib', {
            author: 'Knuth, Donald',
            year: '1984',
            title: 'The TeXbook',
        }),
    ];
    const source = referenceCompletionSource(labelsFrom({ 'a.typ': '= A <lab>\n' }), bib);

    it('offers only citation keys — never document labels', () => {
        // `#cite` resolves against a bibliography; a `<label>` there is a
        // compile error the completion should not invite.
        const result = source(contextAt('#cite('))!;
        expect(result.options.map((o) => o.label)).toEqual(['knuth1984']);
    });

    it('fires after an opening call and inserts a full marker', () => {
        const result = source(contextAt('#cite('))!;
        expect(result.from).toBe(6);
        expect(result.options[0].apply).toBe('<knuth1984>');
    });

    it('fires after the label key', () => {
        const result = source(contextAt('#cite(label: '))!;
        expect(result.from).toBe(13);
        expect(result.options[0].apply).toBe('<knuth1984>');
    });

    it('completes inside a started marker without duplicating it', () => {
        const doc = '#cite(<kn';
        const result = source(contextAt(doc))!;
        // Anchored after the `<` so CodeMirror filters `kn` against the key.
        expect(doc.slice(result.from)).toBe('kn');
        expect(result.options.map((o) => o.apply)).toEqual(['knuth1984>']);
    });

    it('does not fire when the bibliography contributes no keys', () => {
        const empty = referenceCompletionSource(labelsFrom({ 'a.typ': '= A <lab>\n' }));
        expect(empty(contextAt('#cite('))).toBeNull();
    });

    it('does not fire for other arguments or functions', () => {
        expect(source(contextAt('#cite(supplement: [x], '))).toBeNull();
        expect(source(contextAt('#ref(<x'))).toBeNull();
    });

    it('does not fire in plain prose', () => {
        expect(source(contextAt('just some words'))).toBeNull();
    });
});

describe('mergeLabels', () => {
    it('prefers the open buffer over the disk copy of the same file', () => {
        // The scan still holds the old name; a dirty buffer renamed it. The
        // completion must follow the buffer, exactly once.
        const merged = mergeLabels(
            extractLabels('= A <old-name>\n', 'a.typ'),
            extractLabels('= A <new-name>\n', 'a.typ')
        );
        expect(merged.map((l) => l.name)).toEqual(['new-name']);
    });

    it('keeps scanned labels from files nobody has open', () => {
        const merged = mergeLabels(
            extractLabels('= A <one>\n', 'a.typ'),
            extractLabels('= B <two>\n', 'b.typ')
        );
        expect(merged.map((l) => l.name).sort()).toEqual(['one', 'two']);
    });

    it('keeps several buffers over one stale scan', () => {
        const scan = [
            ...extractLabels('= A <stale-a>\n', 'a.typ'),
            ...extractLabels('= B <stale-b>\n', 'b.typ'),
            ...extractLabels('= C <untouched>\n', 'c.typ'),
        ];
        const buffered = [
            ...extractLabels('= A <fresh-a>\n', 'a.typ'),
            ...extractLabels('= B <fresh-b>\n', 'b.typ'),
        ];
        const merged = mergeLabels(scan, buffered);
        expect(merged.map((l) => l.name).sort()).toEqual([
            'fresh-a',
            'fresh-b',
            'untouched',
        ]);
    });
});
