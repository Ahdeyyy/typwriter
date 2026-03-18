// compiler/compile.rs
//
// Thin wrapper around typst::compile() that converts the raw diag types into
// JSON-serialisable forms we can send over Tauri IPC.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use typst::{
    diag::{FileResult, Severity, SourceDiagnostic},
    foundations::{Bytes, Datetime},
    layout::PagedDocument,
    syntax::{FileId, Source},
    text::{Font, FontBook},
    utils::LazyHash,
    Library, World,
};

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
pub fn compile_document(world: &dyn World) -> CompileOutput {
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

/// Collect diagnostics from every `.typ` file in the workspace that is NOT the
/// current main file. Each file is compiled as its own entry point via a thin
/// `World` wrapper so the shared `EditorWorld` state is never mutated.
pub fn collect_workspace_diagnostics(world: &EditorWorld) -> (Vec<SerializedDiagnostic>, Vec<SerializedDiagnostic>) {
    let root = world.root();
    let main_id = world.main_id();

    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();

    for path in walk_typ_files(&root) {
        let Some(id) = world.path_to_id(&path) else { continue };
        if id == main_id {
            continue;
        }

        let override_world = MainOverride { inner: world, main_id: id };
        let result = typst::compile::<PagedDocument>(&override_world);

        for diag in &result.warnings {
            let sd = serialize_one(&override_world, diag);
            let key = dedup_key(&sd);
            if seen.insert(key) {
                warnings.push(sd);
            }
        }

        if let Err(errs) = &result.output {
            for diag in errs {
                let sd = serialize_one(&override_world, diag);
                let key = dedup_key(&sd);
                if seen.insert(key) {
                    errors.push(sd);
                }
            }
        }
    }

    (errors, warnings)
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
struct MainOverride<'a> {
    inner: &'a dyn World,
    main_id: FileId,
}

impl World for MainOverride<'_> {
    fn library(&self) -> &LazyHash<Library> { self.inner.library() }
    fn book(&self) -> &LazyHash<FontBook> { self.inner.book() }
    fn main(&self) -> FileId { self.main_id }
    fn source(&self, id: FileId) -> FileResult<Source> { self.inner.source(id) }
    fn file(&self, id: FileId) -> FileResult<Bytes> { self.inner.file(id) }
    fn font(&self, index: usize) -> Option<Font> { self.inner.font(index) }
    fn today(&self, offset: Option<i64>) -> Option<Datetime> { self.inner.today(offset) }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn serialize_diags(world: &dyn World, diags: &[SourceDiagnostic]) -> Vec<SerializedDiagnostic> {
    diags
        .iter()
        .map(|d| serialize_one(world, d))
        .collect()
}

fn serialize_one(world: &dyn World, d: &SourceDiagnostic) -> SerializedDiagnostic {
    let (file_path, range) = resolve_span(world, d);
    SerializedDiagnostic {
        severity: match d.severity {
            Severity::Error => "error".into(),
            Severity::Warning => "warning".into(),
        },
        message: d.message.to_string(),
        hints: d.hints.iter().map(|h| h.to_string()).collect(),
        file_path,
        range,
    }
}

/// Try to resolve a diagnostic span to a file path + line/col range.
fn resolve_span(
    world: &dyn World,
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

    let file_path = id.vpath().as_rootless_path().to_str().map(String::from);

    let range = source.range(diag.span).and_then(|r| {
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
fn dedup_key(d: &SerializedDiagnostic) -> (String, Option<String>, String, Option<usize>, Option<usize>) {
    (
        d.severity.clone(),
        d.file_path.clone(),
        d.message.clone(),
        d.range.as_ref().map(|r| r.start_line),
        d.range.as_ref().map(|r| r.start_col),
    )
}

/// Recursively walk a directory and yield all `.typ` file paths.
fn walk_typ_files(root: &Path) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    walk_dir_recursive(root, &mut result);
    result
}

fn walk_dir_recursive(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip hidden dirs and common non-source dirs
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
            }
            walk_dir_recursive(&path, out);
        } else if path.extension().map_or(false, |ext| ext == "typ") {
            out.push(path);
        }
    }
}
