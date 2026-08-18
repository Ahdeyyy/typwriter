import { describe, expect, it } from 'bun:test';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import {
    inInsertableContext,
    snippetCompletionSource,
    wordBefore,
} from './snippet-completion';
import type { Snippet } from '$lib/snippets';

function contextAt(doc: string, pos = doc.length, explicit = false): CompletionContext {
    return new CompletionContext(EditorState.create({ doc }), pos, explicit);
}

const SNIPPETS: Snippet[] = [
    { name: 'figure', label: 'figure', description: 'Figure block', body: '#figure(${})' },
    { name: 'table', label: 'table', description: 'Table block', body: '#table(${})' },
];

const source = snippetCompletionSource(() => SNIPPETS);

describe('wordBefore', () => {
    it('finds the word at the caret', () => {
        expect(wordBefore('some figu', 9)).toEqual({ from: 5, word: 'figu' });
    });

    it('is null directly after whitespace', () => {
        expect(wordBefore('some ', 5)).toBeNull();
    });

    it('is null at the start of a document', () => {
        expect(wordBefore('', 0)).toBeNull();
    });

    it('includes hyphens, which snippet names may contain', () => {
        expect(wordBefore('my-snip', 7)).toEqual({ from: 0, word: 'my-snip' });
    });

    it('stops at punctuation', () => {
        expect(wordBefore('#figure', 7)).toEqual({ from: 1, word: 'figure' });
    });
});

describe('inInsertableContext', () => {
    it('allows plain markup', () => {
        expect(inInsertableContext('Some prose here', 15)).toBe(true);
    });

    it('refuses inside a fenced raw block', () => {
        // Snippets insert markup; inside a code fence that is simply wrong.
        const src = 'text\n```\nlet x = 1';
        expect(inInsertableContext(src, src.length)).toBe(false);
    });

    it('allows after a closed raw block', () => {
        const src = 'text\n```\ncode\n```\nmore ';
        expect(inInsertableContext(src, src.length)).toBe(true);
    });

    it('refuses inside a line comment', () => {
        const src = '// a note about fig';
        expect(inInsertableContext(src, src.length)).toBe(false);
    });

    it('allows on the line after a line comment', () => {
        const src = '// a note\nnow here';
        expect(inInsertableContext(src, src.length)).toBe(true);
    });

    it('refuses inside a block comment', () => {
        const src = '/* disabled fig';
        expect(inInsertableContext(src, src.length)).toBe(false);
    });

    it('allows after a closed block comment', () => {
        const src = '/* off */ back on';
        expect(inInsertableContext(src, src.length)).toBe(true);
    });

    it('refuses mid-reference, which the reference source owns', () => {
        expect(inInsertableContext('see @fig', 8)).toBe(false);
    });

    it('allows once the reference is finished', () => {
        const src = 'see @fig and ';
        expect(inInsertableContext(src, src.length)).toBe(true);
    });
});

describe('snippetCompletionSource', () => {
    it('offers snippets once two characters are typed', () => {
        const result = source(contextAt('fi'));
        expect(result?.options.map((o) => o.label).sort()).toEqual(['figure', 'table']);
    });

    it('stays quiet after a single character', () => {
        // One letter matches nearly everything and would bury the language
        // server's suggestions on every keystroke.
        expect(source(contextAt('f'))).toBeNull();
    });

    it('offers everything on an explicit request with no prefix', () => {
        expect(source(contextAt('text ', 5, true))?.options).toHaveLength(2);
    });

    it('offers everything on an explicit request after one character', () => {
        expect(source(contextAt('f', 1, true))?.options).toHaveLength(2);
    });

    it('anchors from the start of the typed word', () => {
        const doc = 'insert a fig';
        const result = source(contextAt(doc))!;
        expect(doc.slice(result.from)).toBe('fig');
    });

    it('does not fire inside a raw block', () => {
        const src = '```\nfig';
        expect(source(contextAt(src))).toBeNull();
    });

    it('does not fire inside a comment', () => {
        expect(source(contextAt('// fig'))).toBeNull();
    });

    it('returns null when there are no snippets', () => {
        const empty = snippetCompletionSource(() => []);
        expect(empty(contextAt('fig', 3, true))).toBeNull();
    });

    it('carries the description through as the detail', () => {
        const result = source(contextAt('fi'))!;
        expect(result.options.find((o) => o.label === 'figure')?.detail).toBe('Figure block');
    });

    it('boosts snippets above same-named language suggestions', () => {
        // Typing "figure" and accepting should scaffold a figure, not insert
        // the bare identifier typst-ide offers under the same label.
        const result = source(contextAt('fi'))!;
        for (const option of result.options) {
            expect(option.boost).toBeGreaterThan(0);
        }
    });

    it('supplies a function apply, so placeholders become tab stops', () => {
        const result = source(contextAt('fi'))!;
        expect(typeof result.options[0].apply).toBe('function');
    });
});
