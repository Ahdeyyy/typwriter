// commands/settings.rs
//
// App settings persisted via tauri-plugin-store.

use std::{path::PathBuf, sync::Arc, time::Instant};

use log::{error, info, warn};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use tauri::Manager;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;

use crate::vcs::SnapshotPolicy;
use crate::world::EditorWorld;

/// On Android, user-picked font directories live behind SAF and aren't
/// scannable by `std::fs` (no MANAGE_EXTERNAL_STORAGE in the manifest). To
/// keep the FontSearcher pipeline unchanged, we copy the chosen folder's
/// font files into app-private external storage at this subdirectory and
/// point typst-kit's scan at that copy.
#[cfg(target_os = "android")]
const ANDROID_FONTS_SUBDIR: &str = "Fonts";

const STORE_FILE: &str = "app_data.json";
const KEY_FONT_DIRECTORIES: &str = "settings.font_directories";
const KEY_UI_SETTINGS: &str = "settings.ui";
/// Whether the onboarding tutorial has been shown (completed OR skipped).
/// Stored under its own key — deliberately *not* part of `AppSettings` — so the
/// Settings page round-tripping the whole struct through `set_app_settings`
/// can't accidentally reset it via serde defaults.
const KEY_ONBOARDING_COMPLETED: &str = "settings.onboarding_completed";

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
    pub show_line_numbers: bool,
    pub show_indentation_markers: bool,
    pub spellcheck: bool,
    pub tab_width: u8,
    pub word_wrap: bool,

    // Auto-save
    pub auto_save_enabled: bool,
    pub auto_save_delay_ms: u32,
    pub format_before_save: bool,

    // Auto-snapshot (version control)
    pub auto_snapshot_on_save: bool,
    pub auto_snapshot_on_compile: bool,
    pub auto_snapshot_min_interval_seconds: u32,
    /// Cap on the number of *auto* (Save/Compile) snapshots retained. `0` =
    /// unlimited. Manual / Initial / PreRestore are always preserved.
    pub snapshot_retention_max_count: u32,
    /// Maximum age, in days, for *auto* snapshots. `0` = unlimited.
    pub snapshot_retention_max_days: u32,
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

            auto_save_enabled: true,
            auto_save_delay_ms: 1500,
            format_before_save: false,

            auto_snapshot_on_save: true,
            auto_snapshot_on_compile: true,
            auto_snapshot_min_interval_seconds: 0,
            snapshot_retention_max_count: 0,
            snapshot_retention_max_days: 0,
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

#[tauri::command]
pub fn set_app_settings(handle: AppHandle, settings: AppSettings) {
    write_settings(&handle, &settings);
    if let Some(policy) = handle.try_state::<Arc<RwLock<SnapshotPolicy>>>() {
        *policy.write() = SnapshotPolicy::from_settings(&settings);
    }
}

/// Build the in-memory snapshot policy from the persisted settings.
/// Called both at startup and when the user mutates settings from the UI.
pub fn snapshot_policy_from_handle(handle: &AppHandle) -> SnapshotPolicy {
    SnapshotPolicy::from_settings(&read_settings(handle))
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

    // On Android, fonts the user added on mobile are copies stored under
    // `<documents>/Typwriter/Fonts/<name>`. Anything that just dropped out of
    // `clean` is now orphaned, so reclaim the disk space.
    #[cfg(target_os = "android")]
    {
        let previous = read_settings(&handle).font_directories;
        let fonts_root = handle
            .path()
            .document_dir()
            .ok()
            .map(|d| d.join("Typwriter").join(ANDROID_FONTS_SUBDIR));
        if let Some(root) = fonts_root {
            for dir in previous {
                if clean.contains(&dir) {
                    continue;
                }
                let path = PathBuf::from(&dir);
                if path.starts_with(&root) && path.exists() {
                    if let Err(err) = std::fs::remove_dir_all(&path) {
                        warn!("set_typst_font_directories: cleanup {dir:?} failed: {err}");
                    }
                }
            }
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

// ─── Android font import ────────────────────────────────────────────────────
//
// `typst-kit`'s `FontSearcher` walks directories with `std::fs::read_dir`,
// which fails for SAF-granted paths under `/storage/emulated/0/...` without
// `MANAGE_EXTERNAL_STORAGE`. We copy the user-picked folder's font files into
// app-private storage on import and then hand THAT path to `set_typst_font_
// directories` from the frontend, so the existing reload pipeline scans a
// directory it can actually read.

#[cfg(target_os = "android")]
#[tauri::command]
pub fn import_font_directory_uri(
    dir_uri: tauri_plugin_android_fs::FileUri,
    app: AppHandle,
) -> Result<String, String> {
    use tauri_plugin_android_fs::AndroidFsExt;

    let t = Instant::now();
    info!("import_font_directory_uri: uri={:?}", dir_uri.uri);

    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Documents dir unavailable: {e}"))?;
    let fonts_root = docs.join("Typwriter").join(ANDROID_FONTS_SUBDIR);
    std::fs::create_dir_all(&fonts_root).map_err(|e| format!("Failed to create fonts dir: {e}"))?;

    let label = derive_label_from_uri(&dir_uri.uri);
    let safe = sanitize_dir_name(&label);
    let mut dest = fonts_root.join(&safe);
    let mut suffix: u32 = 1;
    while dest.exists() {
        dest = fonts_root.join(format!("{safe}-{suffix}"));
        suffix += 1;
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("Failed to create import dir: {e}"))?;

    let api = app.android_fs();
    let mut count: u32 = 0;
    if let Err(err) = copy_fonts_from_uri(&api, &dir_uri, &dest, &mut count) {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(err);
    }
    if count == 0 {
        let _ = std::fs::remove_dir_all(&dest);
        return Err("No font files (.ttf, .otf, .ttc) found in the selected folder.".to_string());
    }

    info!(
        "import_font_directory_uri: copied {count} font(s) to {:?} ({:.1}ms)",
        dest,
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(dest.to_string_lossy().into_owned())
}

/// Stub for non-Android targets so the command list compiles uniformly. The
/// frontend only invokes this on mobile, but Tauri's macro expansion still
/// references it on every target.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn import_font_directory_uri(_dir_uri: serde_json::Value) -> Result<String, String> {
    Err("import_font_directory_uri is only available on Android".to_string())
}

#[cfg(target_os = "android")]
fn copy_fonts_from_uri<R: tauri::Runtime>(
    api: &tauri_plugin_android_fs::api::api_sync::AndroidFs<R>,
    src_uri: &tauri_plugin_android_fs::FileUri,
    dest: &std::path::Path,
    count: &mut u32,
) -> Result<(), String> {
    use tauri_plugin_android_fs::Entry;

    let entries = api
        .read_dir(src_uri)
        .map_err(|e| format!("Failed to list folder: {e}"))?;

    for entry in entries {
        match entry {
            Entry::File { uri, name, .. } => {
                if !is_font_file(&name) {
                    continue;
                }
                let bytes = match api.read(&uri) {
                    Ok(b) => b,
                    Err(e) => {
                        warn!("import_font_directory_uri: read({name}) failed: {e}");
                        continue;
                    }
                };
                let safe_name = sanitize_dir_name(&name);
                let dest_path = dest.join(&safe_name);
                if let Err(e) = std::fs::write(&dest_path, &bytes) {
                    warn!("import_font_directory_uri: write({safe_name}) failed: {e}");
                    continue;
                }
                *count += 1;
            }
            Entry::Dir { uri, name, .. } => {
                let safe_name = sanitize_dir_name(&name);
                let sub_dest = dest.join(&safe_name);
                if let Err(e) = std::fs::create_dir_all(&sub_dest) {
                    warn!("import_font_directory_uri: mkdir({safe_name}) failed: {e}");
                    continue;
                }
                copy_fonts_from_uri(api, &uri, &sub_dest, count)?;
                // Drop empty subdirectories so the imported tree only contains
                // directories that actually hold fonts.
                if let Ok(mut it) = std::fs::read_dir(&sub_dest) {
                    if it.next().is_none() {
                        let _ = std::fs::remove_dir(&sub_dest);
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn is_font_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".ttf")
        || lower.ends_with(".otf")
        || lower.ends_with(".ttc")
        || lower.ends_with(".otc")
}

#[cfg(target_os = "android")]
fn sanitize_dir_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.' | ' ' | '(' | ')') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let trimmed = out.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "fonts".to_string()
    } else {
        trimmed
    }
}

#[cfg(target_os = "android")]
fn derive_label_from_uri(uri: &str) -> String {
    // SAF URIs look like:
    //   content://com.android.externalstorage.documents/tree/primary%3AFonts
    // or                    .../tree/primary%3AFonts/document/primary%3AFonts/MyFonts
    //
    // We want the deepest segment after the final `:` (Android encodes the
    // volume separator that way) — that's the human-readable folder name.
    let raw_tail = uri.rsplit('/').next().unwrap_or(uri);
    let decoded = decode_percent(raw_tail);
    let tail = decoded.rsplit(':').next().unwrap_or(decoded.as_str());
    let trimmed = tail.trim_matches('/').trim();
    if trimmed.is_empty() {
        "Fonts".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(target_os = "android")]
fn decode_percent(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
