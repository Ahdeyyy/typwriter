import { describe, expect, it } from 'bun:test';
import {
    BUILTIN_SNIPPETS,
    exampleSnippetFile,
    mergeSnippets,
    parseUserSnippets,
    type Snippet,
} from './snippets';

const snippet = (over: Partial<Snippet> = {}): Snippet => ({
    name: 'thing',
    label: 'thing',
    body: 'body',
    ...over,
});

describe('BUILTIN_SNIPPETS', () => {
    it('has no duplicate names', () => {
        // A duplicate would make `mergeSnippets` silently drop one.
        const names = BUILTIN_SNIPPETS.map((s) => s.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('gives every snippet a non-empty body', () => {
        for (const s of BUILTIN_SNIPPETS) {
            expect(s.body.length).toBeGreaterThan(0);
        }
    });

    it('gives every snippet a description, since the list shows one', () => {
        for (const s of BUILTIN_SNIPPETS) {
            expect(s.description ?? '').not.toBe('');
        }
    });

    it('has balanced placeholder braces in every body', () => {
        // An unbalanced `${` makes CodeMirror's snippet parser produce a field
        // that swallows the rest of the template.
        for (const s of BUILTIN_SNIPPETS) {
            const opens = (s.body.match(/\$\{/g) ?? []).length;
            const closes = (s.body.match(/\}/g) ?? []).length;
            expect(closes).toBeGreaterThanOrEqual(opens);
        }
    });
});

describe('parseUserSnippets', () => {
    it('returns nothing for an empty file', () => {
        expect(parseUserSnippets('')).toEqual({ snippets: [], errors: [] });
        expect(parseUserSnippets('   \n')).toEqual({ snippets: [], errors: [] });
    });

    it('reports invalid JSON without throwing', () => {
        const result = parseUserSnippets('{ not json');
        expect(result.snippets).toEqual([]);
        expect(result.errors[0]).toContain('not valid JSON');
    });

    it('reads the array form', () => {
        const result = parseUserSnippets('[{"name":"todo","body":"TODO"}]');
        expect(result.snippets).toEqual([
            { name: 'todo', label: 'todo', description: undefined, body: 'TODO' },
        ]);
    });

    it('reads the object form, taking the name from the key', () => {
        const result = parseUserSnippets('{"todo":{"body":"TODO"}}');
        expect(result.snippets[0]).toMatchObject({ name: 'todo', body: 'TODO' });
    });

    it('defaults the label to the name', () => {
        expect(parseUserSnippets('[{"name":"x","body":"y"}]').snippets[0].label).toBe('x');
    });

    it('keeps an explicit label and description', () => {
        const result = parseUserSnippets(
            '[{"name":"x","label":"Nice","description":"d","body":"y"}]'
        );
        expect(result.snippets[0]).toMatchObject({ label: 'Nice', description: 'd' });
    });

    it('rejects an entry with no name but keeps the others', () => {
        // One typo must not remove every snippet.
        const result = parseUserSnippets('[{"body":"a"},{"name":"ok","body":"b"}]');
        expect(result.snippets.map((s) => s.name)).toEqual(['ok']);
        expect(result.errors).toHaveLength(1);
    });

    it('rejects an entry with no body but keeps the others', () => {
        const result = parseUserSnippets('[{"name":"bad"},{"name":"ok","body":"b"}]');
        expect(result.snippets.map((s) => s.name)).toEqual(['ok']);
        expect(result.errors[0]).toContain('bad');
    });

    it('rejects a non-object entry', () => {
        const result = parseUserSnippets('["just a string"]');
        expect(result.snippets).toEqual([]);
        expect(result.errors).toHaveLength(1);
    });

    it('rejects a top-level scalar', () => {
        expect(parseUserSnippets('42').errors[0]).toContain('array or an object');
    });

    it('treats an empty-string name as missing', () => {
        expect(parseUserSnippets('[{"name":"","body":"b"}]').snippets).toEqual([]);
    });

    it('round-trips the example file it offers to create', () => {
        const result = parseUserSnippets(exampleSnippetFile());
        expect(result.errors).toEqual([]);
        expect(result.snippets.length).toBeGreaterThan(0);
    });
});

describe('mergeSnippets', () => {
    it('returns the built-ins when the user has none', () => {
        expect(mergeSnippets([snippet({ name: 'a' })], [])).toHaveLength(1);
    });

    it('adds user snippets', () => {
        const merged = mergeSnippets([snippet({ name: 'a' })], [snippet({ name: 'b' })]);
        expect(merged.map((s) => s.name)).toEqual(['a', 'b']);
    });

    it('lets a user snippet replace a built-in of the same name', () => {
        // How a user disagrees with a default without editing the app.
        const merged = mergeSnippets(
            [snippet({ name: 'figure', body: 'builtin' })],
            [snippet({ name: 'figure', body: 'mine' })]
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].body).toBe('mine');
    });

    it('sorts by name, so the list is stable between sessions', () => {
        const merged = mergeSnippets(
            [snippet({ name: 'zebra' }), snippet({ name: 'apple' })],
            [snippet({ name: 'mango' })]
        );
        expect(merged.map((s) => s.name)).toEqual(['apple', 'mango', 'zebra']);
    });

    it('handles both sides being empty', () => {
        expect(mergeSnippets([], [])).toEqual([]);
    });
});
