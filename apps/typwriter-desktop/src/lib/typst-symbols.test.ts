import { describe, expect, it } from 'bun:test';
import {
    insertionFor,
    isInMath,
    SYMBOLS,
    SYMBOL_CATEGORIES,
    type TypstSymbol,
} from './typst-symbols';
import { fuzzyRank } from './fuzzy';

const byName = (name: string): TypstSymbol => {
    const found = SYMBOLS.find((s) => s.name === name);
    if (!found) throw new Error(`no symbol named ${name}`);
    return found;
};

describe('SYMBOLS table', () => {
    it('has no duplicate names', () => {
        // A duplicate would give the picker two identical-looking rows that
        // insert the same thing.
        const names = SYMBOLS.map((s) => s.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('gives every symbol a character to display', () => {
        for (const symbol of SYMBOLS) {
            expect(symbol.char.length).toBeGreaterThan(0);
        }
    });

    it('only uses declared categories', () => {
        for (const symbol of SYMBOLS) {
            expect(SYMBOL_CATEGORIES).toContain(symbol.category);
        }
    });

    it('covers every category, so none renders as an empty section', () => {
        for (const category of SYMBOL_CATEGORIES) {
            expect(SYMBOLS.some((s) => s.category === category)).toBe(true);
        }
    });

    it('uses no whitespace in names, which would not compile', () => {
        for (const symbol of SYMBOLS) {
            expect(symbol.name).not.toMatch(/\s/);
        }
    });
});

describe('isInMath', () => {
    it('is false in plain prose', () => {
        expect(isInMath('just some words', 5)).toBe(false);
    });

    it('is true inside an inline equation', () => {
        const src = 'text $ a + b $ more';
        expect(isInMath(src, src.indexOf('a'))).toBe(true);
    });

    it('is false before an equation', () => {
        const src = 'text $ a $';
        expect(isInMath(src, 2)).toBe(false);
    });

    it('is false after an equation', () => {
        const src = '$ a $ tail';
        expect(isInMath(src, src.length - 1)).toBe(false);
    });

    it('is false for an empty document', () => {
        expect(isInMath('', 0)).toBe(false);
    });

    it('is true inside a block equation', () => {
        const src = '$\n  x = y\n$';
        expect(isInMath(src, src.indexOf('x'))).toBe(true);
    });

    it('does not treat a dollar in a raw block as math', () => {
        // Same reason every other feature here goes through the parser.
        const src = '```\n$ not math $\n```\n';
        expect(isInMath(src, src.indexOf('not'))).toBe(false);
    });
});

describe('insertionFor', () => {
    it('writes the bare name in math mode', () => {
        expect(insertionFor(byName('alpha'), true)).toBe('alpha');
    });

    it('writes a sym path in markup', () => {
        expect(insertionFor(byName('alpha'), false)).toBe('#sym.alpha');
    });

    it('keeps dotted names intact', () => {
        expect(insertionFor(byName('arrow.r'), true)).toBe('arrow.r');
        expect(insertionFor(byName('arrow.r'), false)).toBe('#sym.arrow.r');
    });

    it('wraps a math-scope symbol in an equation when in markup', () => {
        // `#sym.RR` does not exist — RR lives in the math scope, so writing it
        // as a sym path would not compile.
        expect(insertionFor(byName('RR'), false)).toBe('$RR$');
    });

    it('writes a math-scope symbol bare when already in math', () => {
        expect(insertionFor(byName('RR'), true)).toBe('RR');
    });
});

describe('searching the table', () => {
    const search = (query: string) =>
        fuzzyRank(
            SYMBOLS,
            query,
            (s) => s.name,
            (s) => [...(s.keywords ?? []), s.char, s.category]
        ).map((r) => r.item.name);

    it('finds a symbol by name', () => {
        expect(search('alpha')[0]).toBe('alpha');
    });

    it('finds a symbol by what it means', () => {
        // The whole point: the user knows "not equal", not `eq.not`.
        expect(search('not equal')).toContain('eq.not');
    });

    it('finds an arrow by direction', () => {
        expect(search('right')).toContain('arrow.r');
    });

    it('finds a symbol by pasting the character', () => {
        expect(search('≠')).toContain('eq.not');
    });

    it('finds implication by its common name', () => {
        expect(search('implies')).toContain('arrow.r.double');
    });

    it('finds set membership by meaning', () => {
        expect(search('element')).toContain('in');
    });

    it('returns everything for an empty query', () => {
        expect(search('')).toHaveLength(SYMBOLS.length);
    });
});
