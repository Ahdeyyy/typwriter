use std::collections::HashMap;
use std::fs::metadata;
use std::mem;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
// use tauri::path::BaseDirectory;
use chrono::{DateTime, Datelike, FixedOffset, Local, Utc};
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, World};
use typst_kit::download::Downloader;
use typst_kit::fonts::{FontSlot, Fonts};
use typst_kit::package::PackageStorage;
use typst_timing::timed;

// favor the simple world implementation for now
// this has a bug where the ui and the compiler world can get out of sync

/// A simple print download progress implementation that does nothing.
struct PrintDownload;

impl typst_kit::download::Progress for PrintDownload {
    fn print_start(&mut self) {
        // Do nothing - as requested
    }

    fn print_progress(&mut self, _state: &typst_kit::download::DownloadState) {
        // Do nothing - as requested
    }

    fn print_finish(&mut self, _state: &typst_kit::download::DownloadState) {
        // Do nothing - as requested
    }
}

/// The current date and time.
enum Now {
    /// The date and time if the environment `SOURCE_DATE_EPOCH` is set.
    /// Used for reproducible builds.
    Fixed(DateTime<Utc>),
    /// The current date and time if the time is not externally fixed.
    System(OnceLock<DateTime<Utc>>),
}

/// A minimal in-memory World implementation for Typst used by the app.
pub struct TypstWorld {
    root: PathBuf,
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    main: Option<FileId>,
    sources: HashMap<FileId, Source>,
    files: HashMap<FileId, Bytes>,
    /// Maps file ids to source files and buffers.
    slots: Mutex<HashMap<FileId, FileSlot>>,
    fonts: Vec<FontSlot>,
    package_storage: PackageStorage,
    now: Now,
}

impl TypstWorld {
    /// Create a new TypstWorld with empty in-memory storage.
    pub fn new(root: PathBuf) -> Self {
        let fonts = Fonts::searcher()
            .include_system_fonts(true)
            .search_with(["../assets/fonts"]);

        let downloader = Downloader::new("typwriter-app/0.1.0");

        let package_store = PackageStorage::new(None, None, downloader);

        Self {
            root,
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(fonts.book),
            main: Some(FileId::new(None, VirtualPath::new("main.typ"))),
            sources: HashMap::new(),
            files: HashMap::new(),
            fonts: fonts.fonts,
            now: Now::System(OnceLock::new()),
            package_storage: package_store,
            slots: Mutex::new(HashMap::default()),
        }
    }

    pub fn set_main_source(&mut self, name: &str, src: String) -> FileId {
        // Create a new FileId for the virtual path and register the source.
        let id = FileId::new(None, VirtualPath::new(name));
        let source = Source::detached(src);
        self.sources.insert(id, source);
        self.main = Some(id);
        id
    }

    pub fn add_file(&mut self, name: &str, data: Bytes) -> FileId {
        let id = FileId::new(None, VirtualPath::new(name));
        self.files.insert(id, data);
        id
    }

    // from typst cli

    /// Return all paths the last compilation depended on.
    pub fn dependencies(&mut self) -> impl Iterator<Item = PathBuf> + '_ {
        self.slots
            .get_mut()
            .expect("slots lock poisoned")
            .values()
            .filter(|slot| slot.accessed())
            .filter_map(|slot| system_path(&self.root, slot.id, &self.package_storage).ok())
    }

    /// Reset the compilation state in preparation of a new compilation.
    pub fn reset(&mut self) {
        #[allow(clippy::iter_over_hash_type, reason = "order does not matter")]
        for slot in self
            .slots
            .get_mut()
            .expect("slots lock poisoned")
            .values_mut()
        {
            slot.reset();
        }
        if let Now::System(time_lock) = &mut self.now {
            time_lock.take();
        }
    }

    // /// Lookup line metadata for a file by id.
    // #[track_caller]
    // pub fn lookup(&self, id: FileId) -> Lines<String> {
    //     self.slot(id, |slot| {
    //         if let Some(source) = slot.source.get() {
    //             let source = source.as_ref().expect("file is not valid");
    //             source.lines().clone()
    //         } else if let Some(bytes) = slot.file.get() {
    //             let bytes = bytes.as_ref().expect("file is not valid");
    //             Lines::try_from(bytes).expect("file is not valid utf-8")
    //         } else {
    //             panic!("file id does not point to any source file");
    //         }
    //     })
    // }

    fn load_fonts() -> Vec<Font> {
        let mut fonts = Vec::new();
        dbg!("loading fonts");

        // Load system fonts
        #[cfg(target_os = "linux")]
        let mut font_paths = vec!["/usr/share/fonts", "/usr/local/share/fonts", "~/.fonts"];

        #[cfg(target_os = "macos")]
        let mut font_paths = vec!["/System/Library/Fonts", "/Library/Fonts", "~/Library/Fonts"];

        #[cfg(target_os = "windows")]
        let font_paths = vec!["../assets/fonts", "C:\\Windows\\Fonts"];

        for path in font_paths {
            dbg!(path);

            match std::fs::read_dir(path) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        // dbg!("entry");
                        let data = std::fs::read(&entry.path()).map(|e| Bytes::new(e)).ok();
                        // dbg!("gotten fonts");
                        if let Some(data) = data {
                            for font in Font::iter(data) {
                                fonts.push(font);
                            }
                        }
                    }
                }
                Err(e) => {
                    dbg!(e);
                    continue;
                }
            }
        }

        fonts
    }
}

impl World for TypstWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        // Prefer an explicitly set main file. If none is set, use the first
        // source that was registered. If no sources exist, return the
        // default FileId (the Typst runtime can decide what that means).
        self.main
            .or_else(|| self.sources.keys().cloned().next())
            .unwrap_or(FileId::new(None, VirtualPath::new("main.typ")))
    }

    // fn source(&self, id: FileId) -> Result<Source, FileError> {
    //     self.sources.get(&id).cloned().ok_or(FileError::NotSource)
    // }

    // fn file(&self, id: FileId) -> Result<Bytes, FileError> {
    //     self.files
    //         .get(&id)
    //         .cloned()
    //         .ok_or(FileError::NotFound(PathBuf::new()))
    // }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.slot(id, |slot| slot.source(&self.root, &self.package_storage))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.slot(id, |slot| slot.file(&self.root, &self.package_storage))
    }

    fn font(&self, id: usize) -> Option<Font> {
        self.fonts.get(id)?.get()
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let now = match &self.now {
            Now::Fixed(time) => time,
            Now::System(time) => time.get_or_init(Utc::now),
        };

        // The time with the specified UTC offset, or within the local time zone.
        let with_offset = match offset {
            None => now.with_timezone(&Local).fixed_offset(),
            Some(hours) => {
                let seconds = i32::try_from(hours).ok()?.checked_mul(3600)?;
                now.with_timezone(&FixedOffset::east_opt(seconds)?)
            }
        };

        Datetime::from_ymd(
            with_offset.year(),
            with_offset.month().try_into().ok()?,
            with_offset.day().try_into().ok()?,
        )
    }
}

impl TypstWorld {
    /// Access the canonical slot for the given file id.
    fn slot<F, T>(&self, id: FileId, f: F) -> T
    where
        F: FnOnce(&mut FileSlot) -> T,
    {
        let mut map = self.slots.lock().expect("slots lock poisoned");
        f(map.entry(id).or_insert_with(|| FileSlot::new(id)))
    }
}

/// Holds the processed data for a file ID.
///
/// Both fields can be populated if the file is both imported and read().
struct FileSlot {
    /// The slot's file id.
    id: FileId,
    /// The lazily loaded and incrementally updated source file.
    source: SlotCell<Source>,
    /// The lazily loaded raw byte buffer.
    file: SlotCell<Bytes>,
}

impl FileSlot {
    /// Create a new file slot.
    fn new(id: FileId) -> Self {
        Self {
            id,
            file: SlotCell::new(),
            source: SlotCell::new(),
        }
    }

    /// Whether the file was accessed in the ongoing compilation.
    fn accessed(&self) -> bool {
        self.source.accessed() || self.file.accessed()
    }

    /// Marks the file as not yet accessed in preparation of the next
    /// compilation.
    fn reset(&mut self) {
        self.source.reset();
        self.file.reset();
    }

    /// Retrieve the source for this file.
    fn source(
        &mut self,
        project_root: &Path,
        package_storage: &PackageStorage,
    ) -> FileResult<Source> {
        self.source.get_or_init(
            || read(self.id, project_root, package_storage),
            |data, prev| {
                let text = decode_utf8(&data)?;
                if let Some(mut prev) = prev {
                    prev.replace(text);
                    Ok(prev)
                } else {
                    Ok(Source::new(self.id, text.into()))
                }
            },
        )
    }

    /// Retrieve the file's bytes.
    fn file(&mut self, project_root: &Path, package_storage: &PackageStorage) -> FileResult<Bytes> {
        self.file.get_or_init(
            || read(self.id, project_root, package_storage),
            |data, _| Ok(Bytes::new(data)),
        )
    }
}

/// Lazily processes data for a file.
struct SlotCell<T> {
    /// The processed data.
    data: Option<FileResult<T>>,
    /// A hash of the raw file contents / access error.
    fingerprint: u128,
    /// Whether the slot has been accessed in the current compilation.
    accessed: bool,
}

impl<T: Clone> SlotCell<T> {
    /// Creates a new, empty cell.
    fn new() -> Self {
        Self {
            data: None,
            fingerprint: 0,
            accessed: false,
        }
    }

    /// Whether the cell was accessed in the ongoing compilation.
    fn accessed(&self) -> bool {
        self.accessed
    }

    /// Marks the cell as not yet accessed in preparation of the next
    /// compilation.
    fn reset(&mut self) {
        self.accessed = false;
    }

    /// Gets the contents of the cell.
    fn get(&self) -> Option<&FileResult<T>> {
        self.data.as_ref()
    }

    /// Gets the contents of the cell or initialize them.
    fn get_or_init(
        &mut self,
        load: impl FnOnce() -> FileResult<Vec<u8>>,
        f: impl FnOnce(Vec<u8>, Option<T>) -> FileResult<T>,
    ) -> FileResult<T> {
        // If we accessed the file already in this compilation, retrieve it.
        if mem::replace(&mut self.accessed, true) {
            if let Some(data) = &self.data {
                return data.clone();
            }
        }

        // Read and hash the file.
        let result = timed!("loading file", load());
        let fingerprint = timed!("hashing file", typst::utils::hash128(&result));

        // If the file contents didn't change, yield the old processed data.
        if mem::replace(&mut self.fingerprint, fingerprint) == fingerprint {
            if let Some(data) = &self.data {
                return data.clone();
            }
        }

        let prev = self.data.take().and_then(Result::ok);
        let value = result.and_then(|data| f(data, prev));
        self.data = Some(value.clone());

        value
    }
}

/// Resolves the path of a file id on the system, downloading a package if
/// necessary.
fn system_path(
    project_root: &Path,
    id: FileId,
    package_storage: &PackageStorage,
) -> FileResult<PathBuf> {
    // Determine the root path relative to which the file path
    // will be resolved.
    let buf;
    let mut root = project_root;
    if let Some(spec) = id.package() {
        // Use the PrintDownload progress handler that does nothing
        buf = package_storage.prepare_package(spec, &mut PrintDownload)?;
        root = &buf;
    }

    // Join the path to the root. If it tries to escape, deny
    // access. Note: It can still escape via symlinks.
    id.vpath().resolve(root).ok_or(FileError::AccessDenied)
}

/// Reads a file from a `FileId`.
///
/// If the ID represents stdin it will read from standard input,
/// otherwise it gets the file path of the ID and reads the file from disk.
fn read(id: FileId, project_root: &Path, package_storage: &PackageStorage) -> FileResult<Vec<u8>> {
    read_from_disk(&system_path(project_root, id, package_storage)?)
}

/// Read a file from disk.
fn read_from_disk(path: &Path) -> FileResult<Vec<u8>> {
    let f = |e| FileError::from_io(e, path);
    if metadata(path).map_err(f)?.is_dir() {
        Err(FileError::IsDirectory)
    } else {
        std::fs::read(path).map_err(f)
    }
}

fn decode_utf8(buf: &[u8]) -> FileResult<&str> {
    // Remove UTF-8 BOM.
    Ok(std::str::from_utf8(
        buf.strip_prefix(b"\xef\xbb\xbf").unwrap_or(buf),
    )?)
}
