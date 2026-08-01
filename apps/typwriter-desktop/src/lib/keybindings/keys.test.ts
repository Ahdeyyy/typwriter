import { describe, expect, test } from 'bun:test';

import {
    chordFromEvent,
    chordTokens,
    formatChord,
    matchesChord,
    normalizeChord,
    parseChord,
} from './keys';

/** A stand-in for the fields these helpers read off a real KeyboardEvent. */
function event(
    key: string,
    modifiers: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {},
    code = '',
): KeyboardEvent {
    return {
        key,
        code,
        ctrlKey: !!modifiers.ctrl,
        altKey: !!modifiers.alt,
        shiftKey: !!modifiers.shift,
        metaKey: !!modifiers.meta,
    } as KeyboardEvent;
}

describe('parseChord', () => {
    test('reads modifiers in any order and case-folds the key', () => {
        expect(parseChord('Shift-Mod-B')).toEqual({
            mod: true,
            ctrl: false,
            alt: false,
            shift: true,
            meta: false,
            key: 'b',
        });
    });

    test('keeps named keys intact and canonicalizes aliases', () => {
        expect(parseChord('ArrowRight')?.key).toBe('ArrowRight');
        expect(parseChord('esc')?.key).toBe('Escape');
        expect(parseChord('Mod-space')?.key).toBe('Space');
        expect(parseChord('f5')?.key).toBe('F5');
    });

    test('handles a chord whose key is the separator', () => {
        expect(parseChord('Mod--')).toMatchObject({ mod: true, key: '-' });
    });

    test('rejects malformed chords rather than guessing', () => {
        expect(parseChord('Hyper-b')).toBeNull();
        expect(parseChord('')).toBeNull();
    });
});

describe('normalizeChord', () => {
    test('reorders modifiers into the canonical form', () => {
        expect(normalizeChord('shift-alt-F')).toBe('Alt-Shift-f');
        expect(normalizeChord('cmd-s')).toBe('Meta-s');
    });
});

describe('matchesChord', () => {
    test('Mod is Ctrl off macOS and Cmd on it', () => {
        expect(matchesChord(event('s', { ctrl: true }), 'Mod-s', false)).toBe(true);
        expect(matchesChord(event('s', { meta: true }), 'Mod-s', false)).toBe(false);
        expect(matchesChord(event('s', { meta: true }), 'Mod-s', true)).toBe(true);
        expect(matchesChord(event('s', { ctrl: true }), 'Mod-s', true)).toBe(false);
    });

    test('a modifier the chord does not ask for blocks the match', () => {
        expect(matchesChord(event('s', { ctrl: true, shift: true }), 'Mod-s', false)).toBe(false);
    });

    test('Shift is carried by the modifier, not the shifted character', () => {
        const shiftB = event('B', { ctrl: true, shift: true }, 'KeyB');
        expect(matchesChord(shiftB, 'Mod-Shift-b', false)).toBe(true);
        const shiftOne = event('!', { ctrl: true, shift: true }, 'Digit1');
        expect(matchesChord(shiftOne, 'Mod-Shift-1', false)).toBe(true);
    });

    test('Space matches the space character', () => {
        expect(matchesChord(event(' '), 'Space', false)).toBe(true);
    });

    test('an unparseable chord never fires', () => {
        expect(matchesChord(event('b', { ctrl: true }), 'Hyper-b', false)).toBe(false);
    });
});

describe('chordFromEvent', () => {
    test('records the chord a keystroke would be stored as', () => {
        expect(chordFromEvent(event('s', { ctrl: true }), false)).toBe('Mod-s');
        expect(chordFromEvent(event('s', { meta: true }), true)).toBe('Mod-s');
        expect(chordFromEvent(event('F', { alt: true, shift: true }, 'KeyF'), false)).toBe(
            'Alt-Shift-f',
        );
    });

    test('on macOS Control stays its own modifier', () => {
        expect(chordFromEvent(event('k', { ctrl: true }), true)).toBe('Ctrl-k');
    });

    test('a bare modifier press yields nothing to record', () => {
        expect(chordFromEvent(event('Shift', { shift: true }), false)).toBeNull();
    });

    test('round-trips through matchesChord', () => {
        const keystroke = event('e', { ctrl: true, alt: true });
        const chord = chordFromEvent(keystroke, false);
        expect(chord).not.toBeNull();
        expect(matchesChord(keystroke, chord!, false)).toBe(true);
    });
});

describe('display', () => {
    test('spells modifiers out off macOS and uses symbols on it', () => {
        expect(formatChord('Mod-Shift-b', false)).toBe('Ctrl+Shift+B');
        expect(formatChord('Mod-Shift-b', true)).toBe('⌘⇧B');
    });

    test('gives arrows and Escape their conventional glyphs', () => {
        expect(chordTokens('ArrowRight', false)).toEqual(['→']);
        expect(chordTokens('Escape', false)).toEqual(['Esc']);
    });

    test('falls back to the raw string for a chord it cannot parse', () => {
        expect(chordTokens('Hyper-b', false)).toEqual(['Hyper-b']);
    });
});
