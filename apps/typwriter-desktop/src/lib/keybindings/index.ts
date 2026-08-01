// Resolving a command id to the keys it is actually bound to *right now*:
// the user's override if there is one, the shipped default otherwise.
//
// Every read goes through `settings.keybindings`, which is `$state` — so a
// `$derived` or `$effect` that calls `keysFor` / `shortcutLabel` re-runs when
// the user rebinds something, and the change lands in every window (the
// settings store broadcasts on `settings:changed`).

import { settings } from '$lib/stores/settings.svelte';
import { platform } from '$lib/stores/platform.svelte';
import { KEY_COMMANDS, commandById, defaultKeysFor, type KeyCommandDef } from './registry';
import { formatChord, matchesChord } from './keys';

export * from './keys';
export * from './registry';

/** The chords bound to a command. Empty means the user unbound it. */
export function keysFor(id: string): string[] {
    const override = settings.keybindings[id];
    return override ?? defaultKeysFor(id);
}

/** Has the user changed this command away from its default? */
export function isCustomized(id: string): boolean {
    return id in settings.keybindings;
}

/** Does this keystroke fire the given command? */
export function matchesCommand(event: KeyboardEvent, id: string): boolean {
    const isMac = platform.isMac;
    return keysFor(id).some((chord) => matchesChord(event, chord, isMac));
}

/** The command's primary chord as a display label ("Ctrl+B"), for tooltips and
 *  menu hints. `undefined` when the command is unbound. */
export function shortcutLabel(id: string): string | undefined {
    const [primary] = keysFor(id);
    return primary ? formatChord(primary, platform.isMac) : undefined;
}

/** Commands, other than `id`, that are bound to `chord` in the same scope —
 *  i.e. the ones that would fight over the keystroke. Used by the settings
 *  pane to warn before a rebind creates an ambiguity. */
export function conflictsFor(id: string, chord: string): KeyCommandDef[] {
    const scope = commandById(id)?.scope;
    if (!scope) return [];
    return KEY_COMMANDS.filter(
        (command) =>
            command.id !== id &&
            command.scope === scope &&
            keysFor(command.id).includes(chord),
    );
}
