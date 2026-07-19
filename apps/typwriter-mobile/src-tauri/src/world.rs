// world.rs
//
// `MobileWorld` — implements `typst::World` + `typst_ide::IdeWorld`. A lean
// reimagining of the desktop `EditorWorld` on typst 0.15: fonts live in a
// runtime-swappable `FontStore` (embedded fonts are installed at construction;
// the full set — user font folder / SAF-tree fonts — is loaded on a background
// thread and swapped in, see `fonts.rs` + `lib.rs`), plain `std::fs` reads, and
// a slot cache that is fully cleared at the start of every compile (`reset()`),
// so edited files are always re-read from disk — disk is the source of truth.

use chrono::Datelike;
use ecow::EcoString;
use log::info;
use parking_lot::{Condvar, Mutex, RwLock};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration as StdDuration,
};
use typst::{
    diag::{FileError, FileResult},
    foundations::{Bytes, Datetime, Duration},
    syntax::package::PackageSpec,
    syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot},
    text::{Font, FontBook},
    utils::LazyHash,
    Features, Library, LibraryExt, World,
};
use typst_ide::IdeWorld;
use typst_kit::{
    downloader::{Downloader, SystemDownloader},
    fonts::FontStore,
    packages::{FsPackages, SystemPackages, UniversePackages},
};

/// One cached file: either a parsed source (text) or raw bytes (binary asset).
enum FileSlot {
    Source(Source),
    Bytes(Bytes),
}

pub struct MobileWorld {
    /// Workspace root; `None` until a workspace is opened.
    root: RwLock<Option<PathBuf>>,
    /// The main file within the root. `None` when no main file is set.
    main: RwLock<Option<FileId>>,
    library: LazyHash<Library>,
    /// Active font set. `FontStore` (typst-kit 0.15) owns its
    /// `LazyHash<FontBook>` and resolves fonts by index, so `World::book` /
    /// `World::font` delegate to it. The store is leaked so the references
    /// returned from the `World` trait stay valid across a runtime swap
    /// (`install_fonts`); font reloads happen at human cadence, so the leaked
    /// allocations are a tiny, bounded cost.
    font_store: RwLock<&'static FontStore>,
    /// `true` once the full font set (embedded + user fonts) has been
    /// installed by the background loader. Paired with `fonts_cv` so the first
    /// compile can wait for the user's fonts instead of rendering with the
    /// embedded-only set.
    fonts_ready: Mutex<bool>,
    fonts_cv: Condvar,
    /// File slot cache: FileId -> (Source | Bytes). Cleared by `reset()`.
    slots: Mutex<HashMap<FileId, FileSlot>>,
    /// Transient per-call overlay (used by `with_overlay` for completions).
    overlay: RwLock<HashMap<FileId, String>>,
    /// Package resolution: custom data/cache dirs (an app-reachable folder)
    /// backed by Typst Universe downloads for missing packages.
    packages: SystemPackages,
    /// A separate downloader used only for fetching the package index for
    /// autocomplete (`SystemPackages` owns its downloader privately).
    index_downloader: SystemDownloader,
    package_index: OnceLock<Vec<(PackageSpec, Option<EcoString>)>>,
    /// "Now" (UTC instant), chosen once per compile so a document compiled
    /// across midnight doesn't straddle two dates. Cleared by `reset()`.
    now: Mutex<Option<chrono::DateTime<chrono::Utc>>>,
}

/// Build a project-local [`FileId`] from a workspace-relative path.
///
/// Typst 0.15's `VirtualPath::new` takes a forward-slash string and validates
/// it, so this normalizes separators and returns `None` if the path can't be
/// represented as a virtual path.
pub fn local_file_id(relative: &Path) -> Option<FileId> {
    let normalized = relative.to_string_lossy().replace('\\', "/");
    let vpath = VirtualPath::new(normalized).ok()?;
    Some(RootedPath::new(VirtualRoot::Project, vpath).intern())
}

impl MobileWorld {
    /// Fallback `FileId` returned from `World::main()` when no main file is set.
    /// Compilation is gated on `has_main()`, so this is never actually compiled.
    fn fallback_main() -> FileId {
        local_file_id(Path::new("__no-main__")).expect("sentinel path is valid")
    }

    pub fn new(package_cache: Option<PathBuf>, package_dir: Option<PathBuf>) -> Self {
        let user_agent = "typwriter-mobile";
        let packages = SystemPackages::from_parts(
            package_dir.map(FsPackages::new),
            package_cache.map(FsPackages::new),
            UniversePackages::new(SystemDownloader::new(user_agent)),
        );

        // Embedded fonts install synchronously (fast, no filesystem); the full
        // set (user folder / SAF fonts) is swapped in by the background loader.
        let embedded = crate::fonts::embedded_store();

        Self {
            root: RwLock::new(None),
            main: RwLock::new(None),
            library: LazyHash::new(Library::builder().with_features(Features::default()).build()),
            font_store: RwLock::new(Box::leak(Box::new(embedded))),
            fonts_ready: Mutex::new(false),
            fonts_cv: Condvar::new(),
            slots: Mutex::new(HashMap::new()),
            overlay: RwLock::new(HashMap::new()),
            packages,
            index_downloader: SystemDownloader::new(user_agent),
            package_index: OnceLock::new(),
            now: Mutex::new(None),
        }
    }

    /// Install a font set, replacing the current one, and mark fonts ready.
    /// The previous store is leaked so outstanding `&FontBook` / `Font`
    /// borrows returned from the `World` trait remain valid.
    pub fn install_fonts(&self, store: FontStore) {
        *self.font_store.write() = Box::leak(Box::new(store));
        *self.fonts_ready.lock() = true;
        self.fonts_cv.notify_all();
    }

    /// Block until the background font load has installed the full font set,
    /// or until the timeout elapses (a hung SAF read must never freeze the
    /// compile pipeline forever — after the timeout we compile with whatever
    /// set is installed).
    pub fn wait_for_fonts(&self, timeout: StdDuration) {
        let mut ready = self.fonts_ready.lock();
        if !*ready {
            let _ = self.fonts_cv.wait_for(&mut ready, timeout);
        }
    }

    /// Update the workspace root and flush all caches.
    pub fn set_root(&self, path: PathBuf) {
        *self.root.write() = Some(path);
        *self.main.write() = None;
        self.slots.lock().clear();
        self.overlay.write().clear();
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.root.read().clone()
    }

    pub fn set_main(&self, id: FileId) {
        *self.main.write() = Some(id);
    }

    #[allow(dead_code)] // part of the world API; used when closing a workspace
    pub fn clear_main(&self) {
        *self.main.write() = None;
    }

    pub fn main_id(&self) -> Option<FileId> {
        *self.main.read()
    }

    pub fn has_main(&self) -> bool {
        self.main.read().is_some()
    }

    /// Convert an absolute path on disk to a workspace-local `FileId`.
    /// Returns `None` if the path is not inside the workspace root.
    #[allow(dead_code)] // used by the SAF/file-watch paths in phase 8
    pub fn path_to_id(&self, path: &Path) -> Option<FileId> {
        let root = self.root.read();
        let root = root.as_ref()?;
        let rel = path.strip_prefix(root).ok()?;
        local_file_id(rel)
    }

    /// Resolve a workspace-relative path (forward slashes) to a `FileId`.
    pub fn rel_to_id(&self, rel: &str) -> Result<FileId, String> {
        local_file_id(Path::new(rel)).ok_or_else(|| format!("invalid path: {rel}"))
    }

    /// Map a FileId back to an absolute path on disk. Package files resolve
    /// through `SystemPackages::obtain` (downloading on demand).
    pub fn id_to_path(&self, id: FileId) -> Result<PathBuf, FileError> {
        let vpath = id.vpath();
        match id.root() {
            VirtualRoot::Package(spec) => {
                let root = self.packages.obtain(spec).map_err(FileError::Package)?;
                Ok(root.path().join(vpath.get_without_slash()))
            }
            VirtualRoot::Project => {
                let root = self
                    .root
                    .read()
                    .clone()
                    .ok_or_else(|| FileError::Other(Some(EcoString::from("no workspace open"))))?;
                Ok(root.join(vpath.get_without_slash()))
            }
        }
    }

    /// Clear all per-compile caches so the next compile re-reads from disk.
    pub fn reset(&self) {
        self.slots.lock().clear();
        *self.now.lock() = None;
    }

    /// Run `f` with `text` temporarily installed as the source for `id`. Used
    /// by `get_completions` to evaluate against the live (unsaved) buffer
    /// without a persistent shadow concept.
    pub fn with_overlay<T>(&self, id: FileId, text: &str, f: impl FnOnce(&Self) -> T) -> T {
        self.overlay.write().insert(id, text.to_string());
        // Drop any cached source for this id so the overlay is observed.
        self.slots.lock().remove(&id);
        let out = f(self);
        self.overlay.write().remove(&id);
        self.slots.lock().remove(&id);
        out
    }

    fn read_file_bytes(&self, id: FileId) -> FileResult<Vec<u8>> {
        let path = self.id_to_path(id)?;
        std::fs::read(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                FileError::NotFound(path)
            } else {
                FileError::AccessDenied
            }
        })
    }
}

impl World for MobileWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        // Copy the `&'static FontStore` out of the guard so the returned
        // reference isn't tied to the lock guard's lifetime.
        let store: &'static FontStore = *self.font_store.read();
        store.book()
    }

    fn main(&self) -> FileId {
        self.main.read().unwrap_or_else(Self::fallback_main)
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if let Some(FileSlot::Source(src)) = self.slots.lock().get(&id) {
            return Ok(src.clone());
        }
        let text = if let Some(content) = self.overlay.read().get(&id) {
            content.clone()
        } else {
            let bytes = self.read_file_bytes(id)?;
            String::from_utf8(bytes).map_err(|_| FileError::AccessDenied)?
        };
        let source = Source::new(id, text);
        self.slots
            .lock()
            .insert(id, FileSlot::Source(source.clone()));
        Ok(source)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(FileSlot::Bytes(bytes)) = self.slots.lock().get(&id) {
            return Ok(bytes.clone());
        }
        let bytes = Bytes::new(self.read_file_bytes(id)?);
        self.slots.lock().insert(id, FileSlot::Bytes(bytes.clone()));
        Ok(bytes)
    }

    fn font(&self, index: usize) -> Option<Font> {
        let store: &'static FontStore = *self.font_store.read();
        store.font(index)
    }

    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        let mut now = self.now.lock();
        let utc_now = *now.get_or_insert_with(chrono::Utc::now);
        today_with_offset(utc_now, offset)
    }
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
/// Pure and runtime-free so it can be unit-tested without a typst `Duration`.
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

impl IdeWorld for MobileWorld {
    fn upcast(&self) -> &dyn World {
        self
    }

    fn packages(&self) -> &[(PackageSpec, Option<EcoString>)] {
        self.package_index
            .get_or_init(|| fetch_package_index(&self.index_downloader))
            .as_slice()
    }

    fn files(&self) -> Vec<FileId> {
        // `FileId` is not `Ord` in 0.15 — dedupe through a set instead.
        let mut ids = std::collections::HashSet::new();
        ids.extend(self.slots.lock().keys().copied());
        ids.extend(self.overlay.read().keys().copied());
        ids.into_iter().collect()
    }
}

/// Download and parse the Typst preview package index. Returns an empty vec on
/// any network or parse error (cached, so we don't retry per keystroke).
fn fetch_package_index(downloader: &SystemDownloader) -> Vec<(PackageSpec, Option<EcoString>)> {
    const INDEX_URL: &str = "https://packages.typst.org/preview/index.json";
    // The `&dyn Any` download key matches the convention typst-kit uses for
    // the index; this downloader has no progress wrapper, so it's irrelevant.
    let data = match downloader.download(&"package index", INDEX_URL) {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    let json: serde_json::Value = match serde_json::from_slice(&data) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let Some(array) = json.as_array() else {
        return vec![];
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
            Some((
                PackageSpec {
                    namespace: EcoString::from("preview"),
                    name: EcoString::from(name),
                    version,
                },
                description,
            ))
        })
        .collect();
    info!("package_index: fetched {} packages", packages.len());
    packages
}

#[cfg(test)]
mod tests {
    use super::today_from_secs;
    use chrono::{TimeZone, Utc};

    const HOUR: i32 = 3600;

    fn ymd(dt: typst::foundations::Datetime) -> (i32, u8, u8) {
        (dt.year().unwrap(), dt.month().unwrap(), dt.day().unwrap())
    }

    #[test]
    fn today_offset_shifts_the_calendar_day() {
        // 2026-06-11 23:30 UTC: still June 11 at UTC, but past midnight east.
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        assert_eq!(ymd(today_from_secs(now, Some(0)).unwrap()), (2026, 6, 11));
        assert_eq!(ymd(today_from_secs(now, Some(HOUR)).unwrap()), (2026, 6, 12));
        assert_eq!(ymd(today_from_secs(now, Some(-HOUR)).unwrap()), (2026, 6, 11));
    }

    #[test]
    fn today_absurd_offset_returns_none_without_panic() {
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        assert!(today_from_secs(now, Some(HOUR * 24 * 365)).is_none());
        assert!(today_from_secs(now, Some(-HOUR * 24 * 365)).is_none());
    }

    #[test]
    fn today_none_offset_resolves() {
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        assert!(today_from_secs(now, None).is_some());
    }
}
