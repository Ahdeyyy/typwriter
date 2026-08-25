// The palette's logic, with no Svelte and no DOM.
//
// The component around this is a thin renderer; everything that decides *what*
// the user sees — which mode a query selects, which rows survive ranking, what
// gets highlighted — lives here so it can be unit-tested. The desktop app is a
// Tauri shell that is not meant to be driven through a dev server, so logic
// that stays in a `.svelte` file is logic nothing can check.

import { fuzzyRank, type FuzzyMatch } from '$lib/fuzzy';
import type { OutlineItem } from '$lib/outline';
import type { AppCommand } from '$lib/commands/registry';

export type PaletteMode = 'files' | 'commands' | 'outline';

/** Prefix characters that switch mode, as VS Code and Obsidian use them. */
export const COMMAND_PREFIX = '>';
export const OUTLINE_PREFIX = '@';

/** Cap on rendered rows — a big workspace holds thousands of files and nobody
 *  scrolls past the first screen of a fuzzy search. */
export const MAX_ROWS = 200;

export interface FileEntry {
    name: string;
    path: string;
}

export type PaletteRow =
    | { kind: 'file'; path: string; name: string; dir: string; match: FuzzyMatch }
    | { kind: 'command'; command: AppCommand; match: FuzzyMatch }
    | { kind: 'outline'; item: OutlineItem; match: FuzzyMatch };

export interface PaletteSources {
    files: readonly FileEntry[];
    commands: readonly AppCommand[];
    outline: readonly OutlineItem[];
}

/**
 * Split a raw input into the mode it selects and the text to match with.
 *
 * The prefix is part of the input rather than separate UI so that a user who
 * opened the file list can reach the command list by typing `>` without
 * closing anything.
 */
export function parseQuery(raw: string): { mode: PaletteMode; term: string } {
    if (raw.startsWith(COMMAND_PREFIX)) return { mode: 'commands', term: raw.slice(1) };
    if (raw.startsWith(OUTLINE_PREFIX)) return { mode: 'outline', term: raw.slice(1) };
    return { mode: 'files', term: raw };
}

/** The input text that opens a given mode. */
export function seedFor(mode: PaletteMode): string {
    if (mode === 'commands') return COMMAND_PREFIX;
    if (mode === 'outline') return OUTLINE_PREFIX;
    return '';
}

/** Directory portion of a workspace-relative path, or '' at the root. */
function dirOf(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
}

export function buildRows(
    mode: PaletteMode,
    term: string,
    sources: PaletteSources
): PaletteRow[] {
    if (mode === 'commands') {
        return fuzzyRank(
            sources.commands,
            term,
            (command) => command.title,
            // Group name and keywords match but never outrank a title hit.
            (command) => [command.group, ...(command.keywords ?? [])]
        )
            .slice(0, MAX_ROWS)
            .map(({ item, match }) => ({ kind: 'command' as const, command: item, match }));
    }

    if (mode === 'outline') {
        return fuzzyRank(sources.outline, term, (heading) => heading.title)
            .slice(0, MAX_ROWS)
            .map(({ item, match }) => ({ kind: 'outline' as const, item, match }));
    }

    return fuzzyRank(
        sources.files,
        term,
        (file) => file.name,
        // Matching the full path finds `chapters/two.typ` from "chap", but the
        // positions would index the path, so the name renders unhighlighted.
        (file) => file.path
    )
        .slice(0, MAX_ROWS)
        .map(({ item, match }) => ({
            kind: 'file' as const,
            path: item.path,
            name: item.name,
            dir: dirOf(item.path),
            match,
        }));
}

/** Whether a row can be run. Only commands can be disabled. */
export function rowEnabled(row: PaletteRow): boolean {
    return row.kind === 'command' ? (row.command.enabled?.() ?? true) : true;
}

/** Group header for a row, or null when the mode is not grouped. */
export function groupOf(row: PaletteRow): string | null {
    return row.kind === 'command' ? row.command.group : null;
}

/**
 * Move `selected` by `delta`, wrapping at both ends.
 *
 * Wrapping matters for a palette: pressing Up on the first row should reach the
 * last, which is how every palette the user has trained on behaves.
 */
export function moveSelection(selected: number, delta: number, count: number): number {
    if (count <= 0) return 0;
    return (((selected + delta) % count) + count) % count;
}
