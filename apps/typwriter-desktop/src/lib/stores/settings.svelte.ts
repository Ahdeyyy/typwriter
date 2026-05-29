// settings.svelte.ts — User preferences.
//
// Two storage layers:
//   • Font directories are persisted on the Rust side (they feed the Typst
//     font search) and round-trip via `getAppSettings` / `setTypstFontDirectories`.
//   • UI-only preferences (theme, fonts, sizes) live in localStorage so the
//     frontend can apply them before any IPC round-trip.

import { ResultAsync, okAsync } from 'neverthrow';
import {
    getAppSettings,
    setAppSettings,
    setTypstFontDirectories,
} from '$lib/ipc/commands';
import { logError } from '$lib/logger';

const LS_KEY = 'typwriter:settings:v1';

// Fonts bundled via @fontsource(-variable) in `layout.css`. These are the only
// families the WebView can resolve reliably on every platform — Android in
// particular can't load fonts that Typst discovered on disk because they aren't
// registered with the browser engine.
export const BUNDLED_UI_FONTS: readonly string[] = [
    // Sans
    'IBM Plex Sans Variable',
    'Inter Variable',
    'Geist Variable',
    'Roboto Flex Variable',
    'Source Sans 3 Variable',
    'Noto Sans Variable',
    'Nunito Variable',
    'DM Sans Variable',
    'Work Sans Variable',
    'Manrope Variable',
    'Figtree Variable',
    'Plus Jakarta Sans Variable',
    'Space Grotesk Variable',
    'Lexend Variable',
    'Outfit Variable',
    'Atkinson Hyperlegible',
    'Iosevka',
    // Serif
    'Lora Variable',
    'Merriweather Variable',
    'Crimson Pro Variable',
    'Playfair Display Variable',
    'Source Serif 4 Variable',
    'Bitter Variable',
    'Newsreader Variable',
    'EB Garamond Variable',
];

export const BUNDLED_EDITOR_FONTS: readonly string[] = [
    'JetBrains Mono Variable',
    'Fira Code Variable',
    'Geist Mono Variable',
    'Source Code Pro Variable',
    'Roboto Mono Variable',
    'Spline Sans Mono Variable',
    'Red Hat Mono Variable',
    'Martian Mono Variable',
    'Inconsolata Variable',
    'IBM Plex Mono',
    'Cascadia Code',
    'Ubuntu Mono',
    'Space Mono',
    'DM Mono',
    'Iosevka',
];

export type ThemeId =
    | 'default'
    | 'glass'
    | 'nord'
    | 'dracula'
    | 'solarized'
    | 'catppuccin'
    | 'rose-pine'
    | 'gruvbox';

export const THEMES: { id: ThemeId; label: string; description: string }[] = [
    { id: 'default', label: 'Default', description: 'The original Typwriter palette.' },
    { id: 'glass', label: 'Glass', description: 'Default palette, frosted translucent surfaces.' },
    { id: 'nord', label: 'Nord', description: 'Calm, arctic blues.' },
    { id: 'dracula', label: 'Dracula', description: 'Vivid purples on near-black.' },
    { id: 'solarized', label: 'Solarized', description: 'Eye-friendly warm beiges.' },
    { id: 'catppuccin', label: 'Catppuccin', description: 'Soft pastel mocha.' },
    { id: 'rose-pine', label: 'Rosé Pine', description: 'Muted dusty rose.' },
    { id: 'gruvbox', label: 'Gruvbox', description: 'Retro warm earth tones.' },
];

interface PersistedSettings {
    uiFontFamily: string;
    editorFontFamily: string;
    editorFontSize: number;
    lightTheme: ThemeId;
    darkTheme: ThemeId;

    // Updates
    autoCheckUpdates: boolean;

    // Preview defaults
    defaultPreviewZoom: number;
    defaultPreviewVisible: boolean;

    // Editor behaviors
    showLineNumbers: boolean;
    showIndentationMarkers: boolean;
    spellcheck: boolean;
    tabWidth: number;
    wordWrap: boolean;

    // Auto-save
    autoSaveEnabled: boolean;
    autoSaveDelayMs: number;
    formatBeforeSave: boolean;

    // Auto-snapshot (version control)
    autoSnapshotOnSave: boolean;
    autoSnapshotOnCompile: boolean;
    autoSnapshotMinIntervalSeconds: number;
    /** Cap on the number of *auto* (Save/Compile) snapshots retained.
     *  `0` = unlimited. Manual/Initial/PreRestore are always preserved. */
    snapshotRetentionMaxCount: number;
    /** Maximum age, in days, for *auto* snapshots. `0` = unlimited. */
    snapshotRetentionMaxDays: number;
}

const DEFAULTS: PersistedSettings = {
    uiFontFamily: 'IBM Plex Sans Variable',
    editorFontFamily: 'JetBrains Mono Variable',
    editorFontSize: 13,
    lightTheme: 'default',
    darkTheme: 'default',

    autoCheckUpdates: true,

    defaultPreviewZoom: 2.0,
    defaultPreviewVisible: true,

    showLineNumbers: false,
    showIndentationMarkers: true,
    spellcheck: true,
    tabWidth: 2,
    wordWrap: true,

    autoSaveEnabled: true,
    autoSaveDelayMs: 1500,
    formatBeforeSave: false,

    autoSnapshotOnSave: true,
    autoSnapshotOnCompile: true,
    autoSnapshotMinIntervalSeconds: 0,
    snapshotRetentionMaxCount: 0,
    snapshotRetentionMaxDays: 0,
};

const THEME_IDS = new Set<ThemeId>(THEMES.map((theme) => theme.id));

function isThemeId(value: unknown): value is ThemeId {
    return typeof value === 'string' && THEME_IDS.has(value as ThemeId);
}

function normalizeSettings(value: Partial<PersistedSettings>): PersistedSettings {
    const settings = { ...DEFAULTS, ...value };
    return {
        ...settings,
        lightTheme: isThemeId(settings.lightTheme) ? settings.lightTheme : DEFAULTS.lightTheme,
        darkTheme: isThemeId(settings.darkTheme) ? settings.darkTheme : DEFAULTS.darkTheme,
    };
}

function loadFromLocalStorage(): { settings: PersistedSettings; hasSettings: boolean } {
    if (typeof globalThis.localStorage === 'undefined') {
        return { settings: { ...DEFAULTS }, hasSettings: false };
    }
    try {
        const raw = globalThis.localStorage.getItem(LS_KEY);
        if (!raw) return { settings: { ...DEFAULTS }, hasSettings: false };
        const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
        return { settings: normalizeSettings(parsed), hasSettings: true };
    } catch {
        return { settings: { ...DEFAULTS }, hasSettings: false };
    }
}

// Hydrate at module load so the very first $effect run in the root layout sees
// the persisted values, not DEFAULTS. Otherwise the app paints with the default
// theme/font on every reload before onMount swaps them in.
const INITIAL_LOCAL = loadFromLocalStorage();
const INITIAL = INITIAL_LOCAL.settings;

class SettingsStore {
    uiFontFamily = $state(INITIAL.uiFontFamily);
    editorFontFamily = $state(INITIAL.editorFontFamily);
    editorFontSize = $state(INITIAL.editorFontSize);
    lightTheme = $state<ThemeId>(INITIAL.lightTheme);
    darkTheme = $state<ThemeId>(INITIAL.darkTheme);

    autoCheckUpdates = $state(INITIAL.autoCheckUpdates);

    defaultPreviewZoom = $state(INITIAL.defaultPreviewZoom);
    defaultPreviewVisible = $state(INITIAL.defaultPreviewVisible);

    showLineNumbers = $state(INITIAL.showLineNumbers);
    showIndentationMarkers = $state(INITIAL.showIndentationMarkers);
    spellcheck = $state(INITIAL.spellcheck);
    tabWidth = $state(INITIAL.tabWidth);
    wordWrap = $state(INITIAL.wordWrap);

    autoSaveEnabled = $state(INITIAL.autoSaveEnabled);
    autoSaveDelayMs = $state(INITIAL.autoSaveDelayMs);
    formatBeforeSave = $state(INITIAL.formatBeforeSave);

    autoSnapshotOnSave = $state(INITIAL.autoSnapshotOnSave);
    autoSnapshotOnCompile = $state(INITIAL.autoSnapshotOnCompile);
    autoSnapshotMinIntervalSeconds = $state(INITIAL.autoSnapshotMinIntervalSeconds);
    snapshotRetentionMaxCount = $state(INITIAL.snapshotRetentionMaxCount);
    snapshotRetentionMaxDays = $state(INITIAL.snapshotRetentionMaxDays);

    fontDirectories = $state<string[]>([]);
    fontsReloading = $state(false);

    /** Fetch Rust-side settings (font directories). UI-only prefs are already
     *  hydrated from localStorage at module load. */
    init(): ResultAsync<void, string> {
        return getAppSettings()
            .map((s) => {
                this.fontDirectories = s.font_directories;
                const rustSettings: PersistedSettings = {
                    uiFontFamily: s.ui_font_family,
                    editorFontFamily: s.editor_font_family,
                    editorFontSize: s.editor_font_size,
                    lightTheme: isThemeId(s.light_theme) ? s.light_theme : DEFAULTS.lightTheme,
                    darkTheme: isThemeId(s.dark_theme) ? s.dark_theme : DEFAULTS.darkTheme,
                    autoCheckUpdates: s.auto_check_updates,
                    defaultPreviewZoom: s.default_preview_zoom,
                    defaultPreviewVisible: s.default_preview_visible,
                    showLineNumbers: s.show_line_numbers,
                    showIndentationMarkers: s.show_indentation_markers,
                    spellcheck: s.spellcheck,
                    tabWidth: s.tab_width,
                    wordWrap: s.word_wrap,
                    autoSaveEnabled: s.auto_save_enabled,
                    autoSaveDelayMs: s.auto_save_delay_ms,
                    formatBeforeSave: s.format_before_save,
                    autoSnapshotOnSave: s.auto_snapshot_on_save,
                    autoSnapshotOnCompile: s.auto_snapshot_on_compile,
                    autoSnapshotMinIntervalSeconds: s.auto_snapshot_min_interval_seconds,
                    snapshotRetentionMaxCount: s.snapshot_retention_max_count,
                    snapshotRetentionMaxDays: s.snapshot_retention_max_days,
                };
                const nextSettings = INITIAL_LOCAL.hasSettings
                    ? { ...rustSettings, ...INITIAL }
                    : rustSettings;
                this.applyPersistedSettings(nextSettings);
                this.persist();
            })
            .mapErr((err) => {
                logError('settings.init getAppSettings failed:', err);
                return err;
            });
    }

    private currentSettings(): PersistedSettings {
        return {
            uiFontFamily: this.uiFontFamily,
            editorFontFamily: this.editorFontFamily,
            editorFontSize: this.editorFontSize,
            lightTheme: this.lightTheme,
            darkTheme: this.darkTheme,
            autoCheckUpdates: this.autoCheckUpdates,
            defaultPreviewZoom: this.defaultPreviewZoom,
            defaultPreviewVisible: this.defaultPreviewVisible,
            showLineNumbers: this.showLineNumbers,
            showIndentationMarkers: this.showIndentationMarkers,
            spellcheck: this.spellcheck,
            tabWidth: this.tabWidth,
            wordWrap: this.wordWrap,
            autoSaveEnabled: this.autoSaveEnabled,
            autoSaveDelayMs: this.autoSaveDelayMs,
            formatBeforeSave: this.formatBeforeSave,
            autoSnapshotOnSave: this.autoSnapshotOnSave,
            autoSnapshotOnCompile: this.autoSnapshotOnCompile,
            autoSnapshotMinIntervalSeconds: this.autoSnapshotMinIntervalSeconds,
            snapshotRetentionMaxCount: this.snapshotRetentionMaxCount,
            snapshotRetentionMaxDays: this.snapshotRetentionMaxDays,
        };
    }

    private applyPersistedSettings(next: Partial<PersistedSettings>): void {
        const settings = { ...DEFAULTS, ...next };
        this.uiFontFamily = settings.uiFontFamily;
        this.editorFontFamily = settings.editorFontFamily;
        this.editorFontSize = Math.max(8, Math.min(32, Math.round(settings.editorFontSize)));
        this.lightTheme = isThemeId(settings.lightTheme) ? settings.lightTheme : DEFAULTS.lightTheme;
        this.darkTheme = isThemeId(settings.darkTheme) ? settings.darkTheme : DEFAULTS.darkTheme;
        this.autoCheckUpdates = settings.autoCheckUpdates;
        this.defaultPreviewZoom = Math.max(0.25, Math.min(8, settings.defaultPreviewZoom));
        this.defaultPreviewVisible = settings.defaultPreviewVisible;
        this.showLineNumbers = settings.showLineNumbers;
        this.showIndentationMarkers = settings.showIndentationMarkers;
        this.spellcheck = settings.spellcheck;
        this.tabWidth = Math.max(1, Math.min(8, Math.round(settings.tabWidth)));
        this.wordWrap = settings.wordWrap;
        this.autoSaveEnabled = settings.autoSaveEnabled;
        this.autoSaveDelayMs = Math.max(250, Math.min(60_000, Math.round(settings.autoSaveDelayMs)));
        this.formatBeforeSave = settings.formatBeforeSave;
        this.autoSnapshotOnSave = settings.autoSnapshotOnSave;
        this.autoSnapshotOnCompile = settings.autoSnapshotOnCompile;
        this.autoSnapshotMinIntervalSeconds = Math.max(
            0,
            Math.min(3600, Math.round(settings.autoSnapshotMinIntervalSeconds)),
        );
        this.snapshotRetentionMaxCount = Math.max(
            0,
            Math.min(10_000, Math.round(settings.snapshotRetentionMaxCount)),
        );
        this.snapshotRetentionMaxDays = Math.max(
            0,
            Math.min(3650, Math.round(settings.snapshotRetentionMaxDays)),
        );
    }

    private persistLocal(): void {
        if (typeof globalThis.localStorage === 'undefined') return;
        try {
            globalThis.localStorage.setItem(LS_KEY, JSON.stringify(this.currentSettings()));
        } catch (err) {
            logError('settings.persistLocal failed:', err);
        }
    }

    private persist(): void {
        this.persistLocal();
        const current = this.currentSettings();
        setAppSettings({
            font_directories: this.fontDirectories,
            ui_font_family: current.uiFontFamily,
            editor_font_family: current.editorFontFamily,
            editor_font_size: current.editorFontSize,
            light_theme: current.lightTheme,
            dark_theme: current.darkTheme,
            auto_check_updates: current.autoCheckUpdates,
            default_preview_zoom: current.defaultPreviewZoom,
            default_preview_visible: current.defaultPreviewVisible,
            show_line_numbers: current.showLineNumbers,
            show_indentation_markers: current.showIndentationMarkers,
            spellcheck: current.spellcheck,
            tab_width: current.tabWidth,
            word_wrap: current.wordWrap,
            auto_save_enabled: current.autoSaveEnabled,
            auto_save_delay_ms: current.autoSaveDelayMs,
            format_before_save: current.formatBeforeSave,
            auto_snapshot_on_save: current.autoSnapshotOnSave,
            auto_snapshot_on_compile: current.autoSnapshotOnCompile,
            auto_snapshot_min_interval_seconds: current.autoSnapshotMinIntervalSeconds,
            snapshot_retention_max_count: current.snapshotRetentionMaxCount,
            snapshot_retention_max_days: current.snapshotRetentionMaxDays,
        }).mapErr((err) => {
            logError('settings.persist setAppSettings failed:', err);
            return err;
        });
    }

    setUiFontFamily(family: string) {
        this.uiFontFamily = family;
        this.persist();
    }

    setEditorFontFamily(family: string) {
        this.editorFontFamily = family;
        this.persist();
    }

    setEditorFontSize(size: number) {
        this.editorFontSize = Math.max(8, Math.min(32, Math.round(size)));
        this.persist();
    }

    setLightTheme(theme: ThemeId) {
        this.lightTheme = theme;
        this.persist();
    }

    setDarkTheme(theme: ThemeId) {
        this.darkTheme = theme;
        this.persist();
    }

    setAutoCheckUpdates(value: boolean) {
        this.autoCheckUpdates = value;
        this.persist();
    }

    setDefaultPreviewZoom(zoom: number) {
        this.defaultPreviewZoom = Math.max(0.25, Math.min(8, zoom));
        this.persist();
    }

    setDefaultPreviewVisible(value: boolean) {
        this.defaultPreviewVisible = value;
        this.persist();
    }

    setShowLineNumbers(value: boolean) {
        this.showLineNumbers = value;
        this.persist();
    }

    setShowIndentationMarkers(value: boolean) {
        this.showIndentationMarkers = value;
        this.persist();
    }

    setSpellcheck(value: boolean) {
        this.spellcheck = value;
        this.persist();
    }

    setTabWidth(value: number) {
        this.tabWidth = Math.max(1, Math.min(8, Math.round(value)));
        this.persist();
    }

    setWordWrap(value: boolean) {
        this.wordWrap = value;
        this.persist();
    }

    setAutoSaveEnabled(value: boolean) {
        this.autoSaveEnabled = value;
        this.persist();
    }

    setAutoSaveDelayMs(value: number) {
        this.autoSaveDelayMs = Math.max(250, Math.min(60_000, Math.round(value)));
        this.persist();
    }

    setFormatBeforeSave(value: boolean) {
        this.formatBeforeSave = value;
        this.persist();
    }

    setAutoSnapshotOnSave(value: boolean) {
        this.autoSnapshotOnSave = value;
        this.persist();
    }

    setAutoSnapshotOnCompile(value: boolean) {
        this.autoSnapshotOnCompile = value;
        this.persist();
    }

    setAutoSnapshotMinIntervalSeconds(value: number) {
        this.autoSnapshotMinIntervalSeconds = Math.max(0, Math.min(3600, Math.round(value)));
        this.persist();
    }

    setSnapshotRetentionMaxCount(value: number) {
        this.snapshotRetentionMaxCount = Math.max(0, Math.min(10_000, Math.round(value)));
        this.persist();
    }

    setSnapshotRetentionMaxDays(value: number) {
        this.snapshotRetentionMaxDays = Math.max(0, Math.min(3650, Math.round(value)));
        this.persist();
    }

    resetToDefaults() {
        this.uiFontFamily = DEFAULTS.uiFontFamily;
        this.editorFontFamily = DEFAULTS.editorFontFamily;
        this.editorFontSize = DEFAULTS.editorFontSize;
        this.lightTheme = DEFAULTS.lightTheme;
        this.darkTheme = DEFAULTS.darkTheme;
        this.autoCheckUpdates = DEFAULTS.autoCheckUpdates;
        this.defaultPreviewZoom = DEFAULTS.defaultPreviewZoom;
        this.defaultPreviewVisible = DEFAULTS.defaultPreviewVisible;
        this.showLineNumbers = DEFAULTS.showLineNumbers;
        this.showIndentationMarkers = DEFAULTS.showIndentationMarkers;
        this.spellcheck = DEFAULTS.spellcheck;
        this.tabWidth = DEFAULTS.tabWidth;
        this.wordWrap = DEFAULTS.wordWrap;
        this.autoSaveEnabled = DEFAULTS.autoSaveEnabled;
        this.autoSaveDelayMs = DEFAULTS.autoSaveDelayMs;
        this.formatBeforeSave = DEFAULTS.formatBeforeSave;
        this.autoSnapshotOnSave = DEFAULTS.autoSnapshotOnSave;
        this.autoSnapshotOnCompile = DEFAULTS.autoSnapshotOnCompile;
        this.autoSnapshotMinIntervalSeconds = DEFAULTS.autoSnapshotMinIntervalSeconds;
        this.snapshotRetentionMaxCount = DEFAULTS.snapshotRetentionMaxCount;
        this.snapshotRetentionMaxDays = DEFAULTS.snapshotRetentionMaxDays;
        this.persist();
    }

    addFontDirectory(dir: string): ResultAsync<void, string> {
        if (this.fontDirectories.includes(dir)) return okAsync(undefined);
        const next = [...this.fontDirectories, dir];
        return this.applyFontDirectories(next);
    }

    removeFontDirectory(dir: string): ResultAsync<void, string> {
        const next = this.fontDirectories.filter((d) => d !== dir);
        return this.applyFontDirectories(next);
    }

    private applyFontDirectories(next: string[]): ResultAsync<void, string> {
        const previous = this.fontDirectories;
        this.fontDirectories = next;
        this.persist();
        this.fontsReloading = true;
        return setTypstFontDirectories(next)
            .mapErr((err) => {
                this.fontDirectories = previous;
                this.fontsReloading = false;
                logError('settings.applyFontDirectories failed:', err);
                return err;
            });
        // `fontsReloading` is cleared by the `app:fonts-loaded` listener (set
        // up in the page that owns this UI), since the Rust reload happens on
        // a background thread.
    }

    /** Called by the app:fonts-loaded listener to flip the reloading flag once
     *  Typst has rescanned its font directories. The picker uses the bundled
     *  list, so we don't need to refresh anything else. */
    onFontsReloaded(): void {
        this.fontsReloading = false;
    }
}

export const settings = new SettingsStore();
