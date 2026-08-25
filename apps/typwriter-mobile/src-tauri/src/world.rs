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
    sync::{
        atomic::{AtomicUsize, Ordering},
        OnceLock,
    },
    time::{Duration as StdDuration, SystemTime},
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

/// What the filesystem looked like when a slot was filled. Compared at the
/// start of each compile to decide whether the slot is still good — see
/// [`MobileWorld::revalidate`].
///
/// `mtime` is `Option` because not every Android filesystem reports one; when
/// it is missing the length alone still catches most edits, and an edit that
/// changes neither length nor mtime is one the editor made through
/// `apply_saved_source`, which refreshes the slot directly.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct FileStamp {
    len: u64,
    mtime: Option<SystemTime>,
}

impl FileStamp {
    fn of(path: &Path) -> Option<Self> {
        let meta = std::fs::metadata(path).ok()?;
        Some(Self {
            len: meta.len(),
            mtime: meta.modified().ok(),
        })
    }

    /// Whether a slot stamped `self` can still be trusted against `fresh`.
    ///
    /// A missing mtime means "cannot prove unchanged": length on its own is too
    /// weak (a same-length external edit — `cat` → `dog` — would slip through),
    /// so we deliberately fail closed and re-read. Disk stays the source of
    /// truth; the stamp is only ever allowed to *skip* work it can prove is
    /// unnecessary.
    fn still_valid_for(&self, fresh: &FileStamp) -> bool {
        self.mtime.is_some() && self.mtime == fresh.mtime && self.len == fresh.len
    }
}

/// A cached file plus the stamp it was read at. Package files carry no stamp:
/// a package version is immutable, so its slot never needs revalidating.
struct CachedFile {
    slot: FileSlot,
    stamp: Option<FileStamp>,
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
    /// Background font loads currently running. Distinct from `fonts_ready`,
    /// which is the one-shot startup gate the compile pipeline waits on: this
    /// goes back up on every re-pick, so settings can tell "still loading" from
    /// "finished, and that was all the folder had".
    font_loads: AtomicUsize,
    /// File slot cache: FileId -> (Source | Bytes) plus the stamp it was read
    /// at. Revalidated (not cleared) at the start of each compile — see
    /// [`MobileWorld::revalidate`].
    slots: Mutex<HashMap<FileId, CachedFile>>,
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
    /// across midnight doesn't straddle two dates. Cleared by `revalidate()`.
    now: Mutex<Option<chrono::DateTime<chrono::Utc>>>,
}

/// Absolute path of a **project-rooted** file, or `None` for a package file.
///
/// Deliberately does not go through [`MobileWorld::id_to_path`]: that resolves
/// packages via `SystemPackages::obtain`, which can hit the network. Callers
/// here only want the cheap join, and treat `None` as "not ours to revalidate".
fn project_path(root: &Path, id: FileId) -> Option<PathBuf> {
    match id.root() {
        VirtualRoot::Project => Some(root.join(id.vpath().get_without_slash())),
        VirtualRoot::Package(_) => None,
    }
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
            library: LazyHash::new(
                Library::builder()
                    .with_features(Features::default())
                    .build(),
            ),
            font_store: RwLock::new(Box::leak(Box::new(embedded))),
            fonts_ready: Mutex::new(false),
            fonts_cv: Condvar::new(),
            font_loads: AtomicUsize::new(0),
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

    /// Mark a background font load as started. Paired with [`Self::end_font_load`].
    pub fn begin_font_load(&self) {
        self.font_loads.fetch_add(1, Ordering::SeqCst);
    }

    /// Mark a background font load as finished.
    pub fn end_font_load(&self) {
        // Saturating: an unpaired end must not wrap the counter into "loading
        // forever".
        let _ = self
            .font_loads
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                Some(n.saturating_sub(1))
            });
    }

    /// Whether a background font load is still running. Settings polls this so
    /// a slow SAF walk reads as "loading", not as "the folder was empty".
    pub fn fonts_loading(&self) -> bool {
        self.font_loads.load(Ordering::SeqCst) > 0
    }

    /// How many font families the compiler can currently use. Surfaced in
    /// settings so "my fonts aren't loading" has an answer the user can read
    /// without going through `adb logcat`.
    pub fn font_family_count(&self) -> usize {
        let store: &'static FontStore = *self.font_store.read();
        store.book().families().count()
    }

    /// Block until the background font load has installed the full font set,
    /// or until the timeout elapses (a hung SAF read must never freeze the
    /// compile pipeline forever — after the timeout we compile with whatever
    /// set is installed).
    ///
    /// Returns whether the full set actually arrived. `false` means the compile
    /// is about to run against the embedded-only fonts, which the caller should
    /// say out loud: from the user's side an unexplained ten-second stall
    /// followed by the wrong typeface is indistinguishable from a hang.
    #[must_use]
    pub fn wait_for_fonts(&self, timeout: StdDuration) -> bool {
        let mut ready = self.fonts_ready.lock();
        if !*ready {
            let _ = self.fonts_cv.wait_for(&mut ready, timeout);
        }
        *ready
    }

    /// Update the workspace root and flush all caches. Cached paths are
    /// resolved against the old root, so none of them survive a root change.
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

    /// Forget the main file — the document was deleted (or the workspace closed).
    pub fn clear_main(&self) {
        *self.main.write() = None;
    }

    pub fn main_id(&self) -> Option<FileId> {
        *self.main.read()
    }

    pub fn has_main(&self) -> bool {
        self.main.read().is_some()
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
                let root =
                    self.root.read().clone().ok_or_else(|| {
                        FileError::Other(Some(EcoString::from("no workspace open")))
                    })?;
                Ok(root.join(vpath.get_without_slash()))
            }
        }
    }

    /// Prepare the world for a compile.
    ///
    /// Disk stays the source of truth, but *proving* that a cached slot still
    /// matches disk is a `stat`, not a re-read. The previous implementation
    /// cleared every slot, which meant each compile re-read and fully reparsed
    /// every source file, every imported file, and every package file — so no
    /// compile was ever incremental and typst's memoization had nothing to
    /// reuse. This keeps slots that are provably unchanged and refreshes only
    /// the rest.
    ///
    /// A source whose bytes did change is updated with [`Source::replace`]
    /// rather than reparsed from scratch, preserving the untouched syntax nodes
    /// (and their span numbers) that comemo keys its memoized work on.
    ///
    /// Package files are immutable for a given version, so they are never
    /// stat'ed and never dropped.
    pub fn revalidate(&self) {
        *self.now.lock() = None;

        let Some(root) = self.root.read().clone() else {
            // No workspace: nothing project-rooted can be valid.
            self.slots.lock().clear();
            return;
        };

        let mut slots = self.slots.lock();
        slots.retain(|id, cached| {
            let Some(path) = project_path(&root, *id) else {
                // Package file — immutable, always keep.
                return true;
            };
            let Some(fresh) = FileStamp::of(&path) else {
                // Gone or unreadable: drop so the compile surfaces the real
                // error from `read_file_bytes` instead of stale content.
                return false;
            };
            if cached
                .stamp
                .is_some_and(|stamp| stamp.still_valid_for(&fresh))
            {
                return true;
            }
            match &mut cached.slot {
                FileSlot::Source(source) => {
                    // Re-read and reparse incrementally. On a read failure drop
                    // the slot and let the compile report it.
                    let Ok(bytes) = std::fs::read(&path) else {
                        return false;
                    };
                    let Ok(text) = String::from_utf8(bytes) else {
                        return false;
                    };
                    source.replace(&text);
                    cached.stamp = Some(fresh);
                    true
                }
                // Binary assets have no incremental representation; drop and
                // let `file()` re-read lazily, only if the document still uses it.
                FileSlot::Bytes(_) => false,
            }
        });
    }

    /// Refresh the cached tree for a file the app itself just wrote.
    ///
    /// The editor already holds the exact bytes it saved, so this skips the
    /// re-read entirely and applies them incrementally. Without it the save
    /// would change the file's stamp and `revalidate` would re-read from disk —
    /// correct, but a wasted read of content we were just handed.
    pub fn apply_saved_source(&self, id: FileId, text: &str) {
        let Some(root) = self.root.read().clone() else {
            return;
        };
        let Some(path) = project_path(&root, id) else {
            return;
        };
        let stamp = FileStamp::of(&path);
        let mut slots = self.slots.lock();
        if let Some(CachedFile {
            slot: FileSlot::Source(source),
            stamp: cached_stamp,
        }) = slots.get_mut(&id)
        {
            source.replace(text);
            *cached_stamp = stamp;
            return;
        }
        // Either nothing cached, or it was cached as a binary asset and is now
        // being written as text. Both resolve to a fresh source slot.
        slots.insert(
            id,
            CachedFile {
                slot: FileSlot::Source(Source::new(id, text.to_string())),
                stamp,
            },
        );
    }

    /// Drop every cached slot. Used when the workspace root changes, where no
    /// previously cached path can still be meaningful.
    pub fn clear_cache(&self) {
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

    /// Stamp for a project-rooted file, or `None` for a package file (immutable
    /// for its version, so it is never revalidated).
    fn stamp_for(&self, id: FileId) -> Option<FileStamp> {
        let root = self.root.read().clone()?;
        FileStamp::of(&project_path(&root, id)?)
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
        if let Some(CachedFile {
            slot: FileSlot::Source(src),
            ..
        }) = self.slots.lock().get(&id)
        {
            return Ok(src.clone());
        }
        // An overlay is a transient in-memory buffer with no file behind it, so
        // it gets no stamp — `revalidate` would otherwise compare it against
        // the on-disk file and drop it. `with_overlay` clears the slot on the
        // way out either way.
        let (text, stamp) = if let Some(content) = self.overlay.read().get(&id) {
            (content.clone(), None)
        } else {
            let bytes = self.read_file_bytes(id)?;
            let text = String::from_utf8(bytes).map_err(|_| FileError::AccessDenied)?;
            (text, self.stamp_for(id))
        };
        let source = Source::new(id, text);
        self.slots.lock().insert(
            id,
            CachedFile {
                slot: FileSlot::Source(source.clone()),
                stamp,
            },
        );
        Ok(source)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(CachedFile {
            slot: FileSlot::Bytes(bytes),
            ..
        }) = self.slots.lock().get(&id)
        {
            return Ok(bytes.clone());
        }
        let bytes = Bytes::new(self.read_file_bytes(id)?);
        let stamp = self.stamp_for(id);
        self.slots.lock().insert(
            id,
            CachedFile {
                slot: FileSlot::Bytes(bytes.clone()),
                stamp,
            },
        );
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
    use super::{local_file_id, project_path, today_from_secs, FileStamp, MobileWorld};
    use chrono::{TimeZone, Utc};
    use std::path::{Path, PathBuf};
    use std::time::SystemTime;
    use typst::syntax::{FileId, VirtualPath};
    use typst::World;

    const HOUR: i32 = 3600;

    // ─── Slot revalidation ──────────────────────────────────────────────────
    //
    // `revalidate` replaced a blanket cache clear. The clear was slow but
    // trivially correct, so these tests pin the property it guaranteed —
    // **disk is the source of truth** — alongside the caching it now does.
    // Every "picked up" test below passes under the old `reset()` too; they
    // exist so the optimization can't quietly start serving stale content.

    /// A workspace root under the OS temp dir, unique per test.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("typwriter-world-{tag}-{nanos}"));
            std::fs::create_dir_all(&dir).expect("create temp root");
            Self(dir)
        }

        fn write(&self, rel: &str, content: &str) {
            let path = self.0.join(rel);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("create parent");
            }
            std::fs::write(path, content).expect("write file");
        }

        fn remove(&self, rel: &str) {
            std::fs::remove_file(self.0.join(rel)).expect("remove file");
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A world rooted at `root`. Package dirs are `None` — no test here
    /// resolves a package, and that keeps the network out of the picture.
    fn world_at(root: &Path) -> MobileWorld {
        let world = MobileWorld::new(None, None);
        world.set_root(root.to_path_buf());
        world
    }

    fn id_of(rel: &str) -> FileId {
        local_file_id(Path::new(rel)).expect("valid virtual path")
    }

    /// Make a file's mtime differ from whatever it was, so a same-length edit
    /// is still detectable. Filesystem mtime granularity varies (ext4 is
    /// nanoseconds, FAT is two seconds), and tests must not depend on it.
    fn write_with_new_mtime(root: &TempRoot, rel: &str, content: &str) {
        root.write(rel, content);
        let path = root.0.join(rel);
        let bumped = SystemTime::now() + std::time::Duration::from_secs(10);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open for mtime bump");
        // `set_modified` is best-effort; where it is unsupported the content
        // length change below is what the test relies on.
        let _ = file.set_modified(bumped);
    }

    #[test]
    fn unchanged_file_keeps_its_cached_tree_across_revalidate() {
        // The point of the change: a compile must not re-read files it can
        // prove are unchanged. Asserted by deleting the file *after*
        // revalidate — a retained slot still answers, a cleared one cannot.
        let root = TempRoot::new("keep");
        root.write("main.typ", "= Title\n\nBody text.\n");
        let world = world_at(&root.0);
        let id = id_of("main.typ");

        assert!(world.source(id).is_ok());
        world.revalidate();
        root.remove("main.typ");

        let source = world
            .source(id)
            .expect("slot must survive revalidate when the file was unchanged");
        assert_eq!(source.text(), "= Title\n\nBody text.\n");
    }

    #[test]
    fn external_edit_is_picked_up_on_revalidate() {
        // The property the old blanket reset() guaranteed. This is the test
        // that must never be allowed to fail.
        let root = TempRoot::new("external");
        root.write("main.typ", "= Original\n");
        let world = world_at(&root.0);
        let id = id_of("main.typ");

        assert_eq!(world.source(id).unwrap().text(), "= Original\n");

        write_with_new_mtime(&root, "main.typ", "= Rewritten by another app\n");
        world.revalidate();

        assert_eq!(
            world.source(id).unwrap().text(),
            "= Rewritten by another app\n",
            "disk must remain the source of truth",
        );
    }

    #[test]
    fn same_length_external_edit_is_picked_up() {
        // Length alone cannot detect this one, so it exercises the mtime half
        // of the stamp.
        let root = TempRoot::new("samelen");
        root.write("main.typ", "= cat\n");
        let world = world_at(&root.0);
        let id = id_of("main.typ");

        assert_eq!(world.source(id).unwrap().text(), "= cat\n");

        write_with_new_mtime(&root, "main.typ", "= dog\n");
        world.revalidate();

        assert_eq!(world.source(id).unwrap().text(), "= dog\n");
    }

    #[test]
    fn deleted_file_drops_its_slot() {
        let root = TempRoot::new("deleted");
        root.write("main.typ", "= Here\n");
        let world = world_at(&root.0);
        let id = id_of("main.typ");

        assert!(world.source(id).is_ok());
        root.remove("main.typ");
        world.revalidate();

        assert!(
            world.source(id).is_err(),
            "a deleted file must surface as an error, not stale cached content",
        );
    }

    #[test]
    fn binary_assets_are_revalidated_too() {
        // Images go through `file()`, not `source()`, and have no incremental
        // representation — the slot is dropped and re-read.
        let root = TempRoot::new("bytes");
        root.write("logo.svg", "<svg>one</svg>");
        let world = world_at(&root.0);
        let id = id_of("logo.svg");

        assert_eq!(&*world.file(id).unwrap(), b"<svg>one</svg>");

        write_with_new_mtime(&root, "logo.svg", "<svg>two-longer</svg>");
        world.revalidate();

        assert_eq!(&*world.file(id).unwrap(), b"<svg>two-longer</svg>");
    }

    #[test]
    fn saved_content_is_folded_in_without_a_reread() {
        // `apply_saved_source` is the app's own write path. After it, a
        // revalidate must leave the freshly stamped slot alone.
        let root = TempRoot::new("saved");
        root.write("main.typ", "= Before\n");
        let world = world_at(&root.0);
        let id = id_of("main.typ");

        assert_eq!(world.source(id).unwrap().text(), "= Before\n");

        // Simulates save_file: bytes hit disk, then the cache is told.
        write_with_new_mtime(&root, "main.typ", "= After the save\n");
        world.apply_saved_source(id, "= After the save\n");
        world.revalidate();

        assert_eq!(world.source(id).unwrap().text(), "= After the save\n");
    }

    #[test]
    fn saved_content_for_an_uncached_file_is_still_installed() {
        let root = TempRoot::new("saved-cold");
        root.write("new.typ", "= Fresh\n");
        let world = world_at(&root.0);
        let id = id_of("new.typ");

        world.apply_saved_source(id, "= Fresh\n");

        assert_eq!(world.source(id).unwrap().text(), "= Fresh\n");
    }

    #[test]
    fn revalidate_is_scoped_to_the_file_that_changed() {
        let root = TempRoot::new("scoped");
        root.write("main.typ", "= Main\n");
        root.write("chapter.typ", "= Chapter\n");
        let world = world_at(&root.0);
        let (main, chapter) = (id_of("main.typ"), id_of("chapter.typ"));

        assert!(world.source(main).is_ok());
        assert!(world.source(chapter).is_ok());

        write_with_new_mtime(&root, "chapter.typ", "= Chapter, revised\n");
        world.revalidate();
        // Untouched file keeps its slot: deleting it now must not matter.
        root.remove("main.typ");

        assert_eq!(world.source(main).unwrap().text(), "= Main\n");
        assert_eq!(world.source(chapter).unwrap().text(), "= Chapter, revised\n");
    }

    #[test]
    fn clearing_the_cache_forces_a_reread() {
        let root = TempRoot::new("clear");
        root.write("main.typ", "= One\n");
        let world = world_at(&root.0);
        let id = id_of("main.typ");

        assert!(world.source(id).is_ok());
        world.clear_cache();
        root.remove("main.typ");

        assert!(world.source(id).is_err());
    }

    #[test]
    fn changing_the_root_drops_every_slot() {
        // Cached paths resolve against the old root, so none may survive.
        let old = TempRoot::new("root-old");
        let new = TempRoot::new("root-new");
        old.write("main.typ", "= Old workspace\n");
        new.write("main.typ", "= New workspace\n");

        let world = world_at(&old.0);
        let id = id_of("main.typ");
        assert_eq!(world.source(id).unwrap().text(), "= Old workspace\n");

        world.set_root(new.0.clone());

        assert_eq!(world.source(id).unwrap().text(), "= New workspace\n");
    }

    #[test]
    fn stamp_without_mtime_is_never_considered_valid() {
        // Fail-closed: if the filesystem won't tell us when a file changed, we
        // re-read rather than trust the length.
        let no_mtime = FileStamp {
            len: 42,
            mtime: None,
        };
        assert!(!no_mtime.still_valid_for(&no_mtime));

        let now = SystemTime::now();
        let with_mtime = FileStamp {
            len: 42,
            mtime: Some(now),
        };
        assert!(with_mtime.still_valid_for(&with_mtime));
        assert!(!with_mtime.still_valid_for(&FileStamp {
            len: 43,
            mtime: Some(now),
        }));
    }

    #[test]
    fn package_files_are_not_project_paths() {
        // Package slots are never stat'ed or dropped: a package version is
        // immutable, and resolving its path can hit the network.
        use ecow::EcoString;
        use typst::syntax::package::{PackageSpec, PackageVersion};
        use typst::syntax::{RootedPath, VirtualRoot};

        let spec = PackageSpec {
            namespace: EcoString::from("preview"),
            name: EcoString::from("cetz"),
            version: PackageVersion {
                major: 0,
                minor: 3,
                patch: 1,
            },
        };
        let package_id = RootedPath::new(
            VirtualRoot::Package(spec),
            VirtualPath::new("lib.typ").unwrap(),
        )
        .intern();

        let root = Path::new("/workspace");
        assert!(project_path(root, package_id).is_none());
        assert!(project_path(root, id_of("main.typ")).is_some());
    }

    fn ymd(dt: typst::foundations::Datetime) -> (i32, u8, u8) {
        (dt.year().unwrap(), dt.month().unwrap(), dt.day().unwrap())
    }

    #[test]
    fn today_offset_shifts_the_calendar_day() {
        // 2026-06-11 23:30 UTC: still June 11 at UTC, but past midnight east.
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        assert_eq!(ymd(today_from_secs(now, Some(0)).unwrap()), (2026, 6, 11));
        assert_eq!(
            ymd(today_from_secs(now, Some(HOUR)).unwrap()),
            (2026, 6, 12)
        );
        assert_eq!(
            ymd(today_from_secs(now, Some(-HOUR)).unwrap()),
            (2026, 6, 11)
        );
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
