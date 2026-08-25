mod progress;
pub use progress::TauriProgress;

use chrono::Datelike;
use ecow::EcoString;
use log::{error, info};
use parking_lot::{Condvar, Mutex, RwLock};
use std::{
    collections::HashMap,
    ops::Range,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter};
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

    /// Filesystem provider. `VcsState` hands back the [`WorkingTreeFs`]
    /// accessor used to read source files, images and other assets.
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

    /// Highest shadow-write version applied per file.
    ///
    /// Shadow writes run off the main thread, so two writes for the same file
    /// can be in flight at once and complete out of order. Without this, a
    /// slow older write could land after a newer one and leave the compiler
    /// looking at text the user has already moved past. Guarded by the same
    /// lock as `shadow` so the check and the write are atomic together.
    shadow_versions: RwLock<HashMap<FileId, u64>>,

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

    /// Resolve the (data, cache) package directories. Uses the typst_kit
    /// standard locations so packages are shared with other Typst tooling.
    fn packages_dirs(app_handle: &AppHandle) -> (Option<FsPackages>, Option<FsPackages>) {
        let _ = app_handle;
        (FsPackages::system_data(), FsPackages::system_cache())
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
            shadow_versions: RwLock::new(HashMap::new()),
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
    ///
    /// Shadow versions are cleared here and *only* here. They deliberately
    /// survive `shadow_commit` / `shadow_remove`: a save doesn't cancel a write
    /// that is already in flight, and forgetting the high-water mark would let
    /// that stale write be accepted afterwards and resurrect old text.
    pub fn set_root(&self, path: PathBuf) {
        *self.root.write() = path;
        *self.main.write() = None;
        self.source_cache.lock().clear();
        self.file_cache.lock().clear();
        self.shadow.write().clear();
        self.shadow_versions.write().clear();
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

    /// Called on every keystroke from the editor.
    ///
    /// Updates the cached [`Source`] **in place** rather than dropping it. This
    /// is the difference between an incremental and a cold compile:
    /// [`Source::replace`] diffs against the current text, reparses only the
    /// changed range, and leaves every untouched [`SyntaxNode`] — and its span
    /// number — exactly as it was. comemo keys its memoized `eval`/layout work
    /// on those nodes, so the parts of the document the user didn't touch are
    /// reused. Rebuilding with `Source::new` produces an all-new tree, which
    /// invalidates everything and makes every keystroke pay a full re-evaluation.
    ///
    /// [`SyntaxNode`]: typst::syntax::SyntaxNode
    /// `version` is the editor's monotonically increasing write counter for
    /// this file. A write that is not newer than the last one applied is
    /// dropped and this returns `false` — see [`Self::shadow_versions`].
    pub fn shadow_write(&self, id: FileId, content: String, version: u64) -> bool {
        // Take the version lock first and hold it across the whole update, so
        // a concurrent write can't interleave between the check and the swap.
        let mut versions = self.shadow_versions.write();
        if !claim_write_version(&mut versions, id, version) {
            return false;
        }

        {
            let mut cache = self.source_cache.lock();
            apply_edit_to_cache(&mut cache, id, &content);
        }
        // The shadow is still the authority for `has_shadow` and for rebuilding
        // the source after an `invalidate_file` / root change drops the cache.
        self.shadow.write().insert(id, content);
        true
    }

    /// Called after the buffer has been written to disk.
    ///
    /// The shadow goes away — disk is authoritative again — but the parsed
    /// [`Source`] is deliberately *kept*: it already holds exactly the bytes
    /// that were just written, so dropping it would make the compile that
    /// `save_file` kicks off immediately afterwards re-read and fully reparse a
    /// file whose tree we are already holding.
    pub fn shadow_commit(&self, id: FileId) {
        self.shadow.write().remove(&id);
    }

    /// Called when unsaved edits are discarded — the buffer is thrown away and
    /// disk becomes the truth again, so the parsed tree (which reflects the
    /// discarded edits) must go with it.
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
    /// through the [`WorkingTreeFs`] accessor. Package files live in the
    /// app-private cache — reachable with `std::fs` and outside the workspace
    /// root — so they keep the direct path.
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
            // 3. Fall back to disk (may trigger a package download)
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

/// Record `version` as the newest write applied to `id`, returning whether it
/// actually is newer.
///
/// The ordering guard for concurrent shadow writes. Free-standing so the rule
/// can be tested without an `AppHandle`; the caller holds the write lock across
/// the check and the update, which is what makes it atomic.
fn claim_write_version(versions: &mut HashMap<FileId, u64>, id: FileId, version: u64) -> bool {
    if versions.get(&id).is_some_and(|&applied| version <= applied) {
        return false;
    }
    versions.insert(id, version);
    true
}

/// Install `content` as the cached parse tree for `id`, reparsing incrementally
/// when a tree is already cached.
///
/// Returns the byte range that was actually reparsed, or `None` when there was
/// no cached tree to edit and the file had to be parsed from scratch. That
/// return value is what the tests assert on: it is the only externally visible
/// evidence that an edit stayed incremental instead of silently regressing to a
/// full reparse.
///
/// Free-standing (rather than a method) so it can be unit-tested without an
/// `AppHandle`, which `EditorWorld::new` requires.
fn apply_edit_to_cache(
    cache: &mut HashMap<FileId, Source>,
    id: FileId,
    content: &str,
) -> Option<Range<usize>> {
    match cache.get_mut(&id) {
        Some(source) => Some(source.replace(content)),
        None => {
            cache.insert(id, Source::new(id, content.to_string()));
            None
        }
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
    use super::{apply_edit_to_cache, claim_write_version, local_file_id, today_from_secs};
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;
    use std::path::Path;
    use typst::syntax::{FileId, Source, SyntaxKind, SyntaxNode};

    const HOUR: i32 = 3600;

    // ─── Shadow writes / incremental reparse ────────────────────────────────
    //
    // `apply_edit_to_cache` is the per-keystroke hot path. Two things must hold
    // and are easy to regress independently:
    //
    //   1. Correctness — the cached tree must always parse exactly the text the
    //      editor last sent. Everything downstream (compile, diagnostics,
    //      typst-ide) reads through it.
    //   2. Incrementality — a small edit must reparse a small range. Going back
    //      to `Source::new` would keep every correctness test green while
    //      silently costing a full re-evaluation on every keystroke, so the
    //      reparsed range is asserted directly.

    fn test_id(name: &str) -> FileId {
        local_file_id(Path::new(name)).expect("valid virtual path")
    }

    fn count_kind(node: &SyntaxNode, kind: SyntaxKind) -> usize {
        let here = usize::from(node.kind() == kind);
        here + node.children().map(|child| count_kind(child, kind)).sum::<usize>()
    }

    /// A document big enough that a full reparse is clearly distinguishable
    /// from an incremental one by the size of the reparsed range.
    fn big_doc(body: &str) -> String {
        let filler = "Some ordinary paragraph text that just takes up room.\n\n";
        let mut out = String::new();
        for i in 0..200 {
            out.push_str(&format!("= Section {i}\n\n"));
            out.push_str(filler);
        }
        out.push_str(body);
        out.push_str("\n\n");
        for i in 200..400 {
            out.push_str(&format!("= Section {i}\n\n"));
            out.push_str(filler);
        }
        out
    }

    #[test]
    fn cold_cache_parses_from_scratch() {
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        // `None` marks the full-parse path: there was no tree to edit.
        assert_eq!(apply_edit_to_cache(&mut cache, id, "= Hello\n"), None);
        assert_eq!(cache[&id].text(), "= Hello\n");
    }

    #[test]
    fn warm_cache_takes_the_edit_path_and_keeps_text_exact() {
        // Scope here is the *edit path* and text correctness. How much gets
        // reparsed is not asserted: on a document this small the reparser
        // legitimately widens to the enclosing markup block (which is the whole
        // file), and there is nothing to save at that size anyway. The size
        // guarantee is covered by `small_edit_in_large_document_stays_incremental`.
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        apply_edit_to_cache(&mut cache, id, "= Hello\n\nworld\n");
        let range = apply_edit_to_cache(&mut cache, id, "= Hello\n\nworlds\n")
            .expect("second write must take the incremental path");

        assert_eq!(cache[&id].text(), "= Hello\n\nworlds\n");
        assert!(range.end <= cache[&id].text().len());
    }

    #[test]
    fn small_edit_in_large_document_stays_incremental() {
        // This is the regression guard for the optimization itself. Reverting
        // `shadow_write` to `Source::new` (or clearing the cache first) makes
        // this fail, while every correctness test below still passes.
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        let before = big_doc("The quick brown fox.");
        let after = big_doc("The quick brown fix.");
        apply_edit_to_cache(&mut cache, id, &before);

        let range = apply_edit_to_cache(&mut cache, id, &after)
            .expect("warm cache must reparse incrementally");

        assert_eq!(cache[&id].text(), after);
        // One character changed in a ~40 KB document. Allow generous slack for
        // the reparser widening to a safe node boundary, but nothing close to
        // the whole file.
        assert!(
            range.len() < after.len() / 10,
            "reparsed {} bytes of a {} byte document — incremental reparse regressed",
            range.len(),
            after.len(),
        );
    }

    #[test]
    fn sequential_edits_accumulate_exactly() {
        // Mirrors a burst of keystrokes: every intermediate state must be the
        // text the editor sent, not a merge artifact of the incremental path.
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        let states = [
            "#let x = 1\n",
            "#let x = 12\n",
            "#let x = 12\n\n#x\n",
            "#let x = 12\n\n#(x + 1)\n",
            "#let xs = (1, 2)\n\n#(xs.at(0) + 1)\n",
        ];
        for state in states {
            apply_edit_to_cache(&mut cache, id, state);
            assert_eq!(cache[&id].text(), state);
        }
    }

    #[test]
    fn incremental_reparse_keeps_the_tree_structurally_correct() {
        // An incremental reparse that silently corrupted the tree would still
        // round-trip `text()`, so assert on parsed structure too.
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        apply_edit_to_cache(&mut cache, id, "= One\n\nbody\n\n= Two\n\nbody\n");
        let incremental_headings = {
            apply_edit_to_cache(&mut cache, id, "= One\n\nbody\n\n= Two\n\nbody\n\n= Three\n\nbody\n");
            count_kind(cache[&id].root(), SyntaxKind::Heading)
        };

        // Compare against a from-scratch parse of the same final text.
        let fresh = Source::new(id, cache[&id].text().to_string());
        assert_eq!(incremental_headings, count_kind(fresh.root(), SyntaxKind::Heading));
        assert_eq!(incremental_headings, 3);
    }

    #[test]
    fn deleting_a_large_region_is_handled() {
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        apply_edit_to_cache(&mut cache, id, &big_doc("keep me"));
        apply_edit_to_cache(&mut cache, id, "= Only this survives\n");

        assert_eq!(cache[&id].text(), "= Only this survives\n");
        assert_eq!(count_kind(cache[&id].root(), SyntaxKind::Heading), 1);
    }

    #[test]
    fn rewriting_the_whole_document_is_handled() {
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        apply_edit_to_cache(&mut cache, id, "#set page(width: 10cm)\n= A\n");
        apply_edit_to_cache(&mut cache, id, "$ integral_0^1 x dif x $\n");

        assert_eq!(cache[&id].text(), "$ integral_0^1 x dif x $\n");
        assert_eq!(count_kind(cache[&id].root(), SyntaxKind::Heading), 0);
    }

    #[test]
    fn rewriting_to_identical_content_is_a_no_op() {
        // Idle-save and format-on-save both re-send unchanged text; that must
        // not disturb the cached tree.
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("main.typ");

        let text = "= Stable\n\nUnchanged body.\n";
        apply_edit_to_cache(&mut cache, id, text);
        let range = apply_edit_to_cache(&mut cache, id, text).expect("warm cache");

        assert_eq!(cache[&id].text(), text);
        assert!(range.is_empty(), "identical content should reparse nothing");
    }

    #[test]
    fn edits_are_isolated_per_file() {
        // The cache is keyed by FileId; a write to one file must never disturb
        // another's tree.
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let main = test_id("main.typ");
        let chapter = test_id("chapters/one.typ");

        apply_edit_to_cache(&mut cache, main, "= Main\n");
        apply_edit_to_cache(&mut cache, chapter, "= Chapter\n");
        apply_edit_to_cache(&mut cache, main, "= Main edited\n");

        assert_eq!(cache[&main].text(), "= Main edited\n");
        assert_eq!(cache[&chapter].text(), "= Chapter\n");
    }

    // ─── Shadow write ordering ──────────────────────────────────────────────
    //
    // `update_file_content` runs off the main thread, so writes for one file
    // can complete out of order. Before that, Tauri's main-thread queue gave
    // ordering for free; `claim_write_version` is what replaces it. If it ever
    // accepts a stale write, the compiler renders text the user has already
    // typed past — a silent, intermittent wrong-preview bug.

    #[test]
    fn first_write_for_a_file_is_always_accepted() {
        let mut versions = HashMap::new();
        assert!(claim_write_version(&mut versions, test_id("main.typ"), 1));
    }

    #[test]
    fn newer_writes_are_accepted_in_order() {
        let mut versions = HashMap::new();
        let id = test_id("main.typ");
        for version in 1..=5 {
            assert!(claim_write_version(&mut versions, id, version));
        }
    }

    #[test]
    fn a_write_that_lands_late_is_dropped() {
        // Versions 7 and 8 are sent; 8 wins the race and lands first. 7 must
        // not be allowed to overwrite it afterwards.
        let mut versions = HashMap::new();
        let id = test_id("main.typ");

        assert!(claim_write_version(&mut versions, id, 8));
        assert!(
            !claim_write_version(&mut versions, id, 7),
            "a write older than the applied one must be dropped",
        );
        assert_eq!(versions[&id], 8);
    }

    #[test]
    fn a_replayed_write_is_dropped() {
        let mut versions = HashMap::new();
        let id = test_id("main.typ");

        assert!(claim_write_version(&mut versions, id, 3));
        assert!(!claim_write_version(&mut versions, id, 3));
    }

    #[test]
    fn write_versions_are_tracked_per_file() {
        // The counter is global across files, so a high version on one file
        // must not block a lower — but still newer — version on another.
        let mut versions = HashMap::new();
        let main = test_id("main.typ");
        let chapter = test_id("chapter.typ");

        assert!(claim_write_version(&mut versions, main, 100));
        assert!(claim_write_version(&mut versions, chapter, 4));
        assert!(claim_write_version(&mut versions, chapter, 5));
        assert!(!claim_write_version(&mut versions, main, 99));
    }

    #[test]
    fn cached_source_keeps_its_file_id() {
        // Diagnostic spans and click-to-source resolve through `Source::id`;
        // an incremental edit must not re-key the tree.
        let mut cache: HashMap<FileId, Source> = HashMap::new();
        let id = test_id("nested/deep/main.typ");

        apply_edit_to_cache(&mut cache, id, "= A\n");
        apply_edit_to_cache(&mut cache, id, "= B\n");

        assert_eq!(cache[&id].id(), id);
    }

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
