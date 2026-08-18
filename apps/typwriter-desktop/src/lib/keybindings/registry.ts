// The catalog of rebindable commands.
//
// This is the single source of truth for what a shortcut *is*: its id, the
// keys it ships with, and where it applies. Everything else reads from here —
// the Keymaps settings pane renders it, the editor builds its keymap from it,
// and the window-level handlers match keystrokes against it. Adding a
// rebindable shortcut means adding an entry here and calling `keysFor` /
// `matchesCommand` wherever the shortcut is handled, rather than hard-coding
// the keystroke there.
//
// User overrides live in the settings store (`settings.keybindings`), keyed by
// command id and holding only the ids the user actually changed — so a command
// whose default we later revise picks the new default up automatically.

import { normalizeChord } from './keys';

/** Where a shortcut is listened for. Two commands in different scopes may
 *  share a keystroke without conflicting — the preview pane's `Escape` and the
 *  editor's are heard by different handlers. */
export type KeyScope =
    | 'global'
    | 'editor'
    | 'typst'
    | 'find'
    | 'replace'
    | 'preview'
    | 'settings';

export interface KeyCommandDef {
    id: string;
    label: string;
    description?: string;
    scope: KeyScope;
    /** Chords in canonical notation (see `keys.ts`). More than one is fine —
     *  the preview's "next page" answers to three. */
    defaults: string[];
}

export interface KeySection {
    scope: KeyScope;
    title: string;
    description: string;
}

export const KEY_SECTIONS: KeySection[] = [
    {
        scope: 'global',
        title: 'Global',
        description: 'Active anywhere in the window.',
    },
    {
        scope: 'editor',
        title: 'Editor',
        description: 'Active while the text editor has focus.',
    },
    {
        scope: 'typst',
        title: 'Typst formatting',
        description: 'Active in .typ files only.',
    },
    {
        scope: 'find',
        title: 'Find field',
        description: 'Active while the cursor is in the search panel’s find box.',
    },
    {
        scope: 'replace',
        title: 'Replace field',
        description: 'Active while the cursor is in the search panel’s replace box.',
    },
    {
        scope: 'preview',
        title: 'Preview',
        description: 'Active in the preview pane and the presentation window.',
    },
    {
        scope: 'settings',
        title: 'Settings window',
        description: 'Active in this window.',
    },
];

export const KEY_COMMANDS: KeyCommandDef[] = [
    // ── Global ──────────────────────────────────────────────────────────
    {
        id: 'global.toggleSidebar',
        label: 'Toggle the sidebar',
        scope: 'global',
        defaults: ['Mod-Shift-b'],
    },
    {
        id: 'global.quickOpen',
        label: 'Go to file',
        description: 'Open the palette on the workspace file list.',
        scope: 'global',
        defaults: ['Mod-p'],
    },
    {
        id: 'global.commandPalette',
        label: 'Open the command palette',
        description: 'Search every command by name.',
        scope: 'global',
        defaults: ['Mod-Shift-p'],
    },

    // ── Editor ──────────────────────────────────────────────────────────
    {
        id: 'editor.save',
        label: 'Save current file',
        scope: 'editor',
        defaults: ['Mod-s'],
    },
    {
        id: 'editor.format',
        label: 'Format current .typ file',
        scope: 'editor',
        defaults: ['Shift-Alt-f'],
    },
    {
        id: 'editor.find',
        label: 'Open find panel',
        scope: 'editor',
        defaults: ['Mod-f'],
    },
    {
        id: 'editor.replace',
        label: 'Open find & replace panel',
        scope: 'editor',
        defaults: ['Mod-h'],
    },
    {
        id: 'editor.closeSearch',
        label: 'Close search panel',
        scope: 'editor',
        defaults: ['Escape'],
    },

    // ── Typst formatting ────────────────────────────────────────────────
    {
        id: 'typst.toggleBold',
        label: 'Toggle bold',
        scope: 'typst',
        defaults: ['Mod-b'],
    },
    {
        id: 'typst.toggleItalic',
        label: 'Toggle italic',
        scope: 'typst',
        defaults: ['Mod-i'],
    },
    {
        id: 'typst.toggleRawInline',
        label: 'Toggle inline code',
        scope: 'typst',
        defaults: ['Mod-e'],
    },

    // ── Search panel ────────────────────────────────────────────────────
    {
        id: 'find.next',
        label: 'Find next match',
        scope: 'find',
        defaults: ['Enter'],
    },
    {
        id: 'find.previous',
        label: 'Find previous match',
        scope: 'find',
        defaults: ['Shift-Enter'],
    },
    {
        id: 'replace.current',
        label: 'Replace current match',
        scope: 'replace',
        defaults: ['Enter'],
    },
    {
        id: 'replace.all',
        label: 'Replace all matches',
        scope: 'replace',
        defaults: ['Mod-Enter'],
    },

    // ── Preview ─────────────────────────────────────────────────────────
    {
        id: 'preview.nextPage',
        label: 'Next page',
        description: 'Paginated and presentation modes.',
        scope: 'preview',
        defaults: ['ArrowRight', 'PageDown', 'Space'],
    },
    {
        id: 'preview.previousPage',
        label: 'Previous page',
        description: 'Paginated and presentation modes.',
        scope: 'preview',
        defaults: ['ArrowLeft', 'PageUp'],
    },
    {
        id: 'preview.firstPage',
        label: 'Jump to first page',
        scope: 'preview',
        defaults: ['Home'],
    },
    {
        id: 'preview.lastPage',
        label: 'Jump to last page',
        scope: 'preview',
        defaults: ['End'],
    },
    {
        id: 'preview.exitPresentation',
        label: 'Exit presentation mode',
        scope: 'preview',
        defaults: ['Escape'],
    },

    // ── Settings window ─────────────────────────────────────────────────
    {
        id: 'settings.search',
        label: 'Search settings',
        description: 'Jump to the search box at the top of this window.',
        scope: 'settings',
        defaults: ['Mod-f'],
    },
];

const COMMANDS_BY_ID = new Map(KEY_COMMANDS.map((command) => [command.id, command]));

export function commandById(id: string): KeyCommandDef | undefined {
    return COMMANDS_BY_ID.get(id);
}

export function defaultKeysFor(id: string): string[] {
    return commandById(id)?.defaults ?? [];
}

export function commandsInScope(scope: KeyScope): KeyCommandDef[] {
    return KEY_COMMANDS.filter((command) => command.scope === scope);
}

/** Sanitize a stored override map: keep only known command ids bound to
 *  parseable chords, canonicalizing as we go. Overrides that match the
 *  command's defaults are dropped so the entry doesn't pin a value the app
 *  would otherwise be free to improve. */
export function normalizeKeybindings(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string[]> = {};
    for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!COMMANDS_BY_ID.has(id) || !Array.isArray(raw)) continue;
        const chords: string[] = [];
        for (const entry of raw) {
            if (typeof entry !== 'string') continue;
            const chord = normalizeChord(entry);
            if (chord && !chords.includes(chord)) chords.push(chord);
        }
        // An empty array is meaningful: it unbinds the command entirely.
        if (sameKeys(chords, defaultKeysFor(id))) continue;
        out[id] = chords;
    }
    return out;
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((chord, i) => chord === b[i]);
}
