use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, World};

use chrono::{Datelike, Utc};
use typst::syntax::package::PackageSpec;
use typst_ide::IdeWorld;
use typst_kit::download::Downloader;
use typst_kit::fonts::{FontSlot, Fonts};
use typst_kit::package::PackageStorage;

use tokio::sync::RwLock;

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

// TODO: Implement caching of files on disk between compilations
// TODO: use within_root for virtual paths when creating FileIds for local files
/// A world for Typst compilation with file system access and package management.
///
/// This implementation provides the essential functionality for Typst compilation,
/// including:
/// - Reading files from the local file system.
/// - Caching of read files within a single compilation pass.
/// - Automatic discovery of system fonts.
/// - Support for downloading and using packages from the `@preview` namespace.
///
pub struct Typstworld {
    /// The root directory for the project.
    root: PathBuf,
    /// The `FileId` of the main source file.
    main: FileId,
    /// Typst's standard library.
    library: LazyHash<Library>,
    /// Metadata about discovered fonts.
    book: LazyHash<FontBook>,
    /// Slots for lazily loaded fonts.
    fonts: Vec<FontSlot>,
    /// A simple cache for files read during a single compilation.
    files: RwLock<HashMap<FileId, FileResult<Bytes>>>,
    file_paths: RwLock<HashMap<FileId, PathBuf>>,
    /// Manages the storage of downloaded packages.
    package_storage: PackageStorage,

    // map for files paths and their file_ids
    id_path_map: RwLock<HashMap<PathBuf, FileId>>,
}

impl Typstworld {
    /// Create a new `Typstworld`.
    ///
    /// - `main_path`: The path to the main Typst file to compile.
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        let vpath = VirtualPath::new("main.typ");

        let main_id = FileId::new(None, vpath);
        let fonts = Fonts::searcher()
            .include_system_fonts(true)
            .search_with([font_dir]);

        // Setup package storage. This will use the default cache directories
        // for Typst packages on the respective operating system.
        let downloader = Downloader::new("typwriter-app/0.1.0");

        let package_storage = PackageStorage::new(None, None, downloader);

        Self {
            root,
            main: main_id,
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(fonts.book),
            fonts: fonts.fonts,
            files: RwLock::new(HashMap::new()),
            package_storage,
            file_paths: RwLock::new(HashMap::new()),
            id_path_map: RwLock::new(HashMap::new()),
        }
    }

    /// Resets the world's cache.
    pub fn reset(&mut self) {
        self.files.blocking_write().clear();
    }

    pub fn update_source(&mut self, id: FileId, source: String) -> FileResult<()> {
        let bytes = Bytes::new(source.into_bytes());
        self.files.blocking_write().insert(id, Ok(bytes));
        Ok(())
    }

    pub fn set_main_source(&mut self, name: &str, source: String) -> FileId {
        let vpath = VirtualPath::new(name);
        self.main = FileId::new(None, vpath);
        self.files
            .blocking_write()
            .insert(self.main, Ok(Bytes::new(source.into_bytes())));

        self.main
    }

    pub fn set_main_source_with_id(&mut self, id: FileId, source: String) {
        self.main = id;
        self.files
            .blocking_write()
            .insert(self.main, Ok(Bytes::new(source.into_bytes())));
    }

    pub fn add_file(&mut self, name: &str, path: PathBuf, source: Bytes) -> FileId {
        let vpath = VirtualPath::new(name);
        let id = FileId::new(None, vpath);
        self.files.blocking_write().insert(id, Ok(source));
        self.file_paths.blocking_write().insert(id, path.clone());
        self.id_path_map.blocking_write().insert(path, id);
        id
    }

    pub fn get_file_id(&self, path: &PathBuf) -> Option<FileId> {
        self.id_path_map.blocking_read().get(path).cloned()
    }
}

impl IdeWorld for Typstworld {
    fn upcast(&self) -> &dyn World {
        self
    }
}

impl World for Typstworld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index)?.get()
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let now = Utc::now();
        let _ = offset;
        Datetime::from_ymd(
            now.year(),
            now.month().try_into().ok()?,
            now.day().try_into().ok()?,
        )
    }

    /// Access a file's contents as raw bytes.
    /// This now handles both local files and packages.
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        // Check our in-memory cache first.
        if let Some(result) = self.files.blocking_read().get(&id) {
            return result.clone();
        }

        let result = self.resolve_file(id);

        // Cache the result for this compilation pass.
        self.files.blocking_write().insert(id, result.clone());

        result
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        let bytes = self.file(id)?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| FileError::InvalidUtf8)?
            .into();
        Ok(Source::new(id, text))
    }
}

impl Typstworld {
    /// Resolves a file, handling local files and packages.
    fn resolve_file(&self, id: FileId) -> FileResult<Bytes> {
        let path = match id.package() {
            // If the file belongs to a package, we use the package storage
            // to find its path. This might involve downloading the package.
            Some(spec) => self.resolve_package(spec, id.vpath())?,
            // Otherwise, it's a local file.
            None => id
                .vpath()
                .resolve(&self.root)
                .ok_or(FileError::AccessDenied)?,
        };

        fs::read(&path)
            .map(|v| Bytes::new(v))
            .map_err(|err| FileError::from_io(err, &path))
    }

    /// Resolves a package file path, downloading the package if necessary.
    fn resolve_package(&self, spec: &PackageSpec, vpath: &VirtualPath) -> FileResult<PathBuf> {
        let package_root = self
            .package_storage
            .prepare_package(spec, &mut PrintDownload)?;

        vpath.resolve(&package_root).ok_or(FileError::AccessDenied)
    }

    pub fn get_file_path(&self, id: FileId) -> Option<PathBuf> {
        self.file_paths.blocking_read().get(&id).cloned()
    }
}
