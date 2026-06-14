// world.rs
//
// `MobileWorld` — implements `typst::World` + `typst_ide::IdeWorld`. A lean
// reimagining of the desktop `EditorWorld`: embedded fonts plus any user-picked
// app-wide font folder (loaded synchronously at startup — directory fonts via
// `FontSearcher`, SAF-tree fonts as raw buffers), plain `std::fs` reads, and a slot
// cache that is fully cleared at the start of every compile (`reset()`), so
// edited files are always re-read from disk — disk is the source of truth.

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
    download::{Downloader, Progress},
    fonts::{FontSearcher, FontSlot},
    package::PackageStorage,
};

/// No-op download progress. v1 has no package-download UI (phase 8 adds one).
struct NoProgress;
impl Progress for NoProgress {
    fn print_start(&mut self) {}
    fn print_progress(&mut self, _state: &typst_kit::download::DownloadState) {}
    fn print_finish(&mut self, _state: &typst_kit::download::DownloadState) {}
}

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
    book: LazyHash<FontBook>,
    /// Embedded + directory-searched font slots, index-aligned with the first
    /// `fonts.len()` entries of `book`.
    fonts: Vec<FontSlot>,
    /// Eagerly-loaded fonts read from a SAF tree (Android), index-aligned with
    /// the book entries that follow the `fonts` slots.
    extra_fonts: Vec<Font>,
    /// File slot cache: FileId -> (Source | Bytes). Cleared by `reset()`.
    slots: Mutex<HashMap<FileId, FileSlot>>,
    /// Transient per-call overlay (used by `with_overlay` for completions).
    overlay: RwLock<HashMap<FileId, String>>,
    package_storage: PackageStorage,
    downloader: Downloader,
    package_index: OnceLock<Vec<(PackageSpec, Option<EcoString>)>>,
    /// "Now" (UTC instant), chosen once per compile so a document compiled
    /// across midnight doesn't straddle two dates. Cleared by `reset()`.
    now: Mutex<Option<chrono::DateTime<chrono::Utc>>>,
}

impl MobileWorld {
    /// Fallback `FileId` returned from `World::main()` when no main file is set.
    /// Compilation is gated on `has_main()`, so this is never actually compiled.
    fn fallback_main() -> FileId {
        FileId::new(None, VirtualPath::new("<no-main>"))
    }

    pub fn new(
        package_cache: Option<PathBuf>,
        package_dir: Option<PathBuf>,
        extra_font_dirs: Vec<PathBuf>,
        extra_font_buffers: Vec<Vec<u8>>,
    ) -> Self {
        let t = Instant::now();
        // Embedded fonts + any user-selected app-wide font folders. No system
        // scan (deterministic, fast). Extra dirs are loaded recursively.
        let fonts = FontSearcher::new()
            .include_system_fonts(false)
            .search_with(&extra_font_dirs);

        // Fonts read out of a SAF tree (Android) arrive as raw bytes; register
        // each face into the book, index-aligned after the searched slots.
        let mut book = fonts.book;
        let mut extra_fonts = Vec::new();
        for buffer in extra_font_buffers {
            let bytes = Bytes::new(buffer);
            for font in Font::iter(bytes.clone()) {
                book.push(font.info().clone());
                extra_fonts.push(font);
            }
        }

        info!(
            "MobileWorld::new: {} fonts (+{} dir(s), +{} from picked folder) ({:.1}ms)",
            fonts.fonts.len() + extra_fonts.len(),
            extra_font_dirs.len(),
            extra_fonts.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        let user_agent = "typwriter-mobile".to_string();
        let downloader = Downloader::new(user_agent.clone());
        let package_storage =
            PackageStorage::new(package_cache, package_dir, Downloader::new(user_agent));
        Self {
            root: RwLock::new(None),
            main: RwLock::new(None),
            library: LazyHash::new(Library::builder().with_features(Features::default()).build()),
            book: LazyHash::new(book),
            fonts: fonts.fonts,
            extra_fonts,
            slots: Mutex::new(HashMap::new()),
            overlay: RwLock::new(HashMap::new()),
            package_storage,
            downloader,
            package_index: OnceLock::new(),
            now: Mutex::new(None),
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
        Some(FileId::new(None, VirtualPath::new(rel)))
    }

    /// Resolve a workspace-relative path (forward slashes) to a `FileId`.
    pub fn rel_to_id(&self, rel: &str) -> FileId {
        FileId::new(None, VirtualPath::new(rel))
    }

    /// Map a FileId back to an absolute path on disk. Package files resolve
    /// through `PackageStorage::prepare_package` (downloading on demand).
    pub fn id_to_path(&self, id: FileId) -> Result<PathBuf, FileError> {
        let vpath = id.vpath();
        if let Some(spec) = id.package() {
            let pkg_dir = self
                .package_storage
                .prepare_package(spec, &mut NoProgress)
                .map_err(FileError::Package)?;
            Ok(pkg_dir.join(vpath.as_rootless_path()))
        } else {
            let root = self
                .root
                .read()
                .clone()
                .ok_or_else(|| FileError::Other(Some(EcoString::from("no workspace open"))))?;
            Ok(root.join(vpath.as_rootless_path()))
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
        &self.book
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
        // The book lists searched slots first, then the eagerly-loaded SAF
        // fonts; mirror that split here.
        match self.fonts.get(index) {
            Some(slot) => slot.get(),
            None => self.extra_fonts.get(index - self.fonts.len()).cloned(),
        }
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let mut now = self.now.lock();
        let utc_now = *now.get_or_insert_with(chrono::Utc::now);
        today_with_offset(utc_now, offset)
    }
}

/// Resolve "today" for `World::today`. Typst defines `offset` as the UTC offset
/// in whole hours; `None` means local time. Pure so it can be unit-tested.
fn today_with_offset(
    utc_now: chrono::DateTime<chrono::Utc>,
    offset: Option<i64>,
) -> Option<Datetime> {
    use chrono::{FixedOffset, Local};
    let (year, month, day) = match offset {
        None => {
            let now = utc_now.with_timezone(&Local);
            (now.year(), now.month(), now.day())
        }
        Some(hours) => {
            let secs = i32::try_from(hours).ok()?.checked_mul(3600)?;
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
            .get_or_init(|| fetch_package_index(&self.downloader))
            .as_slice()
    }

    fn files(&self) -> Vec<FileId> {
        let mut ids: Vec<FileId> = self.slots.lock().keys().copied().collect();
        ids.extend(self.overlay.read().keys().copied());
        ids.sort();
        ids.dedup();
        ids
    }
}

/// Download and parse the Typst preview package index. Returns an empty vec on
/// any network or parse error (cached, so we don't retry per keystroke).
fn fetch_package_index(downloader: &Downloader) -> Vec<(PackageSpec, Option<EcoString>)> {
    const INDEX_URL: &str = "https://packages.typst.org/preview/index.json";
    let response = match downloader.download(INDEX_URL) {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    let json: serde_json::Value = match response.into_json() {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let Some(array) = json.as_array() else {
        return vec![];
    };
    array
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
        .collect()
}

#[cfg(test)]
mod tests {
    use super::today_with_offset;
    use chrono::{TimeZone, Utc};

    fn ymd(dt: typst::foundations::Datetime) -> (i32, u8, u8) {
        (dt.year().unwrap(), dt.month().unwrap(), dt.day().unwrap())
    }

    #[test]
    fn today_offset_is_hours_not_days() {
        // 2026-06-11 23:30 UTC: June 11 at UTC, past midnight one hour east.
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        assert_eq!(ymd(today_with_offset(now, Some(0)).unwrap()), (2026, 6, 11));
        assert_eq!(ymd(today_with_offset(now, Some(1)).unwrap()), (2026, 6, 12));
        assert_eq!(ymd(today_with_offset(now, Some(-1)).unwrap()), (2026, 6, 11));
    }

    #[test]
    fn today_none_offset_resolves() {
        let now = Utc.with_ymd_and_hms(2026, 6, 11, 23, 30, 0).unwrap();
        assert!(today_with_offset(now, None).is_some());
    }
}
