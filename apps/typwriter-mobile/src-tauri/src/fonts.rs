// App-wide font source: a user-chosen folder whose fonts are loaded into the
// compiler. On Android a plain filesystem path is not reachable (scoped
// storage), so a folder picked via the SAF directory picker is stored as a
// persisted content-tree URI and its fonts are read through
// `tauri-plugin-android-fs`. On desktop (the dev loop) a normal path is used.
//
// The chosen source is persisted to `<app_data>/fonts_source.json`. Fonts are
// loaded on a background thread — at startup (`load_in_background` from the
// setup hook) and again right after the user picks/clears a folder — and
// swapped into the world via `MobileWorld::install_fonts`. Nothing here may
// run on the main thread: SAF reads are blocking plugin calls.

use std::{path::PathBuf, sync::Arc};

use log::error;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_android_fs::FileUri;
use typst_kit::fonts::{self as kit_fonts, FontStore};

use crate::world::MobileWorld;

/// A `FontStore` holding only the embedded fonts — the synchronous fallback
/// installed at construction, before the background load finishes.
pub fn embedded_store() -> FontStore {
    let mut store = FontStore::new();
    store.extend(kit_fonts::embedded());
    store
}

/// Build the full font set: embedded fonts, fonts scanned from regular
/// directories, and fonts parsed out of raw buffers (read from a SAF tree).
pub fn build_font_store(dirs: &[PathBuf], buffers: &[Vec<u8>]) -> FontStore {
    let mut store = FontStore::new();
    store.extend(kit_fonts::embedded());
    for dir in dirs {
        store.extend(kit_fonts::scan(dir));
    }
    for buffer in buffers {
        let bytes = typst::foundations::Bytes::new(buffer.clone());
        for font in typst::text::Font::iter(bytes) {
            let info = font.info().clone();
            store.push((font, info));
        }
    }
    store
}

/// Load the user's extra fonts on a background thread and install the result
/// into the world. Called from the setup hook and after every pick/clear so
/// font changes apply without an app restart. A corrupt font file or a hung
/// SAF read must never take the app down: panics fall back to embedded-only.
pub fn load_in_background(app: AppHandle, world: Arc<MobileWorld>) {
    std::thread::spawn(move || {
        let store = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let (dirs, buffers) = load_extra_fonts(&app);
            build_font_store(&dirs, &buffers)
        }))
        .unwrap_or_else(|_| {
            error!("fonts: background load panicked; falling back to embedded fonts");
            embedded_store()
        });
        world.install_fonts(store);
    });
}

/// Where the app-wide fonts come from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FontsSource {
    /// A regular filesystem directory (desktop dev loop, or a path that
    /// `std::fs` can reach).
    Path { path: String },
    /// A SAF content-tree URI picked on Android, with a display name.
    Saf { uri: FileUri, name: String },
}

impl FontsSource {
    /// A short human-readable label for the settings UI.
    pub fn display_name(&self) -> String {
        match self {
            FontsSource::Path { path } => PathBuf::from(path)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| path.clone()),
            FontsSource::Saf { name, .. } => name.clone(),
        }
    }
}

fn source_file(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    Ok(app_data.join("fonts_source.json"))
}

/// Display name of the persisted fonts source, if any — the settings UI reads
/// this on open so the backend stays the single source of truth.
pub fn source_display_name(app: &AppHandle) -> Option<String> {
    read_source(app).map(|s| s.display_name())
}

/// Read the persisted fonts source, if any.
pub fn read_source(app: &AppHandle) -> Option<FontsSource> {
    let file = source_file(app).ok()?;
    let data = std::fs::read_to_string(file).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_source(app: &AppHandle, source: &FontsSource) -> Result<(), String> {
    let file = source_file(app)?;
    let data = serde_json::to_string(source).map_err(|e| e.to_string())?;
    std::fs::write(file, data).map_err(|e| e.to_string())
}

/// Clear the persisted fonts source, releasing any SAF permission.
pub fn clear_source(app: &AppHandle) -> Result<(), String> {
    if let Some(FontsSource::Saf { uri, .. }) = read_source(app) {
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_android_fs::AndroidFsExt;
            let _ = app
                .android_fs()
                .file_picker()
                .release_persisted_uri_permission(&uri);
        }
        let _ = &uri; // only used on android
    }
    if let Ok(file) = source_file(app) {
        let _ = std::fs::remove_file(file);
    }
    Ok(())
}

/// Open the platform directory picker, persist the chosen folder as the fonts
/// source, and return its display name. Returns `None` if the user cancels.
pub fn pick(app: &AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        let api = app.android_fs();
        let Some(uri) = api
            .file_picker()
            .pick_dir(None, false)
            .map_err(|e| e.to_string())?
        else {
            return Ok(None);
        };
        // Persist so the folder is still readable after a restart.
        api.file_picker()
            .persist_uri_permission(&uri)
            .map_err(|e| e.to_string())?;
        let name = api
            .get_name(&uri)
            .unwrap_or_else(|_| "Selected folder".to_string());
        let source = FontsSource::Saf {
            uri,
            name: name.clone(),
        };
        write_source(app, &source)?;
        Ok(Some(name))
    }

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        let source = FontsSource::Path {
            path: path.to_string_lossy().into_owned(),
        };
        let name = source.display_name();
        write_source(app, &source)?;
        Ok(Some(name))
    }
}

/// The font directories and raw font buffers to load at startup. Directories are
/// fed to `FontSearcher` (std::fs); buffers are font files read out of a SAF
/// tree on Android, registered directly into the font book.
pub fn load_extra_fonts(app: &AppHandle) -> (Vec<PathBuf>, Vec<Vec<u8>>) {
    let mut dirs = Vec::new();
    let mut buffers = Vec::new();

    // The conventional folder is always reachable via std::fs.
    if let Ok(docs) = app.path().document_dir() {
        let conventional = docs.join("Typwriter").join("Fonts");
        if conventional.is_dir() {
            dirs.push(conventional);
        }
    }

    match read_source(app) {
        Some(FontsSource::Path { path }) => {
            let p = PathBuf::from(path);
            if p.is_dir() && !dirs.contains(&p) {
                dirs.push(p);
            }
        }
        Some(FontsSource::Saf { uri, .. }) => collect_saf_fonts(app, &uri, &mut buffers),
        None => {}
    }

    (dirs, buffers)
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn is_font_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".ttf", ".otf", ".ttc", ".otc"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

/// Recursively read font files out of a SAF content-tree into `out`.
#[cfg(target_os = "android")]
fn collect_saf_fonts(app: &AppHandle, root: &FileUri, out: &mut Vec<Vec<u8>>) {
    use tauri_plugin_android_fs::{AndroidFsExt, Entry};

    let api = app.android_fs();
    let mut stack = vec![root.clone()];
    let mut visited = 0u32;
    while let Some(dir) = stack.pop() {
        visited += 1;
        if visited > 64 {
            log::warn!("fonts: SAF tree too deep/large, stopping enumeration");
            break;
        }
        let entries = match api.read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) => {
                log::warn!("fonts: read_dir failed: {e}");
                continue;
            }
        };
        for entry in entries {
            match entry {
                Entry::Dir { uri, .. } => stack.push(uri),
                Entry::File { uri, name, .. } => {
                    if is_font_file(&name) {
                        match api.read(&uri) {
                            Ok(bytes) => out.push(bytes),
                            Err(e) => log::warn!("fonts: read \"{name}\" failed: {e}"),
                        }
                    }
                }
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
fn collect_saf_fonts(_app: &AppHandle, _root: &FileUri, _out: &mut Vec<Vec<u8>>) {
    // SAF is Android-only; on desktop the picker always yields a `Path`.
}
