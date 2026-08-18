import { describe, expect, it } from 'bun:test';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { createLabelIndex, referenceCompletionSource } from './reference-completion';
import { extractLabels } from '$lib/references';

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
        expect(index().map((l) => l.name).sort()).toEqual(['one', 'two']);
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

    it('anchors from the marker so accepting yields one @name', () => {
        // `from` covers the `@`, and every `apply` re-supplies it — otherwise
        // accepting `intro` on top of `@intr` would produce `@@intro`.
        const doc = 'See @intr';
        const result = source(contextAt(doc))!;
        expect(doc.slice(result.from)).toBe('@intr');
        for (const option of result.options) {
            expect(option.apply).toBe(`@${option.label}`);
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
        expect(re.test('@fig-one')).toBe(true);
        expect(re.test('@fig one')).toBe(false);
    });
});
