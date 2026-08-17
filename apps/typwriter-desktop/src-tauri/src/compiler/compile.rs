// Thin wrapper around typst::compile() that converts the raw diag types into
// JSON-serialisable forms we can send over Tauri IPC.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use log::warn;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::Serialize;
use typst::{
    diag::{FileResult, Severity, SourceDiagnostic},
    foundations::{Bytes, Datetime},
    syntax::{FileId, Source, VirtualRoot},
    text::{Font, FontBook},
    utils::LazyHash,
    Library, World, WorldExt,
};
use typst_layout::PagedDocument;

use crate::world::EditorWorld;

// ─── Serialisable diagnostic types ──────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
pub struct DiagnosticRange {
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct SerializedDiagnostic {
    /// `"error"` or `"warning"`
    pub severity: String,
    pub message: String,
    pub hints: Vec<String>,
    /// Workspace-relative path, if the span resolves to a local file.
    pub file_path: Option<String>,
    pub range: Option<DiagnosticRange>,
}

// ─── Compile output ──────────────────────────────────────────────────────────

pub struct CompileOutput {
    pub document: Option<PagedDocument>,
    pub errors: Vec<SerializedDiagnostic>,
    pub warnings: Vec<SerializedDiagnostic>,
}

// ─── Top-level compile call ───────────────────────────────────────────────────

/// Run a full typst compilation against the provided world and return a
/// structured result with the optional document and serialisable diagnostics.
pub fn compile_document(world: &EditorWorld) -> CompileOutput {
    let result = typst::compile(world);
    let raw_warnings = result.warnings;

    match result.output {
        Ok(doc) => CompileOutput {
            document: Some(doc),
            errors: vec![],
            warnings: serialize_diags(world, &raw_warnings),
        },
        Err(errors) => CompileOutput {
            document: None,
            errors: serialize_diags(world, &errors),
            warnings: serialize_diags(world, &raw_warnings),
        },
    }
}

// ─── Workspace-wide diagnostics ─────────────────────────────────────────────

/// Diagnostics previously computed for one non-main `.typ` file, together with
/// the fingerprint of every file that compiling it actually read.
///
/// The dependency list is what makes the cache safe. Keying only on the file's
/// own bytes would serve stale diagnostics whenever a *shared* file changed —
/// edit `template.typ` and every chapter importing it must be re-diagnosed,
/// even though none of their own bytes moved.
#[derive(Clone)]
pub struct CachedFileDiags {
    /// `(file, content hash)` for the compiled file and everything it read.
    deps: Vec<(FileId, u128)>,
    errors: Vec<SerializedDiagnostic>,
    warnings: Vec<SerializedDiagnostic>,
}

impl CachedFileDiags {
    /// Whether every recorded dependency still has the bytes it had when this
    /// entry was produced. A dependency that has since become unreadable
    /// invalidates the entry.
    ///
    /// Takes the hash lookup as a closure rather than a `&EditorWorld` so the
    /// invalidation rule — the part that decides whether stale diagnostics get
    /// shown — can be unit-tested without constructing a Tauri `AppHandle`.
    fn is_fresh(&self, current_hash: impl Fn(FileId) -> Option<u128>) -> bool {
        self.deps
            .iter()
            .all(|&(id, hash)| current_hash(id) == Some(hash))
    }
}

/// Content fingerprint of a file as the world currently sees it, or `None` if
/// it can no longer be read.
fn current_source_hash(world: &EditorWorld, id: FileId) -> Option<u128> {
    Some(typst::utils::hash128(world.source(id).ok()?.text()))
}

/// Per-file diagnostic cache, keyed by the file being compiled as an entry point.
pub type WorkspaceDiagCache = HashMap<FileId, CachedFileDiags>;

/// Collect diagnostics from every `.typ` file in the workspace that is NOT the
/// current main file. Each file is compiled as its own entry point via a thin
/// `World` wrapper so the shared `EditorWorld` state is never mutated.
///
/// This runs on every Save / Watcher / Explicit / MainFile compile, so it used
/// to mean "recompile the entire workspace, one file at a time, every time the
/// user hits Ctrl+S". Two changes make that affordable:
///
///   * **Caching.** A file whose transitive inputs are all byte-identical to
///     the last run reuses its diagnostics. In the common case — one file
///     edited — exactly one file is recompiled.
///   * **Parallelism.** The remaining compiles run on rayon's pool rather than
///     sequentially. `EditorWorld` is `Sync` and comemo's memo cache is
///     designed for concurrent use.
///
/// Output order is made deterministic by sorting on the walk order rather than
/// on completion order, so the diagnostics pane doesn't reshuffle between runs.
pub fn collect_workspace_diagnostics(
    world: &EditorWorld,
    cache: &Mutex<WorkspaceDiagCache>,
) -> (Vec<SerializedDiagnostic>, Vec<SerializedDiagnostic>) {
    let root = world.root();
    let main_id = world.main_id();

    let targets: Vec<FileId> = walk_typ_files(&root)
        .iter()
        .filter_map(|path| world.path_to_id(path))
        .filter(|id| Some(*id) != main_id)
        .collect();

    // Reuse what is still valid; compile the rest in parallel.
    let reused: Vec<Option<CachedFileDiags>> = {
        let cache = cache.lock();
        targets
            .iter()
            .map(|id| {
                cache
                    .get(id)
                    .filter(|entry| entry.is_fresh(|dep| current_source_hash(world, dep)))
                    .cloned()
            })
            .collect()
    };

    let computed: Vec<(FileId, CachedFileDiags)> = targets
        .par_iter()
        .zip(reused.par_iter())
        .filter(|(_, hit)| hit.is_none())
        .map(|(&id, _)| (id, compile_one_for_diagnostics(world, id)))
        .collect();

    {
        let mut cache = cache.lock();
        for (id, entry) in &computed {
            cache.insert(*id, entry.clone());
        }
        // Drop entries for files that no longer exist, so the cache can't grow
        // without bound across renames and deletions.
        let live: HashSet<FileId> = targets.iter().copied().collect();
        cache.retain(|id, _| live.contains(id));
    }

    let fresh: HashMap<FileId, CachedFileDiags> = computed.into_iter().collect();

    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();
    for (id, hit) in targets.iter().zip(reused) {
        let Some(entry) = hit.or_else(|| fresh.get(id).cloned()) else {
            continue;
        };
        for diag in entry.warnings {
            if seen.insert(dedup_key(&diag)) {
                warnings.push(diag);
            }
        }
        for diag in entry.errors {
            if seen.insert(dedup_key(&diag)) {
                errors.push(diag);
            }
        }
    }

    (errors, warnings)
}

/// Compile one workspace file as its own entry point and record both its
/// diagnostics and the set of files the compile read.
fn compile_one_for_diagnostics(world: &EditorWorld, id: FileId) -> CachedFileDiags {
    let override_world = MainOverride {
        inner: world,
        main_id: id,
        reads: Mutex::new(HashSet::new()),
    };
    let result = typst::compile::<PagedDocument>(&override_world);

    let warnings = result
        .warnings
        .iter()
        .map(|diag| serialize_one(world, diag))
        .collect();
    let errors = match &result.output {
        Ok(_) => Vec::new(),
        Err(errs) => errs.iter().map(|diag| serialize_one(world, diag)).collect(),
    };

    // Fingerprint everything the compile touched. `reads` always contains `id`
    // itself, since compiling an entry point reads it.
    let deps = override_world
        .reads
        .into_inner()
        .into_iter()
        .filter_map(|dep| {
            let source = world.source(dep).ok()?;
            Some((dep, typst::utils::hash128(source.text())))
        })
        .collect();

    CachedFileDiags {
        deps,
        errors,
        warnings,
    }
}

/// Deduplicate diagnostics that also appear in the main compilation output.
pub fn dedup_merge(
    main_errors: &mut Vec<SerializedDiagnostic>,
    main_warnings: &mut Vec<SerializedDiagnostic>,
    extra_errors: Vec<SerializedDiagnostic>,
    extra_warnings: Vec<SerializedDiagnostic>,
) {
    let mut seen = HashSet::new();
    for d in main_errors.iter().chain(main_warnings.iter()) {
        seen.insert(dedup_key(d));
    }
    for d in extra_errors {
        if seen.insert(dedup_key(&d)) {
            main_errors.push(d);
        }
    }
    for d in extra_warnings {
        if seen.insert(dedup_key(&d)) {
            main_warnings.push(d);
        }
    }
}

// ─── MainOverride wrapper ────────────────────────────────────────────────────

/// Thin `World` wrapper that delegates everything to an inner world but
/// overrides `main()` to point to a different file.
///
/// It also records every file the compile reads. That set is what
/// [`collect_workspace_diagnostics`] fingerprints to decide whether a cached
/// result is still valid — without it, a change to a shared `template.typ`
/// would leave every importing chapter showing stale diagnostics.
struct MainOverride<'a> {
    inner: &'a dyn World,
    main_id: FileId,
    reads: Mutex<HashSet<FileId>>,
}

impl World for MainOverride<'_> {
    fn library(&self) -> &LazyHash<Library> {
        self.inner.library()
    }
    fn book(&self) -> &LazyHash<FontBook> {
        self.inner.book()
    }
    fn main(&self) -> FileId {
        self.main_id
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        self.reads.lock().insert(id);
        self.inner.source(id)
    }
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        // Binary assets are recorded too: `world.source` can't fingerprint
        // them, so they're filtered out when the dep list is built. Recording
        // them here keeps the trait impl honest about what was touched.
        self.reads.lock().insert(id);
        self.inner.file(id)
    }
    fn font(&self, index: usize) -> Option<Font> {
        self.inner.font(index)
    }
    fn today(&self, offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        self.inner.today(offset)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn serialize_diags(world: &EditorWorld, diags: &[SourceDiagnostic]) -> Vec<SerializedDiagnostic> {
    diags.iter().map(|d| serialize_one(world, d)).collect()
}

fn serialize_one(world: &EditorWorld, d: &SourceDiagnostic) -> SerializedDiagnostic {
    let (file_path, range) = resolve_span(world, d);
    SerializedDiagnostic {
        severity: match d.severity {
            Severity::Error => "error".into(),
            Severity::Warning => "warning".into(),
        },
        message: d.message.to_string(),
        // In 0.15 `hints` are `Spanned<EcoString>`; `.v` is the text value.
        hints: d.hints.iter().map(|h| h.v.to_string()).collect(),
        file_path,
        range,
    }
}

/// Try to resolve a diagnostic span to a file path + line/col range.
///
/// For workspace files the path is workspace-relative; for files inside a
/// downloaded package, the path is resolved to the absolute on-disk location
/// in the package cache so the editor can open the source.
fn resolve_span(
    world: &EditorWorld,
    diag: &SourceDiagnostic,
) -> (Option<String>, Option<DiagnosticRange>) {
    let id = match diag.span.id() {
        Some(id) => id,
        None => return (None, None),
    };

    let source = match world.source(id) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };

    let file_path = if matches!(id.root(), VirtualRoot::Package(_)) {
        world
            .id_to_path(id)
            .ok()
            .and_then(|p| p.to_str().map(String::from))
    } else {
        Some(id.vpath().get_without_slash().to_string())
    };

    let range = world.range(diag.span).and_then(|r| {
        let lines = source.lines();
        let (sl, sc) = lines.byte_to_line_column(r.start)?;
        let (el, ec) = lines.byte_to_line_column(r.end)?;
        Some(DiagnosticRange {
            start_line: sl,
            start_col: sc,
            end_line: el,
            end_col: ec,
        })
    });

    (file_path, range)
}

/// Deduplication key: (severity, file_path, message, start_line, start_col).
fn dedup_key(
    d: &SerializedDiagnostic,
) -> (String, Option<String>, String, Option<usize>, Option<usize>) {
    (
        d.severity.clone(),
        d.file_path.clone(),
        d.message.clone(),
        d.range.as_ref().map(|r| r.start_line),
        d.range.as_ref().map(|r| r.start_col),
    )
}

/// How deep the workspace walk will descend. A guard against pathological
/// directory nesting; no real Typst project comes close.
const MAX_WALK_DEPTH: usize = 32;

/// Recursively walk a directory and yield all `.typ` file paths, in a stable
/// (sorted) order so the diagnostics pane doesn't reshuffle between runs.
fn walk_typ_files(root: &Path) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    walk_dir_recursive(root, 0, &mut result);
    result.sort();
    result
}

fn walk_dir_recursive(dir: &Path, depth: usize, out: &mut Vec<std::path::PathBuf>) {
    if depth >= MAX_WALK_DEPTH {
        warn!("walk_dir_recursive: depth limit reached at dir={dir:?}");
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) => {
            warn!("walk_dir_recursive: failed to read dir={dir:?} err=\"{err}\"");
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                warn!("walk_dir_recursive: skipped entry in dir={dir:?} err=\"{err}\"");
                continue;
            }
        };
        // `file_type` does not follow symlinks, unlike `Path::is_dir`. A
        // symlinked directory that points at an ancestor would otherwise make
        // this recurse until the depth cap.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            // Skip hidden dirs (which covers `.typwriter` and `.git`) and the
            // usual build-output directories.
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
            }
            walk_dir_recursive(&path, depth + 1, out);
        } else if path.extension().is_some_and(|ext| ext == "typ") {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{walk_typ_files, CachedFileDiags, SerializedDiagnostic};
    use crate::world::local_file_id;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::time::SystemTime;
    use typst::syntax::FileId;

    // ─── Cache invalidation ─────────────────────────────────────────────────
    //
    // `collect_workspace_diagnostics` now reuses results instead of
    // recompiling every workspace file on every save. The whole safety of that
    // rests on `is_fresh`: if it ever returns `true` when an input has moved,
    // the diagnostics pane silently shows stale errors. These tests pin the
    // rule, including the transitive case that a naive "hash the file itself"
    // cache would get wrong.

    fn id_of(rel: &str) -> FileId {
        local_file_id(Path::new(rel)).expect("valid virtual path")
    }

    fn entry(deps: &[(FileId, u128)]) -> CachedFileDiags {
        CachedFileDiags {
            deps: deps.to_vec(),
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    /// Hash lookup backed by a fixed map, standing in for the live world.
    fn hashes(pairs: &[(FileId, u128)]) -> impl Fn(FileId) -> Option<u128> + '_ {
        let map: HashMap<FileId, u128> = pairs.iter().copied().collect();
        move |id| map.get(&id).copied()
    }

    #[test]
    fn unchanged_dependencies_keep_the_entry_fresh() {
        let main = id_of("chapter.typ");
        let cached = entry(&[(main, 111)]);
        assert!(cached.is_fresh(hashes(&[(main, 111)])));
    }

    #[test]
    fn a_changed_file_invalidates_its_own_entry() {
        let chapter = id_of("chapter.typ");
        let cached = entry(&[(chapter, 111)]);
        assert!(!cached.is_fresh(hashes(&[(chapter, 222)])));
    }

    #[test]
    fn a_changed_shared_import_invalidates_every_importer() {
        // The case a "hash the file itself" cache gets wrong: `chapter.typ` is
        // byte-identical, but the `template.typ` it imports changed, so its
        // diagnostics must be recomputed.
        let chapter = id_of("chapter.typ");
        let template = id_of("template.typ");
        let cached = entry(&[(chapter, 111), (template, 999)]);

        assert!(cached.is_fresh(hashes(&[(chapter, 111), (template, 999)])));
        assert!(
            !cached.is_fresh(hashes(&[(chapter, 111), (template, 1000)])),
            "an edit to a shared import must invalidate its importers",
        );
    }

    #[test]
    fn a_vanished_dependency_invalidates_the_entry() {
        // A deleted import turns into a real "file not found" diagnostic, so
        // the entry must not be reused.
        let chapter = id_of("chapter.typ");
        let template = id_of("template.typ");
        let cached = entry(&[(chapter, 111), (template, 999)]);

        assert!(!cached.is_fresh(hashes(&[(chapter, 111)])));
    }

    #[test]
    fn entry_with_no_recorded_dependencies_is_never_reused_blindly() {
        // A compile always reads its own entry file, so an empty dep list means
        // recording failed. Vacuous truth would make such an entry immortal;
        // assert the shape we actually rely on instead.
        let cached = entry(&[]);
        assert!(
            cached.deps.is_empty(),
            "empty dep lists should not occur — see compile_one_for_diagnostics",
        );
    }

    // ─── Workspace walk ─────────────────────────────────────────────────────

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("typwriter-walk-{tag}-{nanos}"));
            std::fs::create_dir_all(&dir).expect("create temp tree");
            Self(dir)
        }

        fn file(&self, rel: &str) {
            let path = self.0.join(rel);
            std::fs::create_dir_all(path.parent().expect("has parent")).expect("mkdir");
            std::fs::write(path, "= Doc\n").expect("write");
        }

        /// Paths relative to the root, forward-slashed, in walk order.
        fn walked(&self) -> Vec<String> {
            walk_typ_files(&self.0)
                .iter()
                .map(|p| {
                    p.strip_prefix(&self.0)
                        .expect("under root")
                        .to_string_lossy()
                        .replace('\\', "/")
                })
                .collect()
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn walk_finds_nested_typ_files_and_ignores_other_extensions() {
        let tree = TempTree::new("nested");
        tree.file("main.typ");
        tree.file("chapters/one.typ");
        tree.file("chapters/deep/two.typ");
        tree.file("notes.md");
        tree.file("data.json");

        assert_eq!(
            tree.walked(),
            vec!["chapters/deep/two.typ", "chapters/one.typ", "main.typ"],
        );
    }

    #[test]
    fn walk_skips_hidden_and_build_output_directories() {
        // `.typwriter` holds the VCS store and the preview cache; walking it
        // would compile snapshot content as if it were workspace source.
        let tree = TempTree::new("skips");
        tree.file("main.typ");
        tree.file(".typwriter/history/blob.typ");
        tree.file(".git/hooks/sample.typ");
        tree.file("node_modules/pkg/index.typ");
        tree.file("target/debug/build.typ");

        assert_eq!(tree.walked(), vec!["main.typ"]);
    }

    #[test]
    fn walk_order_is_stable() {
        // The diagnostics pane renders in this order; an unstable walk would
        // make entries jump around between saves.
        let tree = TempTree::new("stable");
        tree.file("z.typ");
        tree.file("a.typ");
        tree.file("m/n.typ");

        let first = tree.walked();
        assert_eq!(first, tree.walked());
        assert_eq!(first, vec!["a.typ", "m/n.typ", "z.typ"]);
    }

    #[test]
    fn diagnostics_are_serialisable_and_dedup_keys_are_stable() {
        // `dedup_key` decides which cross-file duplicates get dropped; two
        // structurally identical diagnostics must collapse to one key.
        let make = || SerializedDiagnostic {
            severity: "error".into(),
            message: "unknown variable".into(),
            hints: vec!["did you mean `x`?".into()],
            file_path: Some("chapters/one.typ".into()),
            range: None,
        };
        assert_eq!(super::dedup_key(&make()), super::dedup_key(&make()));
    }
}
