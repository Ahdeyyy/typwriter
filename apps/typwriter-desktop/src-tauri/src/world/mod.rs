// world/mod.rs

mod progress;
pub use progress::TauriProgress;

use chrono::Datelike;
use ecow::EcoString;
use log::info;
use parking_lot::{Mutex, RwLock};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Instant,
};
use tauri::AppHandle;
use typst::{
    diag::{FileError, FileResult},
    foundations::{Bytes, Datetime},
    syntax::package::PackageSpec,
    syntax::{FileId, Source, VirtualPath},
    text::{Font, FontBook},
    utils::LazyHash,
    Features, Library, LibraryExt, World,
};
use typst_ide::IdeWorld;
use typst_kit::{
    download::Downloader,
    package::{default_package_cache_path, default_package_path, PackageStorage},
};

/// Bundled font data, set once via `OnceLock` when background loading completes.
struct FontData {
    fonts: Vec<Font>,
    book: LazyHash<FontBook>,
}

pub struct EditorWorld {
    /// Workspace root on disk — updatable when the user opens a new folder.
    root: RwLock<PathBuf>,

    /// The file currently set as "main" by the user
    main: RwLock<FileId>,

    /// Typst standard library — built lazily on first compile, not at startup
    library: OnceLock<LazyHash<Library>>,

    /// Fonts + book, set once background font loading completes
    font_data: OnceLock<FontData>,

    /// Empty fallback for `World::book()` before fonts arrive
    empty_book: LazyHash<FontBook>,

    /// In-memory source cache: files the editor has open / has read
    /// Key: FileId, Value: the Source (typst's parsed form)
    source_cache: Mutex<HashMap<FileId, Source>>,

    /// Raw binary file cache (images, data files, etc.)
    file_cache: Mutex<HashMap<FileId, Bytes>>,

    /// Shadow map: editor buffer overrides for unsaved edits
    /// When present, this takes priority over reading from disk
    shadow: RwLock<HashMap<FileId, String>>,

    /// Tauri app handle — used to emit download progress events
    app_handle: AppHandle,

    /// Package storage: resolves packages from disk cache and downloads
    /// missing packages from the Typst registry
    package_storage: PackageStorage,

    /// A separate downloader instance used for fetching the package index
    /// (PackageStorage owns its downloader and does not expose it)
    downloader: Downloader,

    /// Lazily cached list of all available packages from the Typst registry.
    /// Populated on the first call to `IdeWorld::packages()`.
    package_index: OnceLock<Vec<(PackageSpec, Option<EcoString>)>>,
}

impl EditorWorld {
    fn placeholder_main() -> FileId {
        FileId::new(None, VirtualPath::new("main.typ"))
    }

    pub fn new(root: PathBuf, app_handle: AppHandle) -> Self {
        let user_agent = "typwriter-app/0.2.1".to_string();
        let downloader = Downloader::new(user_agent.clone());
        let package_storage = PackageStorage::new(
            default_package_cache_path(),
            default_package_path(),
            Downloader::new(user_agent),
        );
        Self {
            root: RwLock::new(root),
            main: RwLock::new(Self::placeholder_main()),
            library: OnceLock::new(),
            font_data: OnceLock::new(),
            empty_book: LazyHash::new(FontBook::from_fonts(&[])),
            source_cache: Mutex::new(HashMap::new()),
            file_cache: Mutex::new(HashMap::new()),
            shadow: RwLock::new(HashMap::new()),
            app_handle,
            package_storage,
            downloader,
            package_index: OnceLock::new(),
        }
    }

    /// Load fonts from a background thread after startup.
    pub fn load_fonts(&self, fonts: Vec<Font>) {
        let book = FontBook::from_fonts(&fonts);
        let _ = self.font_data.set(FontData {
            fonts,
            book: LazyHash::new(book),
        });
    }

    /// Called by Tauri command when user sets main file
    pub fn set_main(&self, id: FileId) {
        *self.main.write() = id;
    }

    pub fn clear_main(&self) {
        *self.main.write() = Self::placeholder_main();
    }

    /// The workspace root path.
    pub fn root(&self) -> PathBuf {
        self.root.read().clone()
    }

    /// The current main `FileId`.
    pub fn main_id(&self) -> FileId {
        *self.main.read()
    }

    /// Update the workspace root and flush all file caches.
    pub fn set_root(&self, path: PathBuf) {
        *self.root.write() = path;
        *self.main.write() = Self::placeholder_main();
        self.source_cache.lock().clear();
        self.file_cache.lock().clear();
        self.shadow.write().clear();
    }

    /// Convert an absolute path on disk to a local `FileId`.
    /// Returns `None` if the path is not inside the workspace root.
    pub fn path_to_id(&self, path: &Path) -> Option<FileId> {
        let root = self.root.read();
        let rel = path.strip_prefix(&*root).ok()?;
        Some(FileId::new(None, VirtualPath::new(rel)))
    }

    /// Check whether a file has an active shadow (unsaved editor buffer).
    pub fn has_shadow(&self, id: FileId) -> bool {
        self.shadow.read().contains_key(&id)
    }

    /// Called on every keystroke from the editor
    /// Invalidates the source cache for this file so next compile re-reads it
    pub fn shadow_write(&self, id: FileId, content: String) {
        self.shadow.write().insert(id, content);
        // Invalidate source cache for this file only
        self.source_cache.lock().remove(&id);
    }

    /// Called after file is saved or when switching away
    pub fn shadow_remove(&self, id: FileId) {
        self.shadow.write().remove(&id);
        self.source_cache.lock().remove(&id);
    }

    /// Full cache reset – call this after file system events for non-open files
    pub fn invalidate_file(&self, id: FileId) {
        self.source_cache.lock().remove(&id);
        self.file_cache.lock().remove(&id);
    }

    /// Map a FileId back to an absolute path on disk.
    ///
    /// For local files, joins the root with the virtual path.
    /// For package files, uses `PackageStorage::prepare_package` which
    /// downloads the package if not already cached, reporting progress via
    /// Tauri events.
    fn id_to_path(&self, id: FileId) -> Result<PathBuf, FileError> {
        let vpath = id.vpath();
        if let Some(spec) = id.package() {
            let label = format!("{spec}");
            let mut progress = TauriProgress::new(self.app_handle.clone(), label);
            let pkg_dir = self
                .package_storage
                .prepare_package(spec, &mut progress)
                .map_err(FileError::Package)?;
            Ok(pkg_dir.join(vpath.as_rootless_path()))
        } else {
            Ok(self.root.read().join(vpath.as_rootless_path()))
        }
    }
}

impl World for EditorWorld {
    fn library(&self) -> &LazyHash<Library> {
        self.library.get_or_init(|| {
            LazyHash::new(
                Library::builder()
                    .with_features(Features::default())
                    .build(),
            )
        })
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.font_data
            .get()
            .map(|d| &d.book)
            .unwrap_or(&self.empty_book)
    }

    fn main(&self) -> FileId {
        *self.main.read()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        // 1. Check source cache first
        if let Some(src) = self.source_cache.lock().get(&id) {
            return Ok(src.clone());
        }

        // 2. Check shadow (in-memory editor buffer)
        let text = if let Some(content) = self.shadow.read().get(&id) {
            content.clone()
        } else {
            // 3. Fall back to disk (may trigger a package download)
            let path = self.id_to_path(id)?;
            std::fs::read_to_string(&path).map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    FileError::NotFound(path.clone())
                } else {
                    FileError::AccessDenied
                }
            })?
        };

        let source = Source::new(id, text);
        self.source_cache.lock().insert(id, source.clone());
        Ok(source)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(bytes) = self.file_cache.lock().get(&id) {
            return Ok(bytes.clone());
        }
        let path = self.id_to_path(id)?;
        let bytes = std::fs::read(&path).map_err(|_| FileError::NotFound(path))?;
        let bytes = Bytes::new(bytes);
        self.file_cache.lock().insert(id, bytes.clone());
        Ok(bytes)
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.font_data
            .get()
            .and_then(|d| d.fonts.get(index).cloned())
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let now = chrono::Local::now();
        let date = if let Some(days) = offset {
            now + chrono::Duration::days(days)
        } else {
            now
        };
        Some(Datetime::from_ymd(
            date.year(),
            date.month() as u8,
            date.day() as u8,
        )?)
    }
}

impl IdeWorld for EditorWorld {
    fn upcast(&self) -> &dyn World {
        self
    }

    /// Returns all available packages from the Typst preview registry.
    ///
    /// The index is fetched lazily on first call and cached for the app
    /// lifetime. Returns an empty slice if the network is unavailable.
    fn packages(&self) -> &[(PackageSpec, Option<EcoString>)] {
        self.package_index
            .get_or_init(|| fetch_package_index(&self.downloader))
            .as_slice()
    }

    /// Returns all file IDs currently known to the world (cached or shadowed).
    fn files(&self) -> Vec<FileId> {
        let mut ids = std::collections::HashSet::new();
        ids.extend(self.source_cache.lock().keys().copied());
        ids.extend(self.file_cache.lock().keys().copied());
        ids.extend(self.shadow.read().keys().copied());
        ids.into_iter().collect()
    }
}

/// Download and parse the Typst preview package index from the registry.
///
/// Returns a `Vec<(PackageSpec, Option<EcoString>)>` suitable for
/// [`IdeWorld::packages`]. Returns an empty vec on any network or parse error.
fn fetch_package_index(downloader: &Downloader) -> Vec<(PackageSpec, Option<EcoString>)> {
    const INDEX_URL: &str = "https://packages.typst.org/preview/index.json";
    let t = Instant::now();

    let response = match downloader.download(INDEX_URL) {
        Ok(r) => r,
        Err(_) => {
            info!(
                "package_index: network error ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            return vec![];
        }
    };

    let json: serde_json::Value = match response.into_json() {
        Ok(v) => v,
        Err(_) => {
            info!(
                "package_index: parse error ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            return vec![];
        }
    };

    let array = match json.as_array() {
        Some(a) => a,
        None => {
            info!(
                "package_index: invalid format ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            return vec![];
        }
    };

    let packages: Vec<(PackageSpec, Option<EcoString>)> = array
        .iter()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?;
            let version_str = entry.get("version")?.as_str()?;
            let version: typst::syntax::package::PackageVersion = version_str.parse().ok()?;
            let description = entry
                .get("description")
                .and_then(|d| d.as_str())
                .map(EcoString::from);
            let spec = PackageSpec {
                namespace: EcoString::from("preview"),
                name: EcoString::from(name),
                version,
            };
            Some((spec, description))
        })
        .collect();

    info!(
        "package_index: fetched {} packages ({:.1}ms)",
        packages.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    packages
}
