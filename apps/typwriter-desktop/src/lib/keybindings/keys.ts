// Keyboard chord notation shared by every shortcut in the app.
//
// The canonical form is CodeMirror's: modifiers joined with `-`, key name last
// — `Mod-Shift-b`, `Shift-Alt-f`, `ArrowRight`. `Mod` resolves to Cmd on macOS
// and Ctrl everywhere else, exactly as CodeMirror resolves it. Keeping one
// notation means a stored chord can be handed straight to `keymap.of(...)` for
// the editor *and* matched against a raw DOM KeyboardEvent for the shortcuts
// that live outside CodeMirror (sidebar, preview, search panel).

export interface ParsedChord {
    /** Cmd on macOS, Ctrl elsewhere. */
    mod: boolean;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    /** Normalized key name: `b`, `Enter`, `ArrowRight`, `Space`, `F5`. */
    key: string;
}

/** Keys that only ever appear *as* a modifier — never a chord's final key. */
const MODIFIER_KEYS = new Set([
    'Control',
    'Alt',
    'AltGraph',
    'Shift',
    'Meta',
    'CapsLock',
    'Dead',
    'Unidentified',
]);

export function isModifierKey(key: string): boolean {
    return MODIFIER_KEYS.has(key);
}

// Spellings we accept on input (typed or parsed from an older config) mapped to
// the canonical name. Anything not listed keeps whatever casing it arrived
// with, which is what `KeyboardEvent.key` already produces for the long tail.
const KEY_ALIASES: Record<string, string> = {
    ' ': 'Space',
    space: 'Space',
    enter: 'Enter',
    return: 'Enter',
    escape: 'Escape',
    esc: 'Escape',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
};

export function normalizeKeyName(key: string): string {
    if (key === '') return '';
    const lower = key.toLowerCase();
    const alias = KEY_ALIASES[lower];
    if (alias) return alias;
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return `F${lower.slice(1)}`;
    // Single characters are case-folded: Shift is carried by the modifier, not
    // by the letter, so `Mod-B` and `Mod-b` must not be two different chords.
    return key.length === 1 ? lower : key;
}

/** Parse a chord string. Returns `null` for anything malformed — an unknown
 *  modifier name, or no key at all — so bad config degrades to "unbound"
 *  rather than to a binding that fires on the wrong keystroke. */
export function parseChord(chord: string): ParsedChord | null {
    if (!chord) return null;
    const parts = chord.split('-');
    let key = parts.pop() ?? '';
    // A chord whose key *is* the separator ("Mod--") splits with a trailing
    // empty segment; the real key is the `-` that produced it.
    if (key === '' && parts.length > 0) {
        key = '-';
        parts.pop();
    }
    if (key === '') return null;

    const parsed: ParsedChord = {
        mod: false,
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        key: normalizeKeyName(key),
    };
    for (const part of parts) {
        switch (part.toLowerCase()) {
            case 'mod':
                parsed.mod = true;
                break;
            case 'ctrl':
            case 'control':
                parsed.ctrl = true;
                break;
            case 'alt':
            case 'option':
                parsed.alt = true;
                break;
            case 'shift':
                parsed.shift = true;
                break;
            case 'meta':
            case 'cmd':
            case 'command':
                parsed.meta = true;
                break;
            default:
                return null;
        }
    }
    return parsed;
}

/** Re-serialize a chord in canonical modifier order. */
export function formatParsedChord(chord: ParsedChord): string {
    const parts: string[] = [];
    if (chord.mod) parts.push('Mod');
    if (chord.ctrl) parts.push('Ctrl');
    if (chord.alt) parts.push('Alt');
    if (chord.shift) parts.push('Shift');
    if (chord.meta) parts.push('Meta');
    parts.push(chord.key);
    return parts.join('-');
}

/** Canonical form of a chord string, or `null` if it can't be parsed. */
export function normalizeChord(chord: string): string | null {
    const parsed = parseChord(chord);
    return parsed ? formatParsedChord(parsed) : null;
}

/** The key name a DOM event contributes to a chord.
 *
 *  With Shift held, `event.key` reports the *shifted* character (`!` for
 *  Shift+1, `B` for Shift+B). Chords carry Shift as a modifier, so recover the
 *  unshifted key from `event.code` when the layout makes that unambiguous —
 *  otherwise `Mod-Shift-1` would be stored (and matched) as `Mod-Shift-!`. */
export function eventKeyName(event: KeyboardEvent): string {
    const raw = event.key;
    if (event.shiftKey && raw.length === 1) {
        const letter = /^Key([A-Z])$/.exec(event.code);
        if (letter) return letter[1].toLowerCase();
        const digit = /^Digit([0-9])$/.exec(event.code);
        if (digit) return digit[1];
    }
    return normalizeKeyName(raw);
}

/** Build a chord from a keystroke, or `null` when the event carries no key of
 *  its own (a bare Ctrl/Shift press while the user is mid-chord). */
export function chordFromEvent(event: KeyboardEvent, isMac: boolean): string | null {
    if (!event.key || isModifierKey(event.key)) return null;
    const key = eventKeyName(event);
    if (!key) return null;

    const parsed: ParsedChord = {
        mod: isMac ? event.metaKey : event.ctrlKey,
        // On macOS the physical Control key is its own modifier; elsewhere it
        // *is* Mod, and recording both would produce an unmatchable chord.
        ctrl: isMac ? event.ctrlKey : false,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: isMac ? false : event.metaKey,
        key,
    };
    return formatParsedChord(parsed);
}

/** Does this keystroke fire the given chord? */
export function matchesChord(event: KeyboardEvent, chord: string, isMac: boolean): boolean {
    const parsed = parseChord(chord);
    if (!parsed) return false;
    const wantCtrl = parsed.ctrl || (parsed.mod && !isMac);
    const wantMeta = parsed.meta || (parsed.mod && isMac);
    if (
        event.ctrlKey !== wantCtrl ||
        event.metaKey !== wantMeta ||
        event.altKey !== parsed.alt ||
        event.shiftKey !== parsed.shift
    ) {
        return false;
    }
    return eventKeyName(event) === parsed.key;
}

const KEY_SYMBOLS: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: '↵',
    Escape: 'Esc',
    Backspace: '⌫',
    Delete: 'Del',
};

function displayKey(key: string): string {
    if (key.length === 1) return key.toUpperCase();
    return KEY_SYMBOLS[key] ?? key;
}

/** The pieces of a chord, ready to render as individual `<kbd>` elements. */
export function chordTokens(chord: string, isMac: boolean): string[] {
    const parsed = parseChord(chord);
    if (!parsed) return [chord];
    const tokens: string[] = [];
    if (parsed.mod) tokens.push(isMac ? '⌘' : 'Ctrl');
    if (parsed.ctrl) tokens.push(isMac ? '⌃' : 'Ctrl');
    if (parsed.alt) tokens.push(isMac ? '⌥' : 'Alt');
    if (parsed.shift) tokens.push(isMac ? '⇧' : 'Shift');
    if (parsed.meta) tokens.push(isMac ? '⌘' : 'Win');
    tokens.push(displayKey(parsed.key));
    return tokens;
}

/** Single-line label for a chord — for tooltips and menu hints. */
export function formatChord(chord: string, isMac: boolean): string {
    return chordTokens(chord, isMac).join(isMac ? '' : '+');
}
