// Typst's symbol set, for the symbol picker.
//
// Typst's discoverability cliff is that `alpha`, `arrow.r` and `integral` are
// only reachable if you already know their names. The picker closes that by
// letting the user search by what the symbol *is* ("right arrow", "not equal")
// or by the character itself.
//
// Insertion is context-sensitive, which is the part worth getting right: in
// math mode you write `alpha`, in markup you write `#sym.alpha`, and a few
// symbols live in the `math` scope and have to be wrapped in `$…$` outside it.

import { parser } from '$lib/typst-codemirror-lang/lezer-typst';

export interface TypstSymbol {
    /** Typst name, as written in math mode. */
    name: string;
    /** The character it renders as, for the grid. */
    char: string;
    category: SymbolCategory;
    /** Words the user might search by, beyond the name itself. */
    keywords?: string[];
    /** Lives in the `math` scope rather than `sym`, so markup needs `$…$`. */
    mathOnly?: boolean;
}

export const SYMBOL_CATEGORIES = [
    'Greek',
    'Arrows',
    'Operators',
    'Relations',
    'Sets',
    'Logic',
    'Calculus',
    'Delimiters',
    'Misc',
] as const;

export type SymbolCategory = (typeof SYMBOL_CATEGORIES)[number];

/**
 * A curated set rather than all ~3000 of Typst's symbols.
 *
 * The long tail is reachable through typst-ide's own completions; what a picker
 * adds is search-by-meaning over the symbols people actually reach for, and a
 * list that stays scannable.
 */
export const SYMBOLS: TypstSymbol[] = [
    // ── Greek (lowercase) ───────────────────────────────────────────────────
    { name: 'alpha', char: 'α', category: 'Greek' },
    { name: 'beta', char: 'β', category: 'Greek' },
    { name: 'gamma', char: 'γ', category: 'Greek' },
    { name: 'delta', char: 'δ', category: 'Greek' },
    { name: 'epsilon', char: 'ε', category: 'Greek' },
    { name: 'zeta', char: 'ζ', category: 'Greek' },
    { name: 'eta', char: 'η', category: 'Greek' },
    { name: 'theta', char: 'θ', category: 'Greek' },
    { name: 'iota', char: 'ι', category: 'Greek' },
    { name: 'kappa', char: 'κ', category: 'Greek' },
    { name: 'lambda', char: 'λ', category: 'Greek' },
    { name: 'mu', char: 'μ', category: 'Greek' },
    { name: 'nu', char: 'ν', category: 'Greek' },
    { name: 'xi', char: 'ξ', category: 'Greek' },
    { name: 'pi', char: 'π', category: 'Greek' },
    { name: 'rho', char: 'ρ', category: 'Greek' },
    { name: 'sigma', char: 'σ', category: 'Greek' },
    { name: 'tau', char: 'τ', category: 'Greek' },
    { name: 'upsilon', char: 'υ', category: 'Greek' },
    { name: 'phi', char: 'φ', category: 'Greek' },
    { name: 'chi', char: 'χ', category: 'Greek' },
    { name: 'psi', char: 'ψ', category: 'Greek' },
    { name: 'omega', char: 'ω', category: 'Greek' },

    // ── Greek (uppercase) ───────────────────────────────────────────────────
    { name: 'Gamma', char: 'Γ', category: 'Greek', keywords: ['capital'] },
    { name: 'Delta', char: 'Δ', category: 'Greek', keywords: ['capital', 'change'] },
    { name: 'Theta', char: 'Θ', category: 'Greek', keywords: ['capital'] },
    { name: 'Lambda', char: 'Λ', category: 'Greek', keywords: ['capital'] },
    { name: 'Xi', char: 'Ξ', category: 'Greek', keywords: ['capital'] },
    { name: 'Pi', char: 'Π', category: 'Greek', keywords: ['capital'] },
    { name: 'Sigma', char: 'Σ', category: 'Greek', keywords: ['capital'] },
    { name: 'Phi', char: 'Φ', category: 'Greek', keywords: ['capital'] },
    { name: 'Psi', char: 'Ψ', category: 'Greek', keywords: ['capital'] },
    { name: 'Omega', char: 'Ω', category: 'Greek', keywords: ['capital', 'ohm'] },

    // ── Arrows ──────────────────────────────────────────────────────────────
    { name: 'arrow.r', char: '→', category: 'Arrows', keywords: ['right', 'to', 'maps'] },
    { name: 'arrow.l', char: '←', category: 'Arrows', keywords: ['left', 'from'] },
    { name: 'arrow.t', char: '↑', category: 'Arrows', keywords: ['up', 'top'] },
    { name: 'arrow.b', char: '↓', category: 'Arrows', keywords: ['down', 'bottom'] },
    { name: 'arrow.l.r', char: '↔', category: 'Arrows', keywords: ['both', 'bidirectional'] },
    { name: 'arrow.r.double', char: '⇒', category: 'Arrows', keywords: ['implies', 'then'] },
    { name: 'arrow.l.double', char: '⇐', category: 'Arrows', keywords: ['implied by'] },
    {
        name: 'arrow.l.r.double',
        char: '⇔',
        category: 'Arrows',
        keywords: ['iff', 'equivalent', 'if and only if'],
    },
    { name: 'arrow.r.long', char: '⟶', category: 'Arrows', keywords: ['long right'] },
    { name: 'arrow.r.bar', char: '↦', category: 'Arrows', keywords: ['maps to', 'mapsto'] },
    { name: 'arrow.hook.r', char: '↪', category: 'Arrows', keywords: ['hook', 'injects'] },
    { name: 'arrow.r.squiggly', char: '⇝', category: 'Arrows', keywords: ['squiggly', 'leads'] },
    { name: 'arrows.rr', char: '⇉', category: 'Arrows', keywords: ['parallel'] },

    // ── Operators ───────────────────────────────────────────────────────────
    { name: 'plus.minus', char: '±', category: 'Operators', keywords: ['pm', 'plus or minus'] },
    { name: 'minus.plus', char: '∓', category: 'Operators', keywords: ['mp'] },
    { name: 'times', char: '×', category: 'Operators', keywords: ['multiply', 'cross', 'x'] },
    { name: 'div', char: '÷', category: 'Operators', keywords: ['divide', 'obelus'] },
    { name: 'dot.op', char: '⋅', category: 'Operators', keywords: ['cdot', 'multiply'] },
    { name: 'star.op', char: '⋆', category: 'Operators', keywords: ['star'] },
    { name: 'circle.small', char: '∘', category: 'Operators', keywords: ['compose', 'ring'] },
    { name: 'plus.circle', char: '⊕', category: 'Operators', keywords: ['oplus', 'xor'] },
    { name: 'times.circle', char: '⊗', category: 'Operators', keywords: ['otimes', 'tensor'] },

    // ── Relations ───────────────────────────────────────────────────────────
    { name: 'eq.not', char: '≠', category: 'Relations', keywords: ['not equal', 'neq'] },
    { name: 'lt.eq', char: '≤', category: 'Relations', keywords: ['less than or equal', 'leq'] },
    { name: 'gt.eq', char: '≥', category: 'Relations', keywords: ['greater or equal', 'geq'] },
    { name: 'approx', char: '≈', category: 'Relations', keywords: ['about', 'roughly'] },
    { name: 'equiv', char: '≡', category: 'Relations', keywords: ['identical', 'congruent'] },
    { name: 'prop', char: '∝', category: 'Relations', keywords: ['proportional'] },
    { name: 'tilde.op', char: '∼', category: 'Relations', keywords: ['similar'] },
    { name: 'prec', char: '≺', category: 'Relations', keywords: ['precedes'] },
    { name: 'succ', char: '≻', category: 'Relations', keywords: ['succeeds'] },
    { name: 'll', char: '≪', category: 'Relations', keywords: ['much less'] },
    { name: 'gt.triple', char: '≫', category: 'Relations', keywords: ['much greater'] },

    // ── Sets ────────────────────────────────────────────────────────────────
    { name: 'in', char: '∈', category: 'Sets', keywords: ['element of', 'member'] },
    { name: 'in.not', char: '∉', category: 'Sets', keywords: ['not element of'] },
    { name: 'subset', char: '⊂', category: 'Sets', keywords: ['contained in'] },
    { name: 'subset.eq', char: '⊆', category: 'Sets', keywords: ['subset or equal'] },
    { name: 'supset', char: '⊃', category: 'Sets', keywords: ['contains'] },
    { name: 'supset.eq', char: '⊇', category: 'Sets', keywords: ['superset or equal'] },
    { name: 'union', char: '∪', category: 'Sets', keywords: ['cup', 'or'] },
    { name: 'sect', char: '∩', category: 'Sets', keywords: ['cap', 'intersection', 'and'] },
    { name: 'union.big', char: '⋃', category: 'Sets', keywords: ['big union'] },
    { name: 'sect.big', char: '⋂', category: 'Sets', keywords: ['big intersection'] },
    { name: 'emptyset', char: '∅', category: 'Sets', keywords: ['empty', 'null', 'void'] },
    { name: 'NN', char: 'ℕ', category: 'Sets', keywords: ['naturals'], mathOnly: true },
    { name: 'ZZ', char: 'ℤ', category: 'Sets', keywords: ['integers'], mathOnly: true },
    { name: 'QQ', char: 'ℚ', category: 'Sets', keywords: ['rationals'], mathOnly: true },
    { name: 'RR', char: 'ℝ', category: 'Sets', keywords: ['reals'], mathOnly: true },
    { name: 'CC', char: 'ℂ', category: 'Sets', keywords: ['complex'], mathOnly: true },

    // ── Logic ───────────────────────────────────────────────────────────────
    { name: 'and', char: '∧', category: 'Logic', keywords: ['wedge', 'conjunction'] },
    { name: 'or', char: '∨', category: 'Logic', keywords: ['vee', 'disjunction'] },
    { name: 'not', char: '¬', category: 'Logic', keywords: ['negation', 'lnot'] },
    { name: 'forall', char: '∀', category: 'Logic', keywords: ['for all', 'every'] },
    { name: 'exists', char: '∃', category: 'Logic', keywords: ['there exists', 'some'] },
    { name: 'exists.not', char: '∄', category: 'Logic', keywords: ['does not exist'] },
    { name: 'therefore', char: '∴', category: 'Logic', keywords: ['thus', 'hence'] },
    { name: 'because', char: '∵', category: 'Logic', keywords: ['since'] },
    { name: 'models', char: '⊨', category: 'Logic', keywords: ['entails', 'satisfies'] },
    { name: 'tack.r', char: '⊢', category: 'Logic', keywords: ['proves', 'turnstile'] },

    // ── Calculus ────────────────────────────────────────────────────────────
    { name: 'sum', char: '∑', category: 'Calculus', keywords: ['sigma', 'total'] },
    { name: 'product', char: '∏', category: 'Calculus', keywords: ['pi', 'prod'] },
    { name: 'integral', char: '∫', category: 'Calculus', keywords: ['int'] },
    { name: 'integral.double', char: '∬', category: 'Calculus', keywords: ['double integral'] },
    { name: 'integral.triple', char: '∭', category: 'Calculus', keywords: ['triple integral'] },
    { name: 'integral.cont', char: '∮', category: 'Calculus', keywords: ['contour', 'closed'] },
    { name: 'diff', char: '∂', category: 'Calculus', keywords: ['partial', 'derivative'] },
    { name: 'nabla', char: '∇', category: 'Calculus', keywords: ['del', 'gradient'] },
    { name: 'infinity', char: '∞', category: 'Calculus', keywords: ['inf', 'infinite'] },
    { name: 'lim', char: 'lim', category: 'Calculus', keywords: ['limit'], mathOnly: true },
    { name: 'sqrt', char: '√', category: 'Calculus', keywords: ['root', 'radical'] },

    // ── Delimiters ──────────────────────────────────────────────────────────
    { name: 'angle.l', char: '⟨', category: 'Delimiters', keywords: ['bra', 'left angle'] },
    { name: 'angle.r', char: '⟩', category: 'Delimiters', keywords: ['ket', 'right angle'] },
    { name: 'floor.l', char: '⌊', category: 'Delimiters', keywords: ['left floor'] },
    { name: 'floor.r', char: '⌋', category: 'Delimiters', keywords: ['right floor'] },
    { name: 'ceil.l', char: '⌈', category: 'Delimiters', keywords: ['left ceiling'] },
    { name: 'ceil.r', char: '⌉', category: 'Delimiters', keywords: ['right ceiling'] },
    { name: 'bar.v', char: '|', category: 'Delimiters', keywords: ['pipe', 'absolute'] },
    { name: 'bar.v.double', char: '‖', category: 'Delimiters', keywords: ['norm'] },

    // ── Misc ────────────────────────────────────────────────────────────────
    { name: 'dots.h', char: '…', category: 'Misc', keywords: ['ellipsis', 'horizontal'] },
    { name: 'dots.v', char: '⋮', category: 'Misc', keywords: ['vertical dots'] },
    { name: 'dots.down', char: '⋱', category: 'Misc', keywords: ['diagonal dots'] },
    { name: 'angle', char: '∠', category: 'Misc', keywords: ['geometry'] },
    { name: 'degree', char: '°', category: 'Misc', keywords: ['deg', 'temperature'] },
    { name: 'prime', char: '′', category: 'Misc', keywords: ['derivative', 'minute'] },
    { name: 'perp', char: '⊥', category: 'Misc', keywords: ['perpendicular', 'bottom'] },
    { name: 'parallel', char: '∥', category: 'Misc', keywords: ['parallel lines'] },
    { name: 'checkmark', char: '✓', category: 'Misc', keywords: ['tick', 'yes', 'done'] },
    { name: 'crossmark', char: '✗', category: 'Misc', keywords: ['no', 'wrong'] },
    { name: 'dagger', char: '†', category: 'Misc', keywords: ['footnote'] },
    { name: 'section', char: '§', category: 'Misc', keywords: ['paragraph sign'] },
    { name: 'copyright', char: '©', category: 'Misc', keywords: ['legal'] },
    { name: 'star.filled', char: '★', category: 'Misc', keywords: ['favourite'] },
    { name: 'circle.filled', char: '●', category: 'Misc', keywords: ['bullet', 'dot'] },
    { name: 'square.filled', char: '■', category: 'Misc', keywords: ['box'] },
    { name: 'triangle.filled', char: '▲', category: 'Misc', keywords: ['up triangle'] },
    { name: 'euro', char: '€', category: 'Misc', keywords: ['currency'] },
    { name: 'pound', char: '£', category: 'Misc', keywords: ['currency', 'sterling'] },
    { name: 'yen', char: '¥', category: 'Misc', keywords: ['currency'] },
];

/**
 * Whether `offset` sits inside an equation.
 *
 * Determines how a symbol has to be written: `alpha` inside `$…$`,
 * `#sym.alpha` outside it.
 */
export function isInMath(text: string, offset: number): boolean {
    if (!text) return false;
    const tree = parser.parse(text);
    let inMath = false;

    tree.iterate({
        enter(node) {
            if (node.name !== 'Equation') return;
            // `to` is exclusive of the closing `$`, but a caret sitting just
            // before it is still inside the equation.
            if (offset >= node.from && offset <= node.to) inMath = true;
        },
    });
    return inMath;
}

/**
 * The text to insert for `symbol` at a caret that is (or is not) in math mode.
 *
 * Math-scope symbols such as `RR` do not exist under `sym`, so in markup they
 * are wrapped in an inline equation rather than written as `#sym.RR`, which
 * would not compile.
 */
export function insertionFor(symbol: TypstSymbol, inMath: boolean): string {
    if (inMath) return symbol.name;
    return symbol.mathOnly ? `$${symbol.name}$` : `#sym.${symbol.name}`;
}
