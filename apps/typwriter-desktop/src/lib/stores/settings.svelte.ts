// User preferences.
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
import { emitSettingsChanged } from '$lib/ipc/events';
import { commandById, normalizeKeybindings } from '$lib/keybindings/registry';
import { logError } from '$lib/logger';

const LS_KEY = 'typwriter:settings:v1';

// Fonts bundled via @fontsource(-variable) in `layout.css`. These are the
// families the WebView can resolve reliably, since they're registered with the
// browser engine rather than only discovered on disk by Typst.
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

export interface PersistedSettings {
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
    /** Display to project onto in presentation mode, as an OS display id
     *  (`\\.\DISPLAY2`). `null` means auto: whichever display the main editor
     *  window isn't on — the right answer for a laptop + HDMI-extend rig. */
    presentationDisplay: string | null;

    // Editor behaviors
    showLineNumbers: boolean;
    showIndentationMarkers: boolean;
    spellcheck: boolean;
    tabWidth: number;
    wordWrap: boolean;
    focusMode: boolean;
    typewriterScrolling: boolean;

    /** Use the tinymist language server (when installed) for completion, hover,
     *  and diagnostics. UI-only — not round-tripped through the Rust settings. */
    useLsp: boolean;

    // Auto-save
    autoSaveEnabled: boolean;
    autoSaveDelayMs: number;
    formatBeforeSave: boolean;

    // Formatter (typstyle). Mirrors typstyle's own Config; the Rust side keeps
    // a live copy of these so a change here applies to the next format in the
    // editor without a restart.
    formatTabSpaces: number;
    formatMaxWidth: number;
    formatBlankLinesUpperBound: number;
    formatCollapseMarkupSpaces: boolean;
    formatReorderImportItems: boolean;
    formatWrapText: boolean;

    // Auto-snapshot (version control)
    autoSnapshotOnSave: boolean;
    autoSnapshotOnCompile: boolean;
    autoSnapshotMinIntervalSeconds: number;
    /** Cap on the number of *auto* (Save/Compile) snapshots retained.
     *  `0` = unlimited. Manual/Initial/PreRestore are always preserved. */
    snapshotRetentionMaxCount: number;
    /** Maximum age, in days, for *auto* snapshots. `0` = unlimited. */
    snapshotRetentionMaxDays: number;

    /** Keyboard shortcut overrides, keyed by command id (see
     *  `$lib/keybindings/registry`). Only commands the user actually changed
     *  appear here — everything else resolves to the shipped default, so
     *  revising a default later still reaches users who never touched it. */
    keybindings: Record<string, string[]>;
}

/** Payload broadcast to every window when settings change anywhere. The
 *  settings page runs in its own webview window, so each window's store
 *  instance stays in sync by replaying this. */
export type SettingsSyncPayload = PersistedSettings & { fontDirectories: string[] };

const DEFAULTS: PersistedSettings = {
    uiFontFamily: 'IBM Plex Sans Variable',
    editorFontFamily: 'JetBrains Mono Variable',
    editorFontSize: 13,
    lightTheme: 'default',
    darkTheme: 'default',

    autoCheckUpdates: true,

    defaultPreviewZoom: 2.0,
    defaultPreviewVisible: true,
    presentationDisplay: null,

    showLineNumbers: false,
    showIndentationMarkers: true,
    spellcheck: true,
    tabWidth: 2,
    wordWrap: true,
    focusMode: false,
    typewriterScrolling: false,
    useLsp: true,

    autoSaveEnabled: true,
    autoSaveDelayMs: 1500,
    formatBeforeSave: false,

    // typstyle's own defaults.
    formatTabSpaces: 2,
    formatMaxWidth: 80,
    formatBlankLinesUpperBound: 1,
    formatCollapseMarkupSpaces: false,
    formatReorderImportItems: true,
    formatWrapText: false,

    autoSnapshotOnSave: true,
    autoSnapshotOnCompile: true,
    autoSnapshotMinIntervalSeconds: 0,
    snapshotRetentionMaxCount: 0,
    snapshotRetentionMaxDays: 0,

    keybindings: {},
};

/** Ranges for the numeric formatter options. `commands::format::
 *  formatter_config_from_settings` clamps to the same bounds — keep them in
 *  step, and drive the settings sliders from here. */
export const FORMAT_LIMITS = {
    tabSpaces: { min: 1, max: 8 },
    maxWidth: { min: 20, max: 240 },
    blankLines: { min: 0, max: 8 },
} as const;

function clampInt(value: number, { min, max }: { min: number; max: number }): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}

/** Bounds for the numeric settings that are clamped in two places — once when
 *  loading persisted values, once in the setter. Naming each one keeps the two
 *  call sites from drifting apart. */
const clampEditorFontSize = (v: number) => Math.max(8, Math.min(32, Math.round(v)));
const clampPreviewZoom = (v: number) => Math.max(0.25, Math.min(8, v));
const clampTabWidth = (v: number) => Math.max(1, Math.min(8, Math.round(v)));
const clampAutoSaveDelayMs = (v: number) => Math.max(250, Math.min(60_000, Math.round(v)));
const clampSnapshotIntervalSeconds = (v: number) => Math.max(0, Math.min(3600, Math.round(v)));
const clampSnapshotRetentionCount = (v: number) => Math.max(0, Math.min(10_000, Math.round(v)));
const clampSnapshotRetentionDays = (v: number) => Math.max(0, Math.min(3650, Math.round(v)));

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
        keybindings: normalizeKeybindings(settings.keybindings),
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
    presentationDisplay = $state(INITIAL.presentationDisplay);

    showLineNumbers = $state(INITIAL.showLineNumbers);
    showIndentationMarkers = $state(INITIAL.showIndentationMarkers);
    spellcheck = $state(INITIAL.spellcheck);
    tabWidth = $state(INITIAL.tabWidth);
    wordWrap = $state(INITIAL.wordWrap);
    focusMode = $state(INITIAL.focusMode);
    typewriterScrolling = $state(INITIAL.typewriterScrolling);
    useLsp = $state(INITIAL.useLsp);

    autoSaveEnabled = $state(INITIAL.autoSaveEnabled);
    autoSaveDelayMs = $state(INITIAL.autoSaveDelayMs);
    formatBeforeSave = $state(INITIAL.formatBeforeSave);

    formatTabSpaces = $state(INITIAL.formatTabSpaces);
    formatMaxWidth = $state(INITIAL.formatMaxWidth);
    formatBlankLinesUpperBound = $state(INITIAL.formatBlankLinesUpperBound);
    formatCollapseMarkupSpaces = $state(INITIAL.formatCollapseMarkupSpaces);
    formatReorderImportItems = $state(INITIAL.formatReorderImportItems);
    formatWrapText = $state(INITIAL.formatWrapText);

    autoSnapshotOnSave = $state(INITIAL.autoSnapshotOnSave);
    autoSnapshotOnCompile = $state(INITIAL.autoSnapshotOnCompile);
    autoSnapshotMinIntervalSeconds = $state(INITIAL.autoSnapshotMinIntervalSeconds);
    snapshotRetentionMaxCount = $state(INITIAL.snapshotRetentionMaxCount);
    snapshotRetentionMaxDays = $state(INITIAL.snapshotRetentionMaxDays);

    keybindings = $state<Record<string, string[]>>(INITIAL.keybindings);

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
                    presentationDisplay: s.presentation_display ?? null,
                    showLineNumbers: s.show_line_numbers,
                    showIndentationMarkers: s.show_indentation_markers,
                    spellcheck: s.spellcheck,
                    tabWidth: s.tab_width,
                    wordWrap: s.word_wrap,
                    focusMode: s.focus_mode,
                    typewriterScrolling: s.typewriter_scrolling,
                    // UI-only: Rust has no say — always reseed from the local value.
                    useLsp: INITIAL.useLsp,
                    autoSaveEnabled: s.auto_save_enabled,
                    autoSaveDelayMs: s.auto_save_delay_ms,
                    formatBeforeSave: s.format_before_save,
                    formatTabSpaces: s.format_tab_spaces,
                    formatMaxWidth: s.format_max_width,
                    formatBlankLinesUpperBound: s.format_blank_lines_upper_bound,
                    formatCollapseMarkupSpaces: s.format_collapse_markup_spaces,
                    formatReorderImportItems: s.format_reorder_import_items,
                    formatWrapText: s.format_wrap_text,
                    autoSnapshotOnSave: s.auto_snapshot_on_save,
                    autoSnapshotOnCompile: s.auto_snapshot_on_compile,
                    autoSnapshotMinIntervalSeconds: s.auto_snapshot_min_interval_seconds,
                    snapshotRetentionMaxCount: s.snapshot_retention_max_count,
                    snapshotRetentionMaxDays: s.snapshot_retention_max_days,
                    keybindings: normalizeKeybindings(s.keybindings),
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
            presentationDisplay: this.presentationDisplay,
            showLineNumbers: this.showLineNumbers,
            showIndentationMarkers: this.showIndentationMarkers,
            spellcheck: this.spellcheck,
            tabWidth: this.tabWidth,
            wordWrap: this.wordWrap,
            focusMode: this.focusMode,
            typewriterScrolling: this.typewriterScrolling,
            useLsp: this.useLsp,
            autoSaveEnabled: this.autoSaveEnabled,
            autoSaveDelayMs: this.autoSaveDelayMs,
            formatBeforeSave: this.formatBeforeSave,
            formatTabSpaces: this.formatTabSpaces,
            formatMaxWidth: this.formatMaxWidth,
            formatBlankLinesUpperBound: this.formatBlankLinesUpperBound,
            formatCollapseMarkupSpaces: this.formatCollapseMarkupSpaces,
            formatReorderImportItems: this.formatReorderImportItems,
            formatWrapText: this.formatWrapText,
            autoSnapshotOnSave: this.autoSnapshotOnSave,
            autoSnapshotOnCompile: this.autoSnapshotOnCompile,
            autoSnapshotMinIntervalSeconds: this.autoSnapshotMinIntervalSeconds,
            snapshotRetentionMaxCount: this.snapshotRetentionMaxCount,
            snapshotRetentionMaxDays: this.snapshotRetentionMaxDays,
            // Snapshot the map: `$state` hands back a proxy, and this object is
            // JSON-stringified, emitted to other windows, and sent to Rust.
            keybindings: $state.snapshot(this.keybindings),
        };
    }

    private applyPersistedSettings(next: Partial<PersistedSettings>): void {
        const settings = { ...DEFAULTS, ...next };
        this.uiFontFamily = settings.uiFontFamily;
        this.editorFontFamily = settings.editorFontFamily;
        this.editorFontSize = clampEditorFontSize(settings.editorFontSize);
        this.lightTheme = isThemeId(settings.lightTheme) ? settings.lightTheme : DEFAULTS.lightTheme;
        this.darkTheme = isThemeId(settings.darkTheme) ? settings.darkTheme : DEFAULTS.darkTheme;
        this.autoCheckUpdates = settings.autoCheckUpdates;
        this.defaultPreviewZoom = clampPreviewZoom(settings.defaultPreviewZoom);
        this.defaultPreviewVisible = settings.defaultPreviewVisible;
        this.presentationDisplay = settings.presentationDisplay;
        this.showLineNumbers = settings.showLineNumbers;
        this.showIndentationMarkers = settings.showIndentationMarkers;
        this.spellcheck = settings.spellcheck;
        this.tabWidth = clampTabWidth(settings.tabWidth);
        this.wordWrap = settings.wordWrap;
        this.focusMode = settings.focusMode;
        this.typewriterScrolling = settings.typewriterScrolling;
        this.useLsp = settings.useLsp;
        this.autoSaveEnabled = settings.autoSaveEnabled;
        this.autoSaveDelayMs = clampAutoSaveDelayMs(settings.autoSaveDelayMs);
        this.formatBeforeSave = settings.formatBeforeSave;
        this.formatTabSpaces = clampInt(settings.formatTabSpaces, FORMAT_LIMITS.tabSpaces);
        this.formatMaxWidth = clampInt(settings.formatMaxWidth, FORMAT_LIMITS.maxWidth);
        this.formatBlankLinesUpperBound = clampInt(
            settings.formatBlankLinesUpperBound,
            FORMAT_LIMITS.blankLines,
        );
        this.formatCollapseMarkupSpaces = settings.formatCollapseMarkupSpaces;
        this.formatReorderImportItems = settings.formatReorderImportItems;
        this.formatWrapText = settings.formatWrapText;
        this.autoSnapshotOnSave = settings.autoSnapshotOnSave;
        this.autoSnapshotOnCompile = settings.autoSnapshotOnCompile;
        this.autoSnapshotMinIntervalSeconds = clampSnapshotIntervalSeconds(
            settings.autoSnapshotMinIntervalSeconds,
        );
        this.snapshotRetentionMaxCount = clampSnapshotRetentionCount(
            settings.snapshotRetentionMaxCount,
        );
        this.snapshotRetentionMaxDays = clampSnapshotRetentionDays(
            settings.snapshotRetentionMaxDays,
        );
        this.keybindings = normalizeKeybindings(settings.keybindings);
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
        // Replay into the other windows (settings window ↔ main ↔ popouts).
        // The emitter also receives this, but re-assigning identical values to
        // $state is a no-op, so there's no feedback churn.
        emitSettingsChanged<SettingsSyncPayload>({
            ...current,
            fontDirectories: [...this.fontDirectories],
        }).mapErr((err) => {
            logError('settings.persist emitSettingsChanged failed:', err);
            return err;
        });
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
            presentation_display: current.presentationDisplay,
            show_line_numbers: current.showLineNumbers,
            show_indentation_markers: current.showIndentationMarkers,
            spellcheck: current.spellcheck,
            tab_width: current.tabWidth,
            word_wrap: current.wordWrap,
            focus_mode: current.focusMode,
            typewriter_scrolling: current.typewriterScrolling,
            auto_save_enabled: current.autoSaveEnabled,
            auto_save_delay_ms: current.autoSaveDelayMs,
            format_before_save: current.formatBeforeSave,
            format_tab_spaces: current.formatTabSpaces,
            format_max_width: current.formatMaxWidth,
            format_blank_lines_upper_bound: current.formatBlankLinesUpperBound,
            format_collapse_markup_spaces: current.formatCollapseMarkupSpaces,
            format_reorder_import_items: current.formatReorderImportItems,
            format_wrap_text: current.formatWrapText,
            auto_snapshot_on_save: current.autoSnapshotOnSave,
            auto_snapshot_on_compile: current.autoSnapshotOnCompile,
            auto_snapshot_min_interval_seconds: current.autoSnapshotMinIntervalSeconds,
            snapshot_retention_max_count: current.snapshotRetentionMaxCount,
            snapshot_retention_max_days: current.snapshotRetentionMaxDays,
            keybindings: current.keybindings,
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
        this.editorFontSize = clampEditorFontSize(size);
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
        this.defaultPreviewZoom = clampPreviewZoom(zoom);
        this.persist();
    }

    setDefaultPreviewVisible(value: boolean) {
        this.defaultPreviewVisible = value;
        this.persist();
    }

    /** Pin the display presentation mode projects onto, or `null` for auto. */
    setPresentationDisplay(id: string | null) {
        this.presentationDisplay = id;
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
        this.tabWidth = clampTabWidth(value);
        this.persist();
    }

    setWordWrap(value: boolean) {
        this.wordWrap = value;
        this.persist();
    }

    setFocusMode(value: boolean) {
        this.focusMode = value;
        this.persist();
    }

    setTypewriterScrolling(value: boolean) {
        this.typewriterScrolling = value;
        this.persist();
    }

    setUseLsp(value: boolean) {
        this.useLsp = value;
        this.persist();
    }

    setAutoSaveEnabled(value: boolean) {
        this.autoSaveEnabled = value;
        this.persist();
    }

    setAutoSaveDelayMs(value: number) {
        this.autoSaveDelayMs = clampAutoSaveDelayMs(value);
        this.persist();
    }

    setFormatBeforeSave(value: boolean) {
        this.formatBeforeSave = value;
        this.persist();
    }

    // Formatter options. Every one of these ends up in `set_app_settings`,
    // which swaps the Rust-side typstyle config in place — the next format in
    // any open window uses the new value.

    setFormatTabSpaces(value: number) {
        this.formatTabSpaces = clampInt(value, FORMAT_LIMITS.tabSpaces);
        this.persist();
    }

    setFormatMaxWidth(value: number) {
        this.formatMaxWidth = clampInt(value, FORMAT_LIMITS.maxWidth);
        this.persist();
    }

    setFormatBlankLinesUpperBound(value: number) {
        this.formatBlankLinesUpperBound = clampInt(value, FORMAT_LIMITS.blankLines);
        this.persist();
    }

    setFormatCollapseMarkupSpaces(value: boolean) {
        this.formatCollapseMarkupSpaces = value;
        this.persist();
    }

    setFormatReorderImportItems(value: boolean) {
        this.formatReorderImportItems = value;
        this.persist();
    }

    setFormatWrapText(value: boolean) {
        this.formatWrapText = value;
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
        this.autoSnapshotMinIntervalSeconds = clampSnapshotIntervalSeconds(value);
        this.persist();
    }

    setSnapshotRetentionMaxCount(value: number) {
        this.snapshotRetentionMaxCount = clampSnapshotRetentionCount(value);
        this.persist();
    }

    setSnapshotRetentionMaxDays(value: number) {
        this.snapshotRetentionMaxDays = clampSnapshotRetentionDays(value);
        this.persist();
    }

    // ── Keyboard shortcuts ───────────────────────────────────────────────
    //
    // Stored as *overrides*: a command bound back to its shipped default drops
    // out of the map. Every mutation goes through `persist()`, so a rebind made
    // in the settings window reaches the editor windows on the next event loop
    // turn — no restart, no re-open.

    /** Rebind a command. An empty list unbinds it outright. */
    setKeybinding(commandId: string, keys: string[]) {
        if (!commandById(commandId)) return;
        // Canonicalizes and de-dupes; yields `undefined` when the result is the
        // command's own default, which is stored as "no override" rather than
        // as a copy of the default.
        const normalized = normalizeKeybindings({ [commandId]: keys })[commandId];
        const next = { ...$state.snapshot(this.keybindings) };
        if (normalized === undefined) delete next[commandId];
        else next[commandId] = normalized;
        this.keybindings = next;
        this.persist();
    }

    /** Restore one command to its shipped keys. */
    resetKeybinding(commandId: string) {
        if (!(commandId in this.keybindings)) return;
        const next = { ...$state.snapshot(this.keybindings) };
        delete next[commandId];
        this.keybindings = next;
        this.persist();
    }

    /** Restore every shortcut to its shipped keys. */
    resetAllKeybindings() {
        if (Object.keys(this.keybindings).length === 0) return;
        this.keybindings = {};
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
        this.focusMode = DEFAULTS.focusMode;
        this.typewriterScrolling = DEFAULTS.typewriterScrolling;
        this.useLsp = DEFAULTS.useLsp;
        this.autoSaveEnabled = DEFAULTS.autoSaveEnabled;
        this.autoSaveDelayMs = DEFAULTS.autoSaveDelayMs;
        this.formatBeforeSave = DEFAULTS.formatBeforeSave;
        this.formatTabSpaces = DEFAULTS.formatTabSpaces;
        this.formatMaxWidth = DEFAULTS.formatMaxWidth;
        this.formatBlankLinesUpperBound = DEFAULTS.formatBlankLinesUpperBound;
        this.formatCollapseMarkupSpaces = DEFAULTS.formatCollapseMarkupSpaces;
        this.formatReorderImportItems = DEFAULTS.formatReorderImportItems;
        this.formatWrapText = DEFAULTS.formatWrapText;
        this.autoSnapshotOnSave = DEFAULTS.autoSnapshotOnSave;
        this.autoSnapshotOnCompile = DEFAULTS.autoSnapshotOnCompile;
        this.autoSnapshotMinIntervalSeconds = DEFAULTS.autoSnapshotMinIntervalSeconds;
        this.snapshotRetentionMaxCount = DEFAULTS.snapshotRetentionMaxCount;
        this.snapshotRetentionMaxDays = DEFAULTS.snapshotRetentionMaxDays;
        this.keybindings = { ...DEFAULTS.keybindings };
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

    /** Apply a settings:changed broadcast from another window. Deliberately
     *  does not call `persist()` — the originating window already persisted
     *  (and re-emitting would ping-pong between windows forever). */
    applyExternal(payload: SettingsSyncPayload): void {
        this.applyPersistedSettings(payload);
        this.fontDirectories = payload.fontDirectories ?? [];
    }
}

export const settings = new SettingsStore();
