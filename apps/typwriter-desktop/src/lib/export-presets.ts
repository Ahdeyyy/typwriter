// Named export configurations.
//
// The export dialog already has every knob; nothing remembered a combination of
// them. "Camera-ready PDF/A" and "web PNGs at 288 DPI" are settings a document
// keeps for its whole life, and re-entering them per export is the kind of
// friction that makes people export wrong.
//
// Pure: the store and the dialog are thin layers over this.

export type ExportFormat = 'pdf' | 'png' | 'svg' | 'html';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['pdf', 'png', 'svg', 'html'];

/** Everything the export dialog can be set to. */
export interface ExportConfig {
    format: ExportFormat;
    pageRangeMode: 'all' | 'custom';
    pageRangeCustom: string;
    pdfTitle: string;
    pdfAuthor: string;
    pdfStandard: string;
    pdfIncludeDate: boolean;
    pdfPretty: boolean;
    htmlPretty: boolean;
    pngScale: number;
    filePrefix: string;
}

export interface ExportPreset extends ExportConfig {
    /** Display name and identity — saving under an existing name replaces it. */
    name: string;
}

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
    format: 'pdf',
    pageRangeMode: 'all',
    pageRangeCustom: '',
    pdfTitle: '',
    pdfAuthor: '',
    pdfStandard: '1.7',
    pdfIncludeDate: false,
    pdfPretty: false,
    htmlPretty: false,
    pngScale: 2.0,
    filePrefix: 'page',
};

/** PNG scale bounds. Below this the output is unusable; above it, enormous. */
const MIN_PNG_SCALE = 0.1;
const MAX_PNG_SCALE = 10;

function asString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function asScale(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(Math.max(value, MIN_PNG_SCALE), MAX_PNG_SCALE);
}

/**
 * Coerce stored JSON into a usable preset, or `null` if it is not one.
 *
 * Deliberately lenient about *fields* and strict about *identity*: a preset
 * written by a newer version with an unknown key should still load with
 * defaults for what is missing, but one with no name has nothing to be
 * selected by and cannot be repaired.
 */
export function normalizePreset(value: unknown): ExportPreset | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) return null;

    const format = EXPORT_FORMATS.includes(raw.format as ExportFormat)
        ? (raw.format as ExportFormat)
        : DEFAULT_EXPORT_CONFIG.format;

    return {
        name,
        format,
        pageRangeMode: raw.pageRangeMode === 'custom' ? 'custom' : 'all',
        pageRangeCustom: asString(raw.pageRangeCustom, DEFAULT_EXPORT_CONFIG.pageRangeCustom),
        pdfTitle: asString(raw.pdfTitle, DEFAULT_EXPORT_CONFIG.pdfTitle),
        pdfAuthor: asString(raw.pdfAuthor, DEFAULT_EXPORT_CONFIG.pdfAuthor),
        pdfStandard: asString(raw.pdfStandard, DEFAULT_EXPORT_CONFIG.pdfStandard),
        pdfIncludeDate: asBoolean(raw.pdfIncludeDate, DEFAULT_EXPORT_CONFIG.pdfIncludeDate),
        pdfPretty: asBoolean(raw.pdfPretty, DEFAULT_EXPORT_CONFIG.pdfPretty),
        htmlPretty: asBoolean(raw.htmlPretty, DEFAULT_EXPORT_CONFIG.htmlPretty),
        pngScale: asScale(raw.pngScale, DEFAULT_EXPORT_CONFIG.pngScale),
        filePrefix: asString(raw.filePrefix, DEFAULT_EXPORT_CONFIG.filePrefix),
    };
}

/** Coerce a whole stored list, dropping entries that cannot be repaired. */
export function normalizePresetList(value: unknown): ExportPreset[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: ExportPreset[] = [];
    for (const entry of value) {
        const preset = normalizePreset(entry);
        if (!preset) continue;
        // Names are identity, so a duplicated one in storage keeps the first.
        const key = preset.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(preset);
    }
    return sortPresets(out);
}

function sortPresets(presets: ExportPreset[]): ExportPreset[] {
    return [...presets].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Insert or replace `preset` by name, case-insensitively.
 *
 * Case-insensitive because "Draft" and "draft" are the same preset to the person
 * who typed them, and having both would be a bug they cannot see.
 */
export function upsertPreset(
    presets: readonly ExportPreset[],
    preset: ExportPreset
): ExportPreset[] {
    const key = preset.name.toLowerCase();
    const kept = presets.filter((existing) => existing.name.toLowerCase() !== key);
    return sortPresets([...kept, preset]);
}

export function removePreset(
    presets: readonly ExportPreset[],
    name: string
): ExportPreset[] {
    const key = name.toLowerCase();
    return presets.filter((preset) => preset.name.toLowerCase() !== key);
}

export function findPreset(
    presets: readonly ExportPreset[],
    name: string
): ExportPreset | undefined {
    const key = name.toLowerCase();
    return presets.find((preset) => preset.name.toLowerCase() === key);
}

/** Split a preset back into a name and the configuration it carries. */
export function toConfig(preset: ExportPreset): ExportConfig {
    const { name: _name, ...config } = preset;
    return config;
}

/** Whether a config differs from a preset — drives the "unsaved changes" hint. */
export function configMatches(config: ExportConfig, preset: ExportPreset): boolean {
    const target = toConfig(preset);
    return (Object.keys(target) as (keyof ExportConfig)[]).every(
        (key) => config[key] === target[key]
    );
}
