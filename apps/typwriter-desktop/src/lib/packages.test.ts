import { describe, expect, it } from 'bun:test';
import { compareVersions, importLineFor, latestVersion } from './packages';

describe('compareVersions', () => {
    it('orders by major', () => {
        expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    });

    it('orders by minor', () => {
        expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    });

    it('orders by patch', () => {
        expect(compareVersions('0.1.2', '0.1.10')).toBeLessThan(0);
    });

    it('treats equal versions as equal', () => {
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    });

    it('compares numerically, not lexically', () => {
        // The bug a naive string sort produces: "0.9.0" > "0.10.0".
        expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    });

    it('treats a missing component as zero', () => {
        expect(compareVersions('1.2', '1.2.0')).toBe(0);
        expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
    });
});

describe('latestVersion', () => {
    it('is undefined for an empty list', () => {
        expect(latestVersion([])).toBeUndefined();
    });

    it('finds the newest regardless of input order', () => {
        expect(latestVersion(['0.1.0', '1.0.0', '0.9.0'])).toBe('1.0.0');
    });

    it('does not sort lexically', () => {
        expect(latestVersion(['0.9.0', '0.10.0'])).toBe('0.10.0');
    });

    it('handles a single version', () => {
        expect(latestVersion(['0.1.0'])).toBe('0.1.0');
    });

    it('does not mutate its input', () => {
        const versions = ['0.2.0', '0.1.0'];
        latestVersion(versions);
        expect(versions).toEqual(['0.2.0', '0.1.0']);
    });
});

describe('importLineFor', () => {
    it('writes a complete, resolvable spec', () => {
        // Typst does not resolve `@preview/cetz` without a version.
        expect(importLineFor('preview', 'cetz', '0.2.2')).toBe(
            '#import "@preview/cetz:0.2.2": *\n'
        );
    });

    it('ends with a newline, so the caret lands on a fresh line', () => {
        expect(importLineFor('preview', 'x', '1.0.0').endsWith('\n')).toBe(true);
    });

    it('respects a non-preview namespace', () => {
        expect(importLineFor('local', 'mine', '0.1.0')).toContain('"@local/mine:0.1.0"');
    });
});
