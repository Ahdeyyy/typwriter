import { describe, expect, it } from 'bun:test';
import { diagnosticsMatch, type DiagnosticMark } from './diagnostics-compare';

// This gate decides whether a `setDiagnostics` dispatch happens. Every dispatch
// closes an open lint tooltip, so a false "changed" makes tooltips disappear
// mid-read on every compile cycle; a false "unchanged" leaves stale marks on
// screen. Both are user-visible, so the boundary cases are pinned here.

const mark = (over: Partial<DiagnosticMark> = {}): DiagnosticMark => ({
    from: 10,
    to: 20,
    severity: 'error',
    message: 'unknown variable',
    ...over,
});

describe('diagnosticsMatch', () => {
    it('treats two empty sets as matching', () => {
        expect(diagnosticsMatch([], [])).toBe(true);
    });

    it('matches identical single diagnostics', () => {
        expect(diagnosticsMatch([mark()], [mark()])).toBe(true);
    });

    it('matches regardless of order', () => {
        // The compile pipeline and the store build these lists independently,
        // so ordering must not count as a change.
        const a = mark({ from: 1, to: 2, message: 'first' });
        const b = mark({ from: 30, to: 40, message: 'second' });
        expect(diagnosticsMatch([a, b], [b, a])).toBe(true);
    });

    it('detects a different count', () => {
        expect(diagnosticsMatch([mark()], [])).toBe(false);
        expect(diagnosticsMatch([], [mark()])).toBe(false);
        expect(diagnosticsMatch([mark()], [mark(), mark({ from: 99 })])).toBe(false);
    });

    it('detects a moved range', () => {
        // The same error one line down is a different mark — it must re-render.
        expect(diagnosticsMatch([mark({ from: 10 })], [mark({ from: 11 })])).toBe(false);
        expect(diagnosticsMatch([mark({ to: 20 })], [mark({ to: 21 })])).toBe(false);
    });

    it('detects a changed severity', () => {
        expect(
            diagnosticsMatch([mark({ severity: 'error' })], [mark({ severity: 'warning' })])
        ).toBe(false);
    });

    it('detects a changed message', () => {
        expect(diagnosticsMatch([mark({ message: 'a' })], [mark({ message: 'b' })])).toBe(false);
    });

    it('does not confuse fields that concatenate to the same string', () => {
        // A naive `${from}${to}${severity}${message}` key would collide here.
        const a = mark({ from: 1, to: 23, severity: 'error', message: 'x' });
        const b = mark({ from: 12, to: 3, severity: 'error', message: 'x' });
        expect(diagnosticsMatch([a], [b])).toBe(false);
    });

    it('handles a large unchanged set', () => {
        // The common case on every compile: nothing changed, so nothing should
        // be dispatched.
        const many = Array.from({ length: 500 }, (_, i) =>
            mark({ from: i, to: i + 5, message: `problem ${i}` })
        );
        expect(diagnosticsMatch(many, [...many].reverse())).toBe(true);
    });

    it('detects a single change inside a large set', () => {
        const many = Array.from({ length: 500 }, (_, i) =>
            mark({ from: i, to: i + 5, message: `problem ${i}` })
        );
        const changed = [...many];
        changed[250] = mark({ from: 250, to: 255, message: 'something else' });
        expect(diagnosticsMatch(many, changed)).toBe(false);
    });
});
