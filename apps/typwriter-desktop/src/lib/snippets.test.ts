import { describe, expect, it } from 'bun:test';
import {
    BUILTIN_SNIPPETS,
    parseUserSnippets,
    removeSnippet,
    resolveSnippets,
    serializeSnippets,
    upsertSnippet,
    validateSnippet,
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
        // A duplicate would make one silently unreachable.
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

    it('uses no spaces in names, which the completion could never match', () => {
        for (const s of BUILTIN_SNIPPETS) {
            expect(s.name).not.toMatch(/\s/);
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

    it('round-trips whatever serializeSnippets writes', () => {
        // The editor writes with `serializeSnippets` and reads back with this,
        // so a mismatch between the two would lose snippets on the next load.
        const original = [
            snippet({ name: 'a', description: 'has one' }),
            snippet({ name: 'b', description: undefined }),
        ];
        const result = parseUserSnippets(serializeSnippets(original));
        expect(result.errors).toEqual([]);
        expect(result.snippets).toEqual([
            { name: 'a', label: 'thing', description: 'has one', body: 'body' },
            { name: 'b', label: 'thing', description: undefined, body: 'body' },
        ]);
    });
});

describe('resolveSnippets', () => {
    it('returns the built-ins when neither user layer has anything', () => {
        expect(resolveSnippets([snippet({ name: 'a' })], [], [])).toHaveLength(1);
    });

    it('marks the scope each snippet came from', () => {
        const resolved = resolveSnippets(
            [snippet({ name: 'b' })],
            [snippet({ name: 'a' })],
            [snippet({ name: 'c' })]
        );
        expect(resolved.map((s) => [s.name, s.scope])).toEqual([
            ['a', 'app'],
            ['b', 'builtin'],
            ['c', 'project'],
        ]);
    });

    it('lets app-wide override a built-in', () => {
        const resolved = resolveSnippets(
            [snippet({ name: 'figure', body: 'builtin' })],
            [snippet({ name: 'figure', body: 'mine' })],
            []
        );
        expect(resolved).toHaveLength(1);
        expect(resolved[0]).toMatchObject({
            body: 'mine',
            scope: 'app',
            overrides: 'builtin',
        });
    });

    it('lets project override app-wide', () => {
        // One project disagreeing with the user's own global set.
        const resolved = resolveSnippets(
            [],
            [snippet({ name: 'x', body: 'global' })],
            [snippet({ name: 'x', body: 'local' })]
        );
        expect(resolved[0]).toMatchObject({
            body: 'local',
            scope: 'project',
            overrides: 'app',
        });
    });

    it('reports the nearest shadowed scope when all three define a name', () => {
        const resolved = resolveSnippets(
            [snippet({ name: 'x', body: '1' })],
            [snippet({ name: 'x', body: '2' })],
            [snippet({ name: 'x', body: '3' })]
        );
        expect(resolved[0]).toMatchObject({
            body: '3',
            scope: 'project',
            overrides: 'app',
        });
    });

    it('does not mark an override when nothing was shadowed', () => {
        const resolved = resolveSnippets([], [snippet({ name: 'solo' })], []);
        expect(resolved[0].overrides).toBeUndefined();
    });

    it('sorts by name, so the list is stable between sessions', () => {
        const resolved = resolveSnippets(
            [snippet({ name: 'zebra' })],
            [snippet({ name: 'apple' })],
            [snippet({ name: 'mango' })]
        );
        expect(resolved.map((s) => s.name)).toEqual(['apple', 'mango', 'zebra']);
    });

    it('handles every layer being empty', () => {
        expect(resolveSnippets([], [], [])).toEqual([]);
    });
});

describe('validateSnippet', () => {
    it('accepts a well-formed snippet', () => {
        expect(validateSnippet({ name: 'todo', body: 'x' })).toEqual({});
    });

    it('requires a name', () => {
        expect(validateSnippet({ name: '  ', body: 'x' }).name).toBeDefined();
    });

    it('rejects a name containing a space', () => {
        // Completion matches on the typed word, which cannot contain a space.
        expect(validateSnippet({ name: 'my snippet', body: 'x' }).name).toContain('spaces');
    });

    it('requires a body', () => {
        expect(validateSnippet({ name: 'todo', body: '  ' }).body).toBeDefined();
    });

    it('rejects a name already used in the same scope', () => {
        expect(validateSnippet({ name: 'todo', body: 'x' }, ['todo']).name).toContain('exists');
    });

    it('allows a name used only in another scope, since that is an override', () => {
        expect(validateSnippet({ name: 'figure', body: 'x' }, ['other'])).toEqual({});
    });

    it('reports several problems at once, so the form marks both fields', () => {
        const problems = validateSnippet({ name: '', body: '' });
        expect(Object.keys(problems).sort()).toEqual(['body', 'name']);
    });
});

describe('upsertSnippet / removeSnippet', () => {
    it('adds a new snippet', () => {
        expect(upsertSnippet([], snippet({ name: 'a' }))).toHaveLength(1);
    });

    it('replaces one of the same name', () => {
        const list = upsertSnippet(
            [snippet({ name: 'a', body: 'old' })],
            snippet({ name: 'a', body: 'new' })
        );
        expect(list).toHaveLength(1);
        expect(list[0].body).toBe('new');
    });

    it('drops the old entry when the editor renamed it', () => {
        // Without this a rename would leave the original behind as a duplicate.
        const list = upsertSnippet(
            [snippet({ name: 'old' }), snippet({ name: 'other' })],
            snippet({ name: 'new' }),
            'old'
        );
        expect(list.map((s) => s.name)).toEqual(['new', 'other']);
    });

    it('keeps the list sorted', () => {
        let list = upsertSnippet([], snippet({ name: 'zeta' }));
        list = upsertSnippet(list, snippet({ name: 'alpha' }));
        expect(list.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    });

    it('does not mutate the input', () => {
        const original = [snippet({ name: 'a' })];
        upsertSnippet(original, snippet({ name: 'b' }));
        expect(original).toHaveLength(1);
    });

    it('removes by name', () => {
        expect(removeSnippet([snippet({ name: 'a' })], 'a')).toEqual([]);
    });

    it('is a no-op removing an unknown name', () => {
        expect(removeSnippet([snippet({ name: 'a' })], 'z')).toHaveLength(1);
    });
});

describe('serializeSnippets', () => {
    it('writes the array form, sorted', () => {
        const json = serializeSnippets([snippet({ name: 'b' }), snippet({ name: 'a' })]);
        expect(JSON.parse(json).map((s: Snippet) => s.name)).toEqual(['a', 'b']);
    });

    it('omits an absent description rather than writing null', () => {
        const json = serializeSnippets([snippet({ description: undefined })]);
        expect(JSON.parse(json)[0]).not.toHaveProperty('description');
    });

    it('produces indented, diffable output', () => {
        // The project file is committed alongside the document.
        expect(serializeSnippets([snippet()])).toContain('\n  ');
    });

    it('handles an empty list', () => {
        expect(JSON.parse(serializeSnippets([]))).toEqual([]);
    });
});
