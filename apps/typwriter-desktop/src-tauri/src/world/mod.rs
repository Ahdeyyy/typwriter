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
    foundations::{Bytes, Datetime, Duration},
    syntax::package::PackageSpec,
    syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot},
    text::{Font, FontBook},
    utils::LazyHash,
    Feature, Features, Library, LibraryExt, World,
};
use typst_ide::IdeWorld;
use typst_kit::{
    downloader::{Downloader, ProgressDownloader, SystemDownloader},
    fonts::{self, FontStore},
    packages::{FsPackages, SystemPackages, UniversePackages},
};

pub struct EditorWorld {
    /// Workspace root on disk — updatable when the user opens a new folder.
    root: RwLock<PathBuf>,

    /// SAF-aware filesystem provider. A workspace folder picked through
    /// Android's Storage Access Framework is invisible to `std::fs` (the app
    /// holds no broad storage permission), so source files, images and other
    /// assets must be read through android-fs. `VcsState` owns the registry of
    /// SAF roots and hands back the right [`WorkingTreeFs`] accessor; off
    /// Android (and for the app-managed dir) this is always a std::fs accessor.
    vcs: Arc<crate::vcs::VcsState>,

    /// The file currently set as "main" by the user. `None` when no main
    /// file has been chosen — we deliberately avoid a sentinel `FileId`
    /// here since any plausible sentinel path (e.g. `main.typ`) could
    /// collide with a real file in the workspace.
    main: RwLock<Option<FileId>>,

    /// Typst standard library — built lazily on first compile, not at startup
    library: OnceLock<LazyHash<Library>>,

    /// Active font set, behind a lock so settings changes can swap fonts at
    /// runtime. `FontStore` (typst-kit 0.15) owns its `LazyHash<FontBook>` and
    /// resolves fonts by index, so `World::book`/`World::font` just delegate to
    /// it. Pointing at leaked memory keeps the `&LazyHash<FontBook>` / `Font`
    /// references returned from the `World` trait valid even after a reload —
    /// the references borrow from the store, which lives behind the lock, so a
    /// `'static` handle is what lets us return them with the `&self` lifetime.
    /// Each reload leaks the previous allocation; a tiny, bounded cost since
    /// font reloads happen at human cadence.
    font_store: RwLock<Option<&'static FontStore>>,

    /// Empty fallback for `World::book()` / `World::font()` before fonts arrive.
    empty_store: FontStore,

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

    /// Package storage: resolves packages from the data/cache dirs and
    /// downloads missing packages from Typst Universe. The wrapped
    /// `ProgressDownloader` emits Tauri download-progress events keyed by the
    /// `PackageSpec` being fetched.
    packages: SystemPackages,

    /// A separate (progress-free) downloader used only for fetching the package
    /// index for autocomplete (`SystemPackages` owns its downloader and does
    /// not expose it).
    index_downloader: SystemDownloader,

    /// Lazily cached list of all available packages from the Typst registry.
    /// Populated on the first call to `IdeWorld::packages()`.
    package_index: OnceLock<Vec<(PackageSpec, Option<EcoString>)>>,
}

impl EditorWorld {
    /// Fallback `FileId` returned from `World::main()` when no main file is
    /// set. The typst trait method requires a `FileId`, but compilation is
    /// gated on `has_main()` so this value is never actually compiled.
    fn fallback_main() -> FileId {
        local_file_id(Path::new("__no-main__")).expect("sentinel path is valid")
    }

    /// Resolve the (data, cache) package directories. On Android/iOS, both live
    /// at `<documents>/Typwriter/Packages` (app-private external storage),
    /// since the typst_kit defaults point at OS dirs that aren't writable
    /// under scoped storage. On desktop, fall back to the typst_kit standard
    /// locations so packages are shared with other Typst tooling.
    fn packages_dirs(app_handle: &AppHandle) -> (Option<FsPackages>, Option<FsPackages>) {
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
            let fs = dir.map(FsPackages::new);
            (fs.clone(), fs)
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = app_handle;
            (FsPackages::system_data(), FsPackages::system_cache())
        }
    }

    pub fn new(root: PathBuf, app_handle: AppHandle, vcs: Arc<crate::vcs::VcsState>) -> Self {
        let pkg = app_handle.package_info();
        let user_agent = format!("{}/{}", pkg.name, pkg.version);
        let (data_dir, cache_dir) = Self::packages_dirs(&app_handle);
        info!(
            "EditorWorld: packages data={:?} cache={:?}",
            data_dir.as_ref().map(FsPackages::path),
            cache_dir.as_ref().map(FsPackages::path),
        );
        // Wrap the network downloader so each package download reports progress
        // to the frontend. The factory is handed an `&dyn Any` key per download
        // (a `PackageSpec` for packages, `&"package index"` for the index); we
        // turn it into a labelled `TauriProgress`.
        let progress_handle = app_handle.clone();
        let downloader = ProgressDownloader::new(
            SystemDownloader::new(user_agent.clone()),
            move |key: &dyn std::any::Any| {
                let label = key
                    .downcast_ref::<PackageSpec>()
                    .map(|spec| spec.to_string())
                    .unwrap_or_else(|| "package index".to_string());
                TauriProgress::new(progress_handle.clone(), label)
            },
        );
        let packages =
            SystemPackages::from_parts(data_dir, cache_dir, UniversePackages::new(downloader));
        Self {
            root: RwLock::new(root),
            vcs,
            main: RwLock::new(None),
            library: OnceLock::new(),
            font_store: RwLock::new(None),
            empty_store: FontStore::new(),
            font_load_started: AtomicBool::new(false),
            fonts_ready: Mutex::new(false),
            fonts_cv: Condvar::new(),
            source_cache: Mutex::new(HashMap::new()),
            file_cache: Mutex::new(HashMap::new()),
            shadow: RwLock::new(HashMap::new()),
            app_handle,
            packages,
            index_downloader: SystemDownloader::new(user_agent),
            package_index: OnceLock::new(),
        }
    }

    /// Build a [`FontStore`] from the embedded fonts, optionally the system
    /// fonts, and the given extra directories. Mirrors the typst-cli 0.15 font
    /// discovery pattern (`FontStore::new()` + `extend`).
    fn build_font_store(extra_dirs: &[PathBuf], include_system: bool) -> FontStore {
        let mut store = FontStore::new();
        store.extend(fonts::embedded());
        if include_system {
            store.extend(fonts::system());
        }
        for dir in extra_dirs {
            store.extend(fonts::scan(dir));
        }
        store
    }

    /// Install a font set, replacing any existing one. Previous allocations are
    /// leaked so any outstanding `&LazyHash<FontBook>` / `Font` borrows returned
    /// from `World::book` / `World::font` remain valid.
    pub fn load_fonts(&self, store: FontStore) {
        let store: &'static FontStore = Box::leak(Box::new(store));
        *self.font_store.write() = Some(store);
        // Mark ready and wake any compile worker blocked in
        // `wait_until_fonts_loaded`. Keeping this in lockstep with `font_store`
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
                Self::build_font_store(&extra_dirs, true)
            }));
            match searched {
                Ok(store) => world.load_fonts(store),
                Err(_) => {
                    error!("ensure_fonts_loading: font search panicked; falling back to embedded fonts only");
                    world.load_fonts(Self::build_font_store(&[], false));
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
        self.load_fonts(Self::build_font_store(&extra_dirs, true));
    }

    /// Snapshot of the currently loaded font families (deduplicated, sorted).
    /// Used by the settings UI to populate the editor/UI font pickers.
    pub fn font_families(&self) -> Vec<String> {
        let Some(store) = *self.font_store.read() else {
            return Vec::new();
        };
        let mut families: Vec<String> = store
            .book()
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
        // `get_without_slash` already returns a forward-slash relative path.
        Some(id.vpath().get_without_slash().to_string())
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
        local_file_id(rel)
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

    /// Read a file's raw bytes for the compiler, routing workspace-local files
    /// through the SAF-aware accessor. A folder picked via Android's Storage
    /// Access Framework is unreachable with `std::fs`, so source files and
    /// embedded assets (`image(...)`, `include`/`read` targets) must be read
    /// through android-fs. Package files live in the app-private cache, which is
    /// always reachable with `std::fs` on every platform — and lie outside the
    /// workspace root — so they keep the direct path.
    fn read_file_bytes(&self, id: FileId) -> FileResult<Vec<u8>> {
        let path = self.id_to_path(id)?;

        if matches!(id.root(), VirtualRoot::Package(_)) {
            return std::fs::read(&path).map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    FileError::NotFound(path)
                } else {
                    FileError::AccessDenied
                }
            });
        }

        let root = self.root.read().clone();
        let fs = self.vcs.working_tree_fs_for(&root);
        fs.read_file(&path).map_err(|_| {
            // `WorkingTreeFs` collapses io errors to strings; recover the
            // NotFound/AccessDenied distinction typst relies on with a probe.
            if fs.exists(&path) {
                FileError::AccessDenied
            } else {
                FileError::NotFound(path)
            }
        })
    }

    /// Map a FileId back to an absolute path on disk.
    ///
    /// For local files, joins the root with the virtual path.
    /// For package files, uses `PackageStorage::prepare_package` which
    /// downloads the package if not already cached, reporting progress via
    /// Tauri events.
    pub fn id_to_path(&self, id: FileId) -> Result<PathBuf, FileError> {
        let vpath = id.vpath();
        match id.root() {
            VirtualRoot::Package(spec) => {
                // `obtain` resolves the package from the data/cache dirs,
                // downloading it from Typst Universe if missing. Download
                // progress is reported automatically by the wrapped
                // `ProgressDownloader` (keyed on `spec`).
                let root = self.packages.obtain(spec).map_err(FileError::Package)?;
                Ok(root.path().join(vpath.get_without_slash()))
            }
            VirtualRoot::Project => Ok(self.root.read().join(vpath.get_without_slash())),
        }
    }
}

impl World for EditorWorld {
    fn library(&self) -> &LazyHash<Library> {
        self.library.get_or_init(|| {
            // Enable the experimental HTML target so `export_html` can compile
            // an `HtmlDocument`; without this feature the compiler rejects the
            // `html` export pass. The paged preview/PDF/PNG/SVG paths are
            // unaffected.
            LazyHash::new(
                Library::builder()
                    .with_features(Features::from_iter([Feature::Html]))
                    .build(),
            )
        })
    }

    fn book(&self) -> &LazyHash<FontBook> {
        // `*self.font_store.read()` copies the `Option<&'static FontStore>` out
        // of the guard so we can return a reference whose lifetime is tied to
        // `&self` (the static reference outlives any caller-chosen lifetime).
        let opt: Option<&'static FontStore> = *self.font_store.read();
        match opt {
            Some(store) => store.book(),
            None => self.empty_store.book(),
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
            // 3. Fall back to disk/SAF (may trigger a package download)
            let bytes = self.read_file_bytes(id)?;
            String::from_utf8(bytes).map_err(|_| FileError::AccessDenied)?
        };

        let source = Source::new(id, text);
        self.source_cache.lock().insert(id, source.clone());
        Ok(source)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(bytes) = self.file_cache.lock().get(&id) {
            return Ok(bytes.clone());
        }
        let bytes = Bytes::new(self.read_file_bytes(id)?);
        self.file_cache.lock().insert(id, bytes.clone());
        Ok(bytes)
    }

    fn font(&self, index: usize) -> Option<Font> {
        let opt: Option<&'static FontStore> = *self.font_store.read();
        opt.and_then(|store| store.font(index))
    }

    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        today_with_offset(chrono::Utc::now(), offset)
    }
}

/// Build a project-local [`FileId`] from a workspace-relative path.
///
/// Typst 0.15's `VirtualPath::new` takes a forward-slash string and validates
/// it, so this normalizes separators (Windows paths use `\`) and returns `None`
/// if the path can't be represented as a virtual path. Local files live under
/// [`VirtualRoot::Project`]; package files are constructed by typst itself.
pub fn local_file_id(relative: &Path) -> Option<FileId> {
    let normalized = relative.to_string_lossy().replace('\\', "/");
    let vpath = VirtualPath::new(normalized).ok()?;
    Some(RootedPath::new(VirtualRoot::Project, vpath).intern())
}

/// Resolve "today" for `World::today`. As of Typst 0.15 the trait passes the
/// UTC offset as a [`Duration`] (it backs `datetime.today(offset: ..)`); `None`
/// means local time. We reduce it to whole seconds and defer to
/// [`today_from_secs`].
fn today_with_offset(
    utc_now: chrono::DateTime<chrono::Utc>,
    offset: Option<Duration>,
) -> Option<Datetime> {
    // `Duration::seconds` returns the *total* duration in seconds as an f64;
    // saturating `as i32` keeps absurd offsets out of `FixedOffset`'s range
    // (they resolve to `None` below rather than panicking).
    let offset_secs = offset.map(|d| d.seconds() as i32);
    today_from_secs(utc_now, offset_secs)
}

/// Resolve "today" from a UTC offset in whole seconds. `None` means local time.
/// Pure and runtime-free so it can be unit-tested without constructing an
/// `EditorWorld` or a typst `Duration`.
fn today_from_secs(
    utc_now: chrono::DateTime<chrono::Utc>,
    offset_secs: Option<i32>,
) -> Option<Datetime> {
    use chrono::{FixedOffset, Local};
    let (year, month, day) = match offset_secs {
        None => {
            let now = utc_now.with_timezone(&Local);
            (now.year(), now.month(), now.day())
        }
        Some(secs) => {
            let now = utc_now.with_timezone(&FixedOffset::east_opt(secs)?);
            (now.year(), now.month(), now.day())
        }
    };
    Datetime::from_ymd(year, month as u8, day as u8)
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
            .get_or_init(|| fetch_package_index(&self.index_downloader))
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
fn fetch_package_index(downloader: &SystemDownloader) -> Vec<(PackageSpec, Option<EcoString>)> {
    const INDEX_URL: &str = "https://packages.typst.org/preview/index.json";
    let t = Instant::now();

    // The `&dyn Any` download key (`&"package index"`) matches the convention
    // typst-kit uses for the index; it lets a progress wrapper skip it. This
    // downloader has no wrapper, so the key is irrelevant here.
    let data = match downloader.download(&"package index", INDEX_URL) {
        Ok(d) => d,
        Err(_) => {
            info!(
                "package_index: network error ({:.1}ms)",
                t.elapsed().as_secs_f64() * 1000.0
            );
            return vec![];
        }
    };

    let json: serde_json::Value = match serde_json::from_slice(&data) {
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

#[cfg(test)]
mod tests {
    use super::today_from_secs;
    use chrono::{TimeZone, Utc};

    const HOUR: i32 = 3600;

    /// A `Datetime` exposes its components via the typst foundations API; pull
    /// them back out for assertions.
    fn ymd(dt: typst::foundations::Datetime) -> (i32, u8, u8) {
        (
            dt.year().unwrap(),
            dt.month().unwrap(),
            dt.day().unwrap(),
        )
    }

    #[test]
    fn today_offset_shifts_the_calendar_day() {
        // 2026-06-11 23:30 UTC: still June 11 at UTC, but past midnight east.
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();

        assert_eq!(ymd(today_from_secs(now, Some(0)).unwrap()), (2026, 6, 11));
        // UTC+1 → 00:30 on June 12 (crosses midnight east).
        assert_eq!(ymd(today_from_secs(now, Some(HOUR)).unwrap()), (2026, 6, 12));
        // UTC-1 → 22:30 on June 11.
        assert_eq!(ymd(today_from_secs(now, Some(-HOUR)).unwrap()), (2026, 6, 11));
    }

    #[test]
    fn today_absurd_offset_returns_none_without_panic() {
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        // Far outside FixedOffset's ±24h (±86400s) range.
        assert!(today_from_secs(now, Some(HOUR * 24 * 365)).is_none());
        assert!(today_from_secs(now, Some(-HOUR * 24 * 365)).is_none());
    }

    #[test]
    fn today_none_offset_uses_local_time() {
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        // Exact date depends on the host's local zone; just assert it resolves.
        assert!(today_from_secs(now, None).is_some());
    }
}
