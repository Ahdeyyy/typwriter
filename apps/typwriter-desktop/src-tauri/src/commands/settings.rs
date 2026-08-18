// App settings persisted via tauri-plugin-store.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, OnceLock},
    time::Instant,
};

use log::{error, info, warn};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use typst::text::FontFlags;
use typstyle_core::Config as TypstyleConfig;

use crate::commands::format::{formatter_config_from_settings, FormatterConfig};
use crate::grammar::engine::GrammarConfig;
use crate::vcs::SnapshotPolicy;
use crate::world::EditorWorld;

const STORE_FILE: &str = "app_data.json";
const KEY_FONT_DIRECTORIES: &str = "settings.font_directories";
const KEY_UI_SETTINGS: &str = "settings.ui";
/// Whether the onboarding tutorial has been shown (completed OR skipped).
/// Stored under its own key — deliberately *not* part of `AppSettings` — so the
/// Settings page round-tripping the whole struct through `set_app_settings`
/// can't accidentally reset it via serde defaults.
const KEY_ONBOARDING_COMPLETED: &str = "settings.onboarding_completed";
/// Grammar-checker configuration. Kept out of `AppSettings` for the same
/// reason as the key above — it's a nested structure with rule maps and word
/// lists, and `set_app_settings` round-trips the whole struct.
const KEY_GRAMMAR: &str = "settings.grammar";
/// Named export configurations. Kept out of `AppSettings` for the same reason
/// as the keys above, and one more specific to these: presets are edited from
/// the export dialog in the *main* window, while the settings window
/// round-trips the whole `AppSettings` struct. Sharing that struct would let a
/// settings save clobber a preset saved moments earlier in the other window.
const KEY_EXPORT_PRESETS: &str = "settings.export_presets";
/// App-wide snippets — the ones that follow the user across every project.
/// Project snippets live in the workspace's own `.typwriter/snippets.json`
/// instead, so they travel with the document. Same reasoning as the key above
/// for staying out of `AppSettings`: these are edited from the settings window
/// *and* replaceable from the editor, so they need an independent write path.
const KEY_SNIPPETS: &str = "settings.snippets";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct AppSettings {
    pub font_directories: Vec<String>,
    pub ui_font_family: String,
    pub editor_font_family: String,
    pub editor_font_size: u8,
    pub light_theme: String,
    pub dark_theme: String,
    pub auto_check_updates: bool,
    pub default_preview_zoom: f64,
    pub default_preview_visible: bool,
    /// Display to project onto in presentation mode, as an OS display id
    /// (`\\.\DISPLAY2`). `None` means auto — pick whichever display the main
    /// editor window isn't on. A pinned display that is no longer connected
    /// falls back to auto rather than retargeting a different screen.
    pub presentation_display: Option<String>,
    pub show_line_numbers: bool,
    pub show_indentation_markers: bool,
    pub spellcheck: bool,
    pub tab_width: u8,
    pub word_wrap: bool,
    /// Dim every paragraph except the one the caret is in.
    pub focus_mode: bool,
    /// Keep the caret line vertically centred as the user types.
    pub typewriter_scrolling: bool,

    // Auto-save
    pub auto_save_enabled: bool,
    pub auto_save_delay_ms: u32,
    pub format_before_save: bool,

    // Formatter (typstyle). Mirrors `typstyle_core::Config` one-for-one;
    // `commands::format::formatter_config_from_settings` does the projection
    // and clamps each value.
    /// Spaces per indentation level in formatted output.
    pub format_tab_spaces: u8,
    /// Column the formatter tries to keep lines within.
    pub format_max_width: u32,
    /// Consecutive blank lines the formatter preserves; extras are collapsed.
    pub format_blank_lines_upper_bound: u8,
    /// Collapse runs of whitespace in markup down to a single space.
    pub format_collapse_markup_spaces: bool,
    /// Sort the items of an import list alphabetically.
    pub format_reorder_import_items: bool,
    /// Reflow prose to fit `format_max_width` (implies collapsing spaces).
    pub format_wrap_text: bool,

    // Auto-snapshot (version control)
    pub auto_snapshot_on_save: bool,
    pub auto_snapshot_on_compile: bool,
    pub auto_snapshot_min_interval_seconds: u32,
    /// Cap on the number of *auto* (Save/Compile) snapshots retained. `0` =
    /// unlimited. Manual / Initial / PreRestore are always preserved.
    pub snapshot_retention_max_count: u32,
    /// Maximum age, in days, for *auto* snapshots. `0` = unlimited.
    pub snapshot_retention_max_days: u32,

    /// Keyboard shortcut overrides, keyed by frontend command id (e.g.
    /// `editor.save` → `["Mod-s"]`). Rust only persists them; the command
    /// catalog and the chord notation live in the frontend
    /// (`src/lib/keybindings/`). Only commands the user actually rebound are
    /// present, so revising a default still reaches everyone who left it alone.
    pub keybindings: HashMap<String, Vec<String>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            font_directories: Vec::new(),
            ui_font_family: "IBM Plex Sans Variable".to_string(),
            editor_font_family: "monospace".to_string(),
            editor_font_size: 13,
            light_theme: "default".to_string(),
            dark_theme: "default".to_string(),
            auto_check_updates: true,
            default_preview_zoom: 2.0,
            default_preview_visible: true,
            presentation_display: None,
            show_line_numbers: false,
            show_indentation_markers: true,
            spellcheck: true,
            tab_width: 2,
            word_wrap: true,
            focus_mode: false,
            typewriter_scrolling: false,

            auto_save_enabled: true,
            auto_save_delay_ms: 1500,
            format_before_save: false,

            // typstyle's own defaults, so a fresh install formats exactly the
            // way the `typstyle` CLI would.
            format_tab_spaces: 2,
            format_max_width: 80,
            format_blank_lines_upper_bound: 1,
            format_collapse_markup_spaces: false,
            format_reorder_import_items: true,
            format_wrap_text: false,

            auto_snapshot_on_save: true,
            auto_snapshot_on_compile: true,
            auto_snapshot_min_interval_seconds: 0,
            snapshot_retention_max_count: 0,
            snapshot_retention_max_days: 0,

            keybindings: HashMap::new(),
        }
    }
}

fn read_settings(handle: &AppHandle) -> AppSettings {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return AppSettings::default();
    };

    let font_directories: Vec<String> = store
        .get(KEY_FONT_DIRECTORIES)
        .and_then(|v: JsonValue| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let mut settings: AppSettings = store
        .get(KEY_UI_SETTINGS)
        .and_then(|v: JsonValue| serde_json::from_value(v).ok())
        .unwrap_or_default();

    settings.font_directories = font_directories;
    settings
}

fn write_settings(handle: &AppHandle, settings: &AppSettings) {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return;
    };
    store.set(KEY_FONT_DIRECTORIES, json!(settings.font_directories));
    store.set(KEY_UI_SETTINGS, json!(settings));
    if let Err(err) = store.save() {
        warn!("settings: failed to save store: {err}");
    }
}

fn write_font_directories(handle: &AppHandle, dirs: &[String]) {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return;
    };
    store.set(KEY_FONT_DIRECTORIES, json!(dirs));
    if let Err(err) = store.save() {
        warn!("settings: failed to save store: {err}");
    }
}

/// Read the persisted grammar configuration, falling back to defaults.
pub fn read_grammar_config(handle: &AppHandle) -> GrammarConfig {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return GrammarConfig::default();
    };
    store
        .get(KEY_GRAMMAR)
        .and_then(|v: JsonValue| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Persist the grammar configuration.
pub fn write_grammar_config(handle: &AppHandle, config: &GrammarConfig) {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return;
    };
    store.set(KEY_GRAMMAR, json!(config));
    if let Err(err) = store.save() {
        warn!("settings: failed to save grammar config: {err}");
    }
}

/// Read the persisted export presets.
///
/// Stored and returned as opaque JSON: the shape belongs to the frontend
/// (`src/lib/export-presets.ts`), which validates and repairs it on load. Rust
/// giving these a struct would mean two definitions to keep in step for data it
/// never inspects.
#[tauri::command(async)]
pub fn get_export_presets(handle: AppHandle) -> JsonValue {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return json!([]);
    };
    store.get(KEY_EXPORT_PRESETS).unwrap_or_else(|| json!([]))
}

#[tauri::command(async)]
pub fn set_export_presets(handle: AppHandle, presets: JsonValue) -> Result<(), String> {
    let store = handle
        .store(STORE_FILE)
        .map_err(|err| format!("could not open {STORE_FILE}: {err}"))?;
    store.set(KEY_EXPORT_PRESETS, presets);
    store
        .save()
        .map_err(|err| format!("failed to save export presets: {err}"))?;
    info!("settings: export presets saved");
    Ok(())
}

/// Read the app-wide snippets. Opaque JSON, validated by the frontend
/// (`src/lib/snippets.ts`) — see [`get_export_presets`] for the reasoning.
#[tauri::command(async)]
pub fn get_user_snippets(handle: AppHandle) -> JsonValue {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return json!([]);
    };
    store.get(KEY_SNIPPETS).unwrap_or_else(|| json!([]))
}

#[tauri::command(async)]
pub fn set_user_snippets(handle: AppHandle, snippets: JsonValue) -> Result<(), String> {
    let store = handle
        .store(STORE_FILE)
        .map_err(|err| format!("could not open {STORE_FILE}: {err}"))?;
    store.set(KEY_SNIPPETS, snippets);
    store
        .save()
        .map_err(|err| format!("failed to save snippets: {err}"))?;
    info!("settings: app-wide snippets saved");
    Ok(())
}

/// Load font directories from disk on startup.
pub fn load_font_directories(handle: &AppHandle) -> Vec<PathBuf> {
    read_settings(handle)
        .font_directories
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn get_app_settings(handle: AppHandle) -> AppSettings {
    read_settings(&handle)
}

#[tauri::command]
pub fn get_onboarding_completed(handle: AppHandle) -> bool {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return false;
    };
    store
        .get(KEY_ONBOARDING_COMPLETED)
        .and_then(|v: JsonValue| serde_json::from_value(v).ok())
        .unwrap_or(false)
}

#[tauri::command]
pub fn set_onboarding_completed(handle: AppHandle, completed: bool) {
    let Ok(store) = handle.store(STORE_FILE) else {
        warn!("settings: could not open {STORE_FILE}");
        return;
    };
    store.set(KEY_ONBOARDING_COMPLETED, json!(completed));
    if let Err(err) = store.save() {
        warn!("settings: failed to save store: {err}");
    }
}

#[tauri::command(async)]
pub fn set_app_settings(handle: AppHandle, settings: AppSettings) {
    write_settings(&handle, &settings);
    if let Some(policy) = handle.try_state::<Arc<RwLock<SnapshotPolicy>>>() {
        *policy.write() = SnapshotPolicy::from_settings(&settings);
    }
    // Refresh the formatter config in place so the next format — in *any*
    // window — uses what the user just picked, with no restart.
    if let Some(config) = handle.try_state::<FormatterConfig>() {
        *config.write() = formatter_config_from_settings(&settings);
    }
}

/// Build the in-memory snapshot policy from the persisted settings.
/// Called both at startup and when the user mutates settings from the UI.
pub fn snapshot_policy_from_handle(handle: &AppHandle) -> SnapshotPolicy {
    SnapshotPolicy::from_settings(&read_settings(handle))
}

/// Build the typstyle config from the persisted settings. Seeds the managed
/// [`FormatterConfig`] at startup; `set_app_settings` refreshes it thereafter.
pub fn formatter_config_from_handle(handle: &AppHandle) -> TypstyleConfig {
    formatter_config_from_settings(&read_settings(handle))
}

#[tauri::command(async)]
pub fn set_typst_font_directories(
    handle: AppHandle,
    world: State<'_, Arc<EditorWorld>>,
    dirs: Vec<String>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("set_typst_font_directories: {} dirs", dirs.len());

    // De-dupe and drop empty / non-existent entries; the user can re-add a
    // path that comes back later, but storing rubbish bloats the index for no
    // gain.
    let mut clean: Vec<String> = Vec::new();
    for dir in dirs {
        let trimmed = dir.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if !clean.contains(&trimmed) {
            clean.push(trimmed);
        }
    }

    write_font_directories(&handle, &clean);

    let world = world.inner().clone();
    let handle_clone = handle.clone();
    std::thread::spawn(move || {
        let dirs: Vec<PathBuf> = clean.into_iter().map(PathBuf::from).collect();
        world.reload_fonts_with(dirs);
        if let Err(err) = handle_clone.emit("app:fonts-loaded", ()) {
            error!("set_typst_font_directories: emit failed: {err}");
        }
        info!(
            "set_typst_font_directories: reload done ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
    });

    Ok(())
}

#[tauri::command(async)]
pub fn list_font_families(world: State<'_, Arc<EditorWorld>>) -> Vec<String> {
    world.font_families()
}

// ─── System fonts (UI / editor font pickers) ────────────────────────────────

/// A font family installed on this machine.
///
/// These are the families the WebView can resolve by name, so the settings
/// pickers can offer them alongside the bundled ones. `monospace` mirrors the
/// font's own flag and lets the editor picker put real code fonts up front.
#[derive(Serialize, Clone, Debug)]
pub struct SystemFontFamily {
    pub name: String,
    pub monospace: bool,
}

/// Scanning the OS font directories takes long enough to notice, and the
/// installed set doesn't change while the app runs, so do it once.
static SYSTEM_FONT_FAMILIES: OnceLock<Vec<SystemFontFamily>> = OnceLock::new();

fn scan_system_font_families() -> Vec<SystemFontFamily> {
    let t = Instant::now();

    // A corrupt font file can panic the fontdb scan. The picker is cosmetic —
    // fall back to "no system fonts" rather than taking the app down.
    let scanned = std::panic::catch_unwind(|| {
        // A family counts as monospace when any of its faces is: the flag
        // lives on the face, and italic/bold cuts sometimes omit it.
        let mut families: HashMap<String, bool> = HashMap::new();
        for (_, info) in typst_kit::fonts::system() {
            if info.family.trim().is_empty() {
                continue;
            }
            let monospace = info.flags.contains(FontFlags::MONOSPACE);
            families
                .entry(info.family)
                .and_modify(|m| *m |= monospace)
                .or_insert(monospace);
        }
        families
    });

    let Ok(families) = scanned else {
        error!("scan_system_font_families: system font scan panicked");
        return Vec::new();
    };

    let mut out: Vec<SystemFontFamily> = families
        .into_iter()
        .map(|(name, monospace)| SystemFontFamily { name, monospace })
        .collect();
    out.sort_unstable_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    info!(
        "scan_system_font_families: {} families ({:.1}ms)",
        out.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    out
}

/// Font families installed on the device, for the UI / editor font pickers.
///
/// Deliberately separate from [`list_font_families`], which reports everything
/// Typst compiles with (embedded fonts and user font directories included).
/// Those aren't registered with the WebView, so offering them here would let
/// the user pick a font the interface can't actually render.
#[tauri::command]
pub async fn list_system_font_families() -> Vec<SystemFontFamily> {
    if let Some(cached) = SYSTEM_FONT_FAMILIES.get() {
        return cached.clone();
    }
    let scanned = tauri::async_runtime::spawn_blocking(scan_system_font_families)
        .await
        .unwrap_or_else(|err| {
            error!("list_system_font_families: scan task failed: {err}");
            Vec::new()
        });
    SYSTEM_FONT_FAMILIES.get_or_init(|| scanned).clone()
}
