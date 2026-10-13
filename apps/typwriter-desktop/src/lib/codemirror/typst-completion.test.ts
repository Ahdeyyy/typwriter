import { describe, expect, it, mock } from 'bun:test';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { semanticCompletionSource, typstCompletionSource, typstApplyToSnippet } from './typst-completion';
import type { CompletionsResponse } from '$lib/types';
import { completionScope } from './completion-context';
import { snippetCompletionSource } from './snippet-completion';

function contextAt(doc: string, explicit = false) {
    return new CompletionContext(EditorState.create({ doc }), doc.length, explicit);
}

const response = (from: number, label = 'value', kind = 'Constant'): CompletionsResponse => ({
    from, completions: [{ label, kind, apply: label, detail: null }],
});

describe('typstCompletionSource', () => {
    it.each([
        '#', '#sym.', '#set text(font: "', '#set text(font: "Times ',
        '#set text(weight: ', '#set par(justify: ', '#image("images/',
        '#import "@preview/', '#let café = 1\n#caf', '$alpha.',
        '```', '```py', '````typ',
    ])('requests semantic completions for %s', async (doc) => {
        const request = mock(async () => response(doc.length));
        expect(await typstCompletionSource(request)(contextAt(doc))).not.toBeNull();
        expect(request).toHaveBeenCalledWith(doc, doc.length, false);
    });

    it.each(['// #im', '/* #im', '#set text(font: /* #im', '#set text(font: // im', '#let x = /* im', '`#im', '```typst\n#im', '@fig', '#cite(', '#cite(<key'])
    ('defers to the correct source in %s', async (doc) => {
        const request = mock(async () => response(doc.length));
        expect(await typstCompletionSource(request)(contextAt(doc, true))).toBeNull();
        expect(request).not.toHaveBeenCalled();
    });

    it('keeps incomplete field accesses out of markup snippet completion', () => {
        expect(completionScope('#sym.', 5)).toBe('code');
        expect(snippetCompletionSource(() => [{ name: 'heading', label: 'heading', body: '= ${title}' }])(contextAt('#sym.', true))).toBeNull();
    });

    it('keeps the backend range for a multiword font rather than the last word', async () => {
        const doc = '#set text(font: "Times N';
        const from = doc.indexOf('"');
        const result = await typstCompletionSource(async () => response(from, '"Times New Roman"', 'Font'))(contextAt(doc));
        expect(result?.from).toBe(from);
        expect(result?.options[0].type).toBe('font');
        expect(result?.validFor).toBeUndefined();
    });

    it('replaces a matching partial markup snippet name on an explicit trigger', async () => {
        const source = typstCompletionSource(async (text) => response(text.length, 'heading', 'Syntax'));
        expect((await source(contextAt('head', true)))?.from).toBe(0);
        expect((await source(contextAt('prose', true)))?.from).toBe(5);
        expect((await source(contextAt('#text(he', true)))?.from).toBe(8);
    });

    it('preserves full path prefixes and literal application text', async () => {
        const doc = '#image("images/fi';
        const from = doc.indexOf('"');
        const result = await typstCompletionSource(async () => response(from, '"images/figure.svg"', 'Path'))(contextAt(doc));
        expect(result?.from).toBe(from);
        expect(result?.options[0].apply).toBe('"images/figure.svg"');
    });

    it('drops a semantic response when typing changes the request context', async () => {
        const context = contextAt('#set text(font: "');
        let aborted = false;
        Object.defineProperty(context, 'aborted', { get: () => aborted });
        const register = mock(context.addEventListener.bind(context));
        context.addEventListener = register;
        let finish!: (value: CompletionsResponse) => void;
        const pending = typstCompletionSource(() => new Promise((resolve) => { finish = resolve; }))(context);
        expect(register.mock.calls[0][2]).toEqual({ onDocChange: true });
        aborted = true;
        finish(response(context.pos));
        expect(await pending).toBeNull();
    });

    it('rejects an invalid replacement offset', async () => {
        expect(await typstCompletionSource(async () => response(100))(contextAt('#im'))).toBeNull();
    });

    it('keeps explicit completion requests explicit', async () => {
        const request = mock(async () => response(0));
        await typstCompletionSource(request)(contextAt('', true));
        expect(request).toHaveBeenCalledWith('', 0, true);
    });
});

describe('semanticCompletionSource', () => {
    it('removes LSP prefix-only caching that survives changes to the argument context', async () => {
        const result = await semanticCompletionSource(() => ({
            from: 1, options: [{ label: 'image' }], validFor: /\w*/,
        }))(contextAt('#im'));
        expect(result?.validFor).toBeUndefined();
    });

    it('drops an LSP response aborted during typing', async () => {
        const context = contextAt('#im');
        let aborted = false;
        Object.defineProperty(context, 'aborted', { get: () => aborted });
        let finish!: (value: { from: number; options: [] }) => void;
        const pending = semanticCompletionSource(() => new Promise((resolve) => { finish = resolve; }))(context);
        aborted = true;
        finish({ from: 1, options: [] });
        expect(await pending).toBeNull();
    });
});

describe('typstApplyToSnippet', () => {
    it('preserves placeholders and escapes code-block braces', () => {
        expect(typstApplyToSnippet('#{ let x = ${value}; ${} }')).toBe('#\\{ let x = ${value}; ${} \\}');
    });
});
