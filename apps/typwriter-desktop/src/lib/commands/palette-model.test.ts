import { describe, expect, it } from 'bun:test';
import {
    buildRows,
    groupOf,
    moveSelection,
    parseQuery,
    rowEnabled,
    seedFor,
    type FileEntry,
    type PaletteSources,
} from './palette-model';
import type { AppCommand } from './registry';
import { extractOutline } from '$lib/outline';

const files: FileEntry[] = [
    { name: 'main.typ', path: 'main.typ' },
    { name: 'one.typ', path: 'chapters/one.typ' },
    { name: 'two.typ', path: 'chapters/two.typ' },
    { name: 'notes.md', path: 'notes.md' },
];

const command = (over: Partial<AppCommand> = {}): AppCommand => ({
    id: 'test.command',
    title: 'Test command',
    group: 'File',
    run: () => {},
    ...over,
});

const commands: AppCommand[] = [
    command({ id: 'file.save', title: 'Save file', group: 'File' }),
    command({ id: 'edit.format', title: 'Format document', group: 'Edit', keywords: ['typstyle'] }),
    command({ id: 'view.outline', title: 'Show outline', group: 'View' }),
    command({
        id: 'file.closeOthers',
        title: 'Close other files',
        group: 'File',
        enabled: () => false,
    }),
];

const outline = extractOutline('= Introduction\n\n== Background\n\n= Results\n');

const sources: PaletteSources = { files, commands, outline };

describe('parseQuery', () => {
    it('defaults to file mode', () => {
        expect(parseQuery('main')).toEqual({ mode: 'files', term: 'main' });
    });

    it('switches to commands on >', () => {
        expect(parseQuery('>save')).toEqual({ mode: 'commands', term: 'save' });
    });

    it('switches to outline on @', () => {
        expect(parseQuery('@intro')).toEqual({ mode: 'outline', term: 'intro' });
    });

    it('treats a bare prefix as that mode with an empty term', () => {
        expect(parseQuery('>')).toEqual({ mode: 'commands', term: '' });
        expect(parseQuery('@')).toEqual({ mode: 'outline', term: '' });
    });

    it('only strips the leading prefix', () => {
        // A `>` later in the query is part of what the user is searching for.
        expect(parseQuery('>a>b')).toEqual({ mode: 'commands', term: 'a>b' });
    });

    it('round-trips with seedFor', () => {
        for (const mode of ['files', 'commands', 'outline'] as const) {
            expect(parseQuery(seedFor(mode)).mode).toBe(mode);
        }
    });
});

describe('buildRows: files', () => {
    it('lists every file for an empty term', () => {
        expect(buildRows('files', '', sources)).toHaveLength(4);
    });

    it('ranks a name match', () => {
        const rows = buildRows('files', 'main', sources);
        expect(rows[0]).toMatchObject({ kind: 'file', name: 'main.typ' });
    });

    it('finds a file by its directory via the secondary matcher', () => {
        const rows = buildRows('files', 'chapters', sources);
        expect(rows.map((r) => (r.kind === 'file' ? r.path : ''))).toEqual([
            'chapters/one.typ',
            'chapters/two.typ',
        ]);
    });

    it('splits the directory out for display', () => {
        const [row] = buildRows('files', 'one', sources);
        expect(row).toMatchObject({ kind: 'file', name: 'one.typ', dir: 'chapters' });
    });

    it('leaves dir empty for a root file', () => {
        const [row] = buildRows('files', 'notes', sources);
        expect(row).toMatchObject({ dir: '' });
    });

    it('drops non-matches', () => {
        expect(buildRows('files', 'zzzz', sources)).toEqual([]);
    });
});

describe('buildRows: commands', () => {
    it('matches on the title', () => {
        const rows = buildRows('commands', 'save', sources);
        expect(rows[0]).toMatchObject({ kind: 'command' });
        expect(rows[0].kind === 'command' && rows[0].command.id).toBe('file.save');
    });

    it('matches on a keyword that is not shown', () => {
        const rows = buildRows('commands', 'typstyle', sources);
        expect(rows.map((r) => (r.kind === 'command' ? r.command.id : ''))).toContain(
            'edit.format'
        );
    });

    it('matches on the group name', () => {
        const rows = buildRows('commands', 'view', sources);
        expect(rows.map((r) => (r.kind === 'command' ? r.command.id : ''))).toContain(
            'view.outline'
        );
    });

    it('still lists a disabled command, so it is discoverable', () => {
        // Hiding it would leave the user unable to find out the command exists.
        const rows = buildRows('commands', 'close other', sources);
        expect(rows).toHaveLength(1);
        expect(rowEnabled(rows[0])).toBe(false);
    });

    it('reports the group for headers', () => {
        const rows = buildRows('commands', 'save', sources);
        expect(groupOf(rows[0])).toBe('File');
    });
});

describe('buildRows: outline', () => {
    it('lists every heading for an empty term', () => {
        expect(buildRows('outline', '', sources)).toHaveLength(3);
    });

    it('filters headings by title', () => {
        const rows = buildRows('outline', 'back', sources);
        expect(rows).toHaveLength(1);
        expect(rows[0].kind === 'outline' && rows[0].item.title).toBe('Background');
    });

    it('carries the offset through for the cursor jump', () => {
        const rows = buildRows('outline', 'results', sources);
        expect(rows[0].kind === 'outline' && rows[0].item.from).toBeGreaterThan(0);
    });
});

describe('rowEnabled', () => {
    it('treats files and headings as always runnable', () => {
        expect(rowEnabled(buildRows('files', 'main', sources)[0])).toBe(true);
        expect(rowEnabled(buildRows('outline', 'intro', sources)[0])).toBe(true);
    });

    it('defaults to enabled when a command declares no predicate', () => {
        expect(rowEnabled(buildRows('commands', 'save', sources)[0])).toBe(true);
    });
});

describe('moveSelection', () => {
    it('advances and retreats', () => {
        expect(moveSelection(0, 1, 5)).toBe(1);
        expect(moveSelection(3, -1, 5)).toBe(2);
    });

    it('wraps past the end', () => {
        expect(moveSelection(4, 1, 5)).toBe(0);
    });

    it('wraps before the start', () => {
        // Pressing Up on the first row reaches the last, as every palette does.
        expect(moveSelection(0, -1, 5)).toBe(4);
    });

    it('wraps a page jump larger than the list', () => {
        expect(moveSelection(0, 10, 5)).toBe(0);
        expect(moveSelection(0, -10, 3)).toBe(2);
    });

    it('stays at 0 for an empty list rather than going negative', () => {
        expect(moveSelection(0, -1, 0)).toBe(0);
        expect(moveSelection(0, 1, 0)).toBe(0);
    });
});
