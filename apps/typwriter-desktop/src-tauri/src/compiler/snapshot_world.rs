// A `World` rooted at a *historical* snapshot instead of the working tree.
//
// This is what makes "which pages changed since this restore point" possible:
// the fingerprints in `diff.rs` describe the document you just compiled, so
// comparing against a restore point means genuinely compiling that restore
// point too. `SnapshotWorld` is the world that compile runs against — project
// files resolve out of the snapshot's content-addressed object store rather
// than off disk.
//
// Everything that isn't workspace content — the standard library, the font
// book, packages, `today()` — delegates to the live [`EditorWorld`]. Packages
// are immutable once downloaded, so sharing them (and the base world's caches
// for them) is both correct and free.
//
// Blobs are read lazily. A snapshot manifest lists every file in the
// workspace, but a compile only touches the ones the document imports, so
// materializing the whole tree up front would waste time and memory on any
// workspace carrying sizeable assets.
//
// Returning *different* bytes than the live world for the same `FileId` is
// safe with comemo: memoized work is validated by re-reading through whichever
// world is in play and comparing hashes, so a mismatch just recomputes. It is
// the same mechanism that makes editing a file invalidate the right subtree,
// and the same trick `compile::MainOverride` already plays for workspace-wide
// diagnostics. The cost is cache churn, not correctness.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use parking_lot::Mutex;
use typst::{
    diag::{FileError, FileResult},
    foundations::{Bytes, Datetime, Duration},
    syntax::{FileId, Source, VirtualRoot},
    text::{Font, FontBook},
    utils::LazyHash,
    Library, World,
};

use crate::vcs::{SnapshotFiles, VcsState};
use crate::world::{local_file_id, EditorWorld};

pub struct SnapshotWorld<'a> {
    /// Live world. Supplies the library, fonts and package resolution — none
    /// of which are versioned by a snapshot.
    base: &'a EditorWorld,
    /// Object store the snapshot's blobs are read from.
    vcs: &'a VcsState,
    /// Workspace-relative path → blob hash, straight off the manifest.
    files: SnapshotFiles,
    /// Entry point: the current main file, as it existed in the snapshot.
    main: FileId,
    sources: Mutex<HashMap<FileId, Source>>,
    binaries: Mutex<HashMap<FileId, Bytes>>,
}

impl<'a> SnapshotWorld<'a> {
    /// Build a world over `files`, entered at `main_rel` (a workspace-relative
    /// forward-slash path — normally [`EditorWorld::main_rel`]).
    ///
    /// Fails when the snapshot has no such file: the document the user is
    /// looking at simply didn't exist back then, and there is nothing
    /// meaningful to diff its pages against.
    pub fn new(
        base: &'a EditorWorld,
        vcs: &'a VcsState,
        files: SnapshotFiles,
        main_rel: &str,
    ) -> Result<Self, String> {
        if !files.contains_key(main_rel) {
            return Err(format!(
                "'{main_rel}' did not exist in that restore point"
            ));
        }
        let main = local_file_id(Path::new(main_rel))
            .ok_or_else(|| format!("'{main_rel}' is not a valid workspace path"))?;
        Ok(Self {
            base,
            vcs,
            files,
            main,
            sources: Mutex::new(HashMap::new()),
            binaries: Mutex::new(HashMap::new()),
        })
    }

    /// Read a project-local file out of the snapshot. Package files never
    /// reach here — they're delegated to the base world by the callers.
    fn read_snapshot_bytes(&self, id: FileId) -> FileResult<Vec<u8>> {
        let rel = id.vpath().get_without_slash().to_string();
        let hash = self
            .files
            .get(&rel)
            .ok_or_else(|| FileError::NotFound(PathBuf::from(&rel)))?;
        // A missing/corrupt object is a store problem, not a "file isn't
        // there" problem — reporting NotFound would make the compiler blame
        // the document. `Other` carries the real reason through to the
        // diagnostic instead.
        self.vcs
            .read_object(hash)
            .map_err(|err| FileError::Other(Some(err.into())))
    }
}

impl World for SnapshotWorld<'_> {
    fn library(&self) -> &LazyHash<Library> {
        self.base.library()
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.base.book()
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if matches!(id.root(), VirtualRoot::Package(_)) {
            return self.base.source(id);
        }
        if let Some(source) = self.sources.lock().get(&id) {
            return Ok(source.clone());
        }
        let bytes = self.read_snapshot_bytes(id)?;
        let text = String::from_utf8(bytes).map_err(|_| FileError::AccessDenied)?;
        let source = Source::new(id, text);
        self.sources.lock().insert(id, source.clone());
        Ok(source)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if matches!(id.root(), VirtualRoot::Package(_)) {
            return self.base.file(id);
        }
        if let Some(bytes) = self.binaries.lock().get(&id) {
            return Ok(bytes.clone());
        }
        let bytes = Bytes::new(self.read_snapshot_bytes(id)?);
        self.binaries.lock().insert(id, bytes.clone());
        Ok(bytes)
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.base.font(index)
    }

    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        self.base.today(offset)
    }
}
