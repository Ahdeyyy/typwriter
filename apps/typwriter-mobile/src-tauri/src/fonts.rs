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

use log::{error, info};
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
    let embedded = store.book().families().count();

    for dir in dirs {
        store.extend(kit_fonts::scan(dir));
    }
    for buffer in buffers {
        let bytes = typst::foundations::Bytes::new(buffer.clone());
        let mut faces = 0;
        for font in typst::text::Font::iter(bytes) {
            let info = font.info().clone();
            store.push((font, info));
            faces += 1;
        }
        if faces == 0 {
            // A file that looked like a font but typst couldn't parse — most
            // often a partial download or a format typst doesn't read.
            log::warn!(
                "fonts: a {}-byte font buffer yielded no faces",
                buffer.len()
            );
        }
    }

    // Families, not faces: this is the number the user recognises from the
    // font picker, and the one worth having in a bug report.
    let total = store.book().families().count();
    info!(
        "fonts: {total} families ({embedded} embedded, {} scanned dirs, {} extra buffers)",
        dirs.len(),
        buffers.len()
    );
    store
}

/// Load the user's extra fonts on a background thread and install the result
/// into the world. Called from the setup hook and after every pick/clear so
/// font changes apply without an app restart. A corrupt font file or a hung
/// SAF read must never take the app down: panics fall back to embedded-only.
pub fn load_in_background(app: AppHandle, world: Arc<MobileWorld>) {
    // Marked before the thread starts, so a `get_fonts_status` issued straight
    // after a pick can't catch the gap and report the pre-load count as final.
    world.begin_font_load();
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
        world.end_font_load();
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

/// What the settings sheet shows for the app-wide fonts folder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontsStatus {
    /// Display name of the chosen folder, or `None` when none is set.
    pub folder: Option<String>,
    /// Font families the compiler can use right now — embedded plus whatever
    /// the folder contributed. A folder that is set while this stays at the
    /// embedded baseline is the visible symptom of fonts failing to load.
    pub family_count: usize,
    /// Whether a background load is still running. `family_count` only means
    /// "that's all there was" once this is `false`; reported earlier it is just
    /// the pre-load figure, which reads as a folder that yielded nothing.
    pub loading: bool,
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

/// The font directories and raw font buffers to load at startup. Directories go
/// through `typst_kit::fonts::scan` (std::fs); buffers are font files read out
/// of a SAF tree on Android, parsed straight into the font book.
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
            let p = PathBuf::from(&path);
            if !p.is_dir() {
                error!("fonts: configured folder is not readable: {path}");
            } else if !dirs.contains(&p) {
                dirs.push(p);
            }
        }
        // A picker can hand back a plain `file://` URI (some providers do, and
        // so does a desktop-picked folder that was later opened on Android).
        // Those are reachable with `std::fs`, so scan them like any directory
        // instead of paying for a SAF read per file.
        Some(FontsSource::Saf { uri, name }) => match uri.to_path().filter(|p| p.is_dir()) {
            Some(p) if !dirs.contains(&p) => dirs.push(p),
            Some(_) => {}
            None => {
                collect_saf_fonts(app, &uri, &mut buffers);
                if buffers.is_empty() {
                    error!(
                        "fonts: no font files found under the chosen folder {name:?} ({}) — \
                         the permission may have been revoked, or it holds no .ttf/.otf files",
                        uri.uri
                    );
                }
            }
        },
        None => info!("fonts: no fonts folder chosen"),
    }

    info!(
        "fonts: {} dir(s) to scan, {} file(s) read over SAF",
        dirs.len(),
        buffers.len()
    );
    (dirs, buffers)
}

/// File extensions `typst::text::Font::iter` can parse: TrueType, OpenType, and
/// their collections.
const FONT_EXTENSIONS: [&str; 4] = [".ttf", ".otf", ".ttc", ".otc"];

/// MIME types that carry one of [`FONT_EXTENSIONS`]' formats.
///
/// Deliberately an allowlist rather than "contains `font`": `font/woff`,
/// `font/woff2` and `application/vnd.ms-fontobject` are font MIME types that
/// typst yields no faces for, and matching them means reading the whole file
/// over SAF only to throw it away.
const FONT_MIME_TYPES: [&str; 9] = [
    "font/ttf",
    "font/otf",
    "font/sfnt",
    "font/collection",
    "application/font-sfnt",
    "application/x-font-ttf",
    "application/x-font-otf",
    "application/x-font-truetype",
    "application/x-font-opentype",
];

/// Whether a directory entry looks like a font typst can read.
///
/// Either signal is enough. The display name is the usual one, but SAF providers
/// hand back names with the extension stripped — and a family name can carry
/// dots of its own ("Noto.Sans.Regular"), so "has a dot" says nothing about what
/// the file is. A provider that reports one of the exact types above has told us
/// more than the name can, so it wins on its own.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn is_font_entry(name: Option<&str>, mime_type: Option<&str>) -> bool {
    let by_name = name.is_some_and(|name| {
        let lower = name.to_ascii_lowercase();
        FONT_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
    });
    by_name
        || mime_type.is_some_and(|m| {
            // Providers may append parameters: `font/ttf; charset=binary`.
            let base = m.split(';').next().unwrap_or(m).trim().to_ascii_lowercase();
            FONT_MIME_TYPES.contains(&base.as_str())
        })
}

/// Recursively read font files out of a SAF content-tree into `out`.
///
/// Enumeration is deliberately lenient: `AndroidFs::read_dir` insists that every
/// entry report a size and a modification time, and a single provider that
/// leaves one null (the SAF contract allows it) makes the whole listing fail —
/// which reads exactly like "my fonts aren't loading". We ask only for the two
/// fields we actually use, and skip entries individually.
#[cfg(target_os = "android")]
fn collect_saf_fonts(app: &AppHandle, root: &FileUri, out: &mut Vec<Vec<u8>>) {
    use tauri_plugin_android_fs::{AndroidFsExt, EntryOptions, OptionalEntry};

    /// Directories to walk before giving up (a picked tree should be small;
    /// this only guards against someone choosing their whole SD card).
    const MAX_DIRS: u32 = 64;

    let api = app.android_fs();
    let options = EntryOptions {
        uri: true,
        name: true,
        mime_type: true,
        last_modified: false,
        len: false,
    };
    let mut stack = vec![root.clone()];
    let mut visited = 0u32;
    while let Some(dir) = stack.pop() {
        visited += 1;
        if visited > MAX_DIRS {
            log::warn!("fonts: stopped after {MAX_DIRS} folders; pick a smaller fonts folder");
            break;
        }
        let entries = match api.read_dir_with_options(&dir, options) {
            Ok(entries) => entries,
            Err(e) => {
                log::warn!("fonts: read_dir failed for {}: {e}", dir.uri);
                continue;
            }
        };
        log::debug!("fonts: {} entries under {}", entries.len(), dir.uri);
        for entry in entries {
            match entry {
                OptionalEntry::Dir { uri, .. } => {
                    if let Some(uri) = uri {
                        stack.push(uri);
                    }
                }
                OptionalEntry::File {
                    uri,
                    name,
                    mime_type,
                    ..
                } => {
                    if !is_font_entry(name.as_deref(), mime_type.as_deref()) {
                        continue;
                    }
                    let Some(uri) = uri else { continue };
                    let label = name.unwrap_or_else(|| uri.uri.clone());
                    match api.read(&uri) {
                        Ok(bytes) => {
                            info!("fonts: read \"{label}\" ({} bytes)", bytes.len());
                            out.push(bytes);
                        }
                        Err(e) => log::warn!("fonts: read \"{label}\" failed: {e}"),
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

#[cfg(test)]
mod tests {
    use super::is_font_entry;

    #[test]
    fn accepts_font_extensions_regardless_of_case_or_mime() {
        assert!(is_font_entry(Some("Inter-Regular.ttf"), None));
        assert!(is_font_entry(
            Some("Inter-Regular.OTF"),
            Some("application/octet-stream")
        ));
        assert!(is_font_entry(Some("Fonts.ttc"), None));
    }

    #[test]
    fn rejects_other_file_types() {
        assert!(!is_font_entry(Some("readme.txt"), None));
        assert!(!is_font_entry(Some("cover.png"), Some("image/png")));
        assert!(!is_font_entry(Some("licence.txt"), Some("text/plain")));
    }

    #[test]
    fn rejects_font_formats_typst_cannot_parse() {
        // Font MIME types all — and all useless to us. Matching them would mean
        // reading the whole file over SAF only to get no faces out of it.
        assert!(!is_font_entry(Some("Inter"), Some("font/woff")));
        assert!(!is_font_entry(Some("Inter"), Some("font/woff2")));
        assert!(!is_font_entry(
            Some("Inter"),
            Some("application/vnd.ms-fontobject")
        ));
        assert!(!is_font_entry(Some("Inter-Regular.woff2"), None));
    }

    #[test]
    fn falls_back_to_mime_when_the_name_carries_no_usable_extension() {
        // Some SAF providers hand back a display name with the extension
        // stripped; the MIME type is the only signal left.
        assert!(is_font_entry(Some("Inter Regular"), Some("font/ttf")));
        assert!(is_font_entry(
            Some("Inter Regular"),
            Some("application/x-font-ttf")
        ));
        // Parameters after the type must not defeat the match.
        assert!(is_font_entry(
            Some("Inter Regular"),
            Some("font/ttf; charset=binary")
        ));
        // A family name can carry dots without any of them being an extension.
        assert!(is_font_entry(Some("Noto.Sans.Regular"), Some("font/ttf")));
        assert!(!is_font_entry(Some("Inter Regular"), Some("text/plain")));
        assert!(!is_font_entry(Some("Inter Regular"), None));
        assert!(!is_font_entry(None, None));
    }
}
