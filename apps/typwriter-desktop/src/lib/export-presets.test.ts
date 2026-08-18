import { describe, expect, it } from 'bun:test';
import {
    configMatches,
    DEFAULT_EXPORT_CONFIG,
    findPreset,
    normalizePreset,
    normalizePresetList,
    removePreset,
    toConfig,
    upsertPreset,
    type ExportPreset,
} from './export-presets';

const preset = (over: Partial<ExportPreset> = {}): ExportPreset => ({
    name: 'Draft',
    ...DEFAULT_EXPORT_CONFIG,
    ...over,
});

describe('normalizePreset', () => {
    it('rejects a non-object', () => {
        expect(normalizePreset(null)).toBeNull();
        expect(normalizePreset('nope')).toBeNull();
        expect(normalizePreset(42)).toBeNull();
    });

    it('rejects an entry with no name, which nothing could select', () => {
        expect(normalizePreset({ format: 'pdf' })).toBeNull();
        expect(normalizePreset({ name: '   ' })).toBeNull();
    });

    it('trims the name', () => {
        expect(normalizePreset({ name: '  Draft  ' })?.name).toBe('Draft');
    });

    it('fills every missing field from the defaults', () => {
        // A preset written by an older version must still load.
        const result = normalizePreset({ name: 'Minimal' })!;
        expect(result).toMatchObject({ name: 'Minimal', ...DEFAULT_EXPORT_CONFIG });
    });

    it('keeps recognised values', () => {
        const result = normalizePreset({
            name: 'Camera',
            format: 'png',
            pngScale: 4,
            filePrefix: 'plate',
            pdfPretty: true,
        })!;
        expect(result).toMatchObject({
            format: 'png',
            pngScale: 4,
            filePrefix: 'plate',
            pdfPretty: true,
        });
    });

    it('falls back on an unknown format rather than trusting it', () => {
        expect(normalizePreset({ name: 'x', format: 'docx' })?.format).toBe('pdf');
    });

    it('ignores unknown extra keys', () => {
        // Forward compatibility: a newer version's field should not break this one.
        const result = normalizePreset({ name: 'x', somethingNew: true })!;
        expect(result).not.toHaveProperty('somethingNew');
    });

    it('clamps an absurd png scale', () => {
        expect(normalizePreset({ name: 'x', pngScale: 1000 })?.pngScale).toBe(10);
        expect(normalizePreset({ name: 'x', pngScale: 0 })?.pngScale).toBe(0.1);
    });

    it('rejects a non-finite png scale', () => {
        expect(normalizePreset({ name: 'x', pngScale: NaN })?.pngScale).toBe(2);
        expect(normalizePreset({ name: 'x', pngScale: 'big' })?.pngScale).toBe(2);
    });

    it('treats any non-custom page range mode as "all"', () => {
        expect(normalizePreset({ name: 'x', pageRangeMode: 'weird' })?.pageRangeMode).toBe('all');
        expect(normalizePreset({ name: 'x', pageRangeMode: 'custom' })?.pageRangeMode).toBe(
            'custom'
        );
    });

    it('rejects a wrongly typed boolean rather than coercing it', () => {
        // `"false"` is truthy; coercing would silently invert the user's setting.
        expect(normalizePreset({ name: 'x', pdfPretty: 'false' })?.pdfPretty).toBe(false);
    });
});

describe('normalizePresetList', () => {
    it('returns nothing for a non-array', () => {
        expect(normalizePresetList(null)).toEqual([]);
        expect(normalizePresetList({})).toEqual([]);
    });

    it('drops unrepairable entries and keeps the rest', () => {
        const list = normalizePresetList([{ name: 'ok' }, null, { format: 'pdf' }]);
        expect(list.map((p) => p.name)).toEqual(['ok']);
    });

    it('keeps the first of a duplicated name', () => {
        const list = normalizePresetList([
            { name: 'Draft', pngScale: 1 },
            { name: 'draft', pngScale: 4 },
        ]);
        expect(list).toHaveLength(1);
        expect(list[0].pngScale).toBe(1);
    });

    it('sorts by name so the dropdown is stable', () => {
        const list = normalizePresetList([{ name: 'zeta' }, { name: 'alpha' }]);
        expect(list.map((p) => p.name)).toEqual(['alpha', 'zeta']);
    });
});

describe('upsertPreset', () => {
    it('adds a new preset', () => {
        const list = upsertPreset([], preset({ name: 'A' }));
        expect(list.map((p) => p.name)).toEqual(['A']);
    });

    it('replaces one of the same name', () => {
        const list = upsertPreset([preset({ name: 'A', pngScale: 1 })], preset({ name: 'A', pngScale: 4 }));
        expect(list).toHaveLength(1);
        expect(list[0].pngScale).toBe(4);
    });

    it('replaces case-insensitively', () => {
        // "Draft" and "draft" are the same preset to whoever typed them.
        const list = upsertPreset([preset({ name: 'Draft' })], preset({ name: 'draft' }));
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('draft');
    });

    it('keeps the list sorted', () => {
        let list = upsertPreset([], preset({ name: 'zeta' }));
        list = upsertPreset(list, preset({ name: 'alpha' }));
        expect(list.map((p) => p.name)).toEqual(['alpha', 'zeta']);
    });

    it('does not mutate the input', () => {
        const original = [preset({ name: 'A' })];
        upsertPreset(original, preset({ name: 'B' }));
        expect(original).toHaveLength(1);
    });
});

describe('removePreset', () => {
    it('removes by name', () => {
        expect(removePreset([preset({ name: 'A' })], 'A')).toEqual([]);
    });

    it('removes case-insensitively', () => {
        expect(removePreset([preset({ name: 'Draft' })], 'draft')).toEqual([]);
    });

    it('leaves others alone', () => {
        const list = removePreset([preset({ name: 'A' }), preset({ name: 'B' })], 'A');
        expect(list.map((p) => p.name)).toEqual(['B']);
    });

    it('is a no-op for an unknown name', () => {
        expect(removePreset([preset({ name: 'A' })], 'Z')).toHaveLength(1);
    });
});

describe('findPreset', () => {
    it('finds case-insensitively', () => {
        expect(findPreset([preset({ name: 'Draft' })], 'DRAFT')?.name).toBe('Draft');
    });

    it('is undefined when absent', () => {
        expect(findPreset([], 'Draft')).toBeUndefined();
    });
});

describe('toConfig / configMatches', () => {
    it('strips the name', () => {
        expect(toConfig(preset({ name: 'A' }))).not.toHaveProperty('name');
    });

    it('matches an unchanged config', () => {
        const p = preset({ name: 'A', pngScale: 3 });
        expect(configMatches(toConfig(p), p)).toBe(true);
    });

    it('detects any changed field', () => {
        const p = preset({ name: 'A', pngScale: 3 });
        expect(configMatches({ ...toConfig(p), pngScale: 4 }, p)).toBe(false);
        expect(configMatches({ ...toConfig(p), pdfTitle: 'x' }, p)).toBe(false);
        expect(configMatches({ ...toConfig(p), format: 'svg' }, p)).toBe(false);
    });

    it('ignores the preset name when comparing', () => {
        // Renaming is not a configuration change.
        const p = preset({ name: 'A' });
        expect(configMatches(toConfig(preset({ name: 'B' })), p)).toBe(true);
    });
});
