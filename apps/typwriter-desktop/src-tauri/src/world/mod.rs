// world/mod.rs

mod progress;
pub use progress::TauriProgress;

use chrono::Datelike;
use ecow::EcoString;
use log::{error, info};
use parking_lot::{Condvar, Mutex, RwLock};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter};
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::Manager;
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
    fonts::{FontSearcher, FontSlot},
    package::PackageStorage,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use typst_kit::package::{default_package_cache_path, default_package_path};

/// Bundled font data, set once via `OnceLock` when background loading completes.
struct FontData {
    slots: Vec<FontSlot>,
    book: LazyHash<FontBook>,
}

pub struct EditorWorld {
    /// Workspace root on disk — updatable when the user opens a new folder.
    root: RwLock<PathBuf>,

    /// The file currently set as "main" by the user. `None` when no main
    /// file has been chosen — we deliberately avoid a sentinel `FileId`
    /// here since any plausible sentinel path (e.g. `main.typ`) could
    /// collide with a real file in the workspace.
    main: RwLock<Option<FileId>>,

    /// Typst standard library — built lazily on first compile, not at startup
    library: OnceLock<LazyHash<Library>>,

    /// Active font set, behind a lock so settings changes can swap fonts at
    /// runtime. Pointing at leaked memory keeps the `&LazyHash<FontBook>` /
    /// `Font` references returned from the `World` trait valid even after a
    /// reload. Each reload leaks the previous allocation; this is a tiny,
    /// bounded cost since font reloads happen at human cadence.
    font_data: RwLock<Option<&'static FontData>>,

    /// Empty fallback for `World::book()` before fonts arrive
    empty_book: LazyHash<FontBook>,

    /// Single-spawn guard for the lazy background font load. Fonts are no
    /// longer searched at startup — the first workspace open / first compile
    /// kicks the search off, so the scan overlaps the rest of the open path.
    font_load_started: AtomicBool,

    /// `true` once a font set has been installed. Paired with `fonts_cv` so the
    /// compile worker can block until fonts exist instead of compiling against
    /// the empty fallback book (which would render fonts-less pages and poison
    /// the on-disk preview cache with them).
    fonts_ready: Mutex<bool>,
    fonts_cv: Condvar,

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
    /// Fallback `FileId` returned from `World::main()` when no main file is
    /// set. The typst trait method requires a `FileId`, but compilation is
    /// gated on `has_main()` so this value is never actually compiled.
    fn fallback_main() -> FileId {
        FileId::new(None, VirtualPath::new("<no-main>"))
    }

    /// Resolve the directory where downloaded packages should be cached and
    /// stored. On Android/iOS, both the cache and the package directory live
    /// at `<documents>/Typwriter/Packages` (app-private external storage),
    /// since the typst_kit defaults point at OS dirs that aren't writable
    /// under scoped storage. On desktop, fall back to the typst_kit
    /// defaults so packages are shared with other Typst tooling.
    fn packages_dir(app_handle: &AppHandle) -> (Option<PathBuf>, Option<PathBuf>) {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let dir = app_handle
                .path()
                .document_dir()
                .ok()
                .map(|d| d.join("Typwriter").join("Packages"));
            if let Some(d) = &dir {
                let _ = std::fs::create_dir_all(d);
            }
            (dir.clone(), dir)
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = app_handle;
            (default_package_cache_path(), default_package_path())
        }
    }

    pub fn new(root: PathBuf, app_handle: AppHandle) -> Self {
        let pkg = app_handle.package_info();
        let user_agent = format!("{}/{}", pkg.name, pkg.version);
        let downloader = Downloader::new(user_agent.clone());
        let (cache_dir, package_dir) = Self::packages_dir(&app_handle);
        info!(
            "EditorWorld: packages cache={:?} packages={:?}",
            cache_dir, package_dir
        );
        let package_storage =
            PackageStorage::new(cache_dir, package_dir, Downloader::new(user_agent));
        Self {
            root: RwLock::new(root),
            main: RwLock::new(None),
            library: OnceLock::new(),
            font_data: RwLock::new(None),
            empty_book: LazyHash::new(FontBook::from_fonts(&[])),
            font_load_started: AtomicBool::new(false),
            fonts_ready: Mutex::new(false),
            fonts_cv: Condvar::new(),
            source_cache: Mutex::new(HashMap::new()),
            file_cache: Mutex::new(HashMap::new()),
            shadow: RwLock::new(HashMap::new()),
            app_handle,
            package_storage,
            downloader,
            package_index: OnceLock::new(),
        }
    }

    /// Load fonts from a background thread after startup. Replaces any
    /// existing font set. Previous allocations are leaked so any outstanding
    /// `&LazyHash<FontBook>` borrows returned from `World::book` remain
    /// valid.
    pub fn load_fonts(&self, book: FontBook, slots: Vec<FontSlot>) {
        let data: &'static FontData = Box::leak(Box::new(FontData {
            slots,
            book: LazyHash::new(book),
        }));
        *self.font_data.write() = Some(data);
        // Mark ready and wake any compile worker blocked in
        // `wait_until_fonts_loaded`. Keeping this in lockstep with `font_data`
        // means "ready" always implies a usable font set is installed — true
        // for both the initial lazy load and later settings-driven reloads.
        *self.fonts_ready.lock() = true;
        self.fonts_cv.notify_all();
    }

    /// Whether a font set has been installed yet.
    pub fn fonts_ready(&self) -> bool {
        *self.fonts_ready.lock()
    }

    /// Block the calling thread until fonts are available. The compile worker
    /// calls this before its first compile so it never renders against the
    /// empty fallback book.
    pub fn wait_until_fonts_loaded(&self) {
        let mut ready = self.fonts_ready.lock();
        while !*ready {
            self.fonts_cv.wait(&mut ready);
        }
    }

    /// Kick off the background font search exactly once. Idempotent — cheap to
    /// call on every workspace open and every compile (a single atomic swap
    /// after the first). The system font scan can take seconds, so it runs on
    /// its own thread; when it finishes the fonts are installed (which wakes
    /// `wait_until_fonts_loaded`) and `app:fonts-loaded` is emitted.
    pub fn ensure_fonts_loading(self: &Arc<Self>) {
        if self.font_load_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let world = Arc::clone(self);
        std::thread::spawn(move || {
            let extra_dirs = crate::commands::settings::load_font_directories(&world.app_handle);
            // A corrupt font file or a stalled font directory can panic the
            // fontdb scan. Catch it so the compile worker is never left blocked
            // forever — fall back to embedded fonts only, which don't touch the
            // filesystem.
            let searched = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                FontSearcher::new().search_with(&extra_dirs)
            }));
            match searched {
                Ok(fonts) => world.load_fonts(fonts.book, fonts.fonts),
                Err(_) => {
                    error!("ensure_fonts_loading: font search panicked; falling back to embedded fonts only");
                    let fonts = FontSearcher::new().include_system_fonts(false).search();
                    world.load_fonts(fonts.book, fonts.fonts);
                }
            }
            if let Err(err) = world.app_handle.emit("app:fonts-loaded", ()) {
                error!("ensure_fonts_loading: emit app:fonts-loaded failed err=\"{err}\"");
            }
        });
    }

    /// Run a font search (system + embedded + the given extra directories)
    /// and replace the current font set. Intended to be called from a
    /// background thread since `fontdb`'s system scan can be slow.
    pub fn reload_fonts_with(&self, extra_dirs: Vec<PathBuf>) {
        let fonts = FontSearcher::new().search_with(&extra_dirs);
        self.load_fonts(fonts.book, fonts.fonts);
    }

    /// Snapshot of the currently loaded font families (deduplicated, sorted).
    /// Used by the settings UI to populate the editor/UI font pickers.
    pub fn font_families(&self) -> Vec<String> {
        let Some(data) = *self.font_data.read() else {
            return Vec::new();
        };
        let mut families: Vec<String> = data
            .book
            .families()
            .map(|(name, _)| name.to_string())
            .collect();
        families.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        families.dedup();
        families
    }

    /// Called by Tauri command when user sets main file
    pub fn set_main(&self, id: FileId) {
        *self.main.write() = Some(id);
    }

    pub fn clear_main(&self) {
        *self.main.write() = None;
    }

    /// The workspace root path.
    pub fn root(&self) -> PathBuf {
        self.root.read().clone()
    }

    /// The current main `FileId`, or `None` when no main file is set.
    pub fn main_id(&self) -> Option<FileId> {
        *self.main.read()
    }

    /// Whether a real main file has been set. Use this to gate compilation:
    /// without it, typst would emit "cannot find main file" for every cycle.
    pub fn has_main(&self) -> bool {
        self.main.read().is_some()
    }

    /// Workspace-relative path of the current main file, normalized to forward
    /// slashes. `None` when no main file is set. Used to tag the persisted
    /// preview manifest so a manifest left over for a *different* main file is
    /// ignored on the next open.
    pub fn main_rel(&self) -> Option<String> {
        let id = (*self.main.read())?;
        Some(
            id.vpath()
                .as_rootless_path()
                .to_string_lossy()
                .replace('\\', "/"),
        )
    }

    /// Update the workspace root and flush all file caches.
    pub fn set_root(&self, path: PathBuf) {
        *self.root.write() = path;
        *self.main.write() = None;
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
    pub fn id_to_path(&self, id: FileId) -> Result<PathBuf, FileError> {
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
        // `*self.font_data.read()` copies the `Option<&'static FontData>` out
        // of the guard so we can return a reference whose lifetime is tied to
        // `&self` (the static reference outlives any caller-chosen lifetime).
        let opt: Option<&'static FontData> = *self.font_data.read();
        match opt {
            Some(d) => &d.book,
            None => &self.empty_book,
        }
    }

    fn main(&self) -> FileId {
        self.main.read().unwrap_or_else(Self::fallback_main)
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
        let opt: Option<&'static FontData> = *self.font_data.read();
        opt.and_then(|d| d.slots.get(index))
            .and_then(|slot| slot.get())
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
