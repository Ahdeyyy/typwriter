// commands/settings.rs
//
// App settings persisted via tauri-plugin-store.

use std::{path::PathBuf, sync::Arc, time::Instant};

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;

use crate::world::EditorWorld;

const STORE_FILE: &str = "app_data.json";
const KEY_FONT_DIRECTORIES: &str = "settings.font_directories";
const KEY_UI_SETTINGS: &str = "settings.ui";

#[derive(Serialize, Deserialize, Clone, Debug)]
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
    pub show_line_numbers: bool,
    pub show_indentation_markers: bool,
    pub spellcheck: bool,
    pub tab_width: u8,
    pub word_wrap: bool,
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
            show_line_numbers: false,
            show_indentation_markers: true,
            spellcheck: true,
            tab_width: 2,
            word_wrap: true,
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

/// Load font directories from disk on startup.
pub fn load_font_directories(handle: &AppHandle) -> Vec<PathBuf> {
    read_settings(handle)
        .font_directories
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_app_settings(handle: AppHandle) -> AppSettings {
    read_settings(&handle)
}

#[tauri::command]
pub fn set_app_settings(handle: AppHandle, settings: AppSettings) {
    write_settings(&handle, &settings);
}

#[tauri::command]
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

#[tauri::command]
pub fn list_font_families(world: State<'_, Arc<EditorWorld>>) -> Vec<String> {
    world.font_families()
}
