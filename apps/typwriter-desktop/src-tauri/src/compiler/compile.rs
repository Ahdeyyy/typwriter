// compiler/compile.rs
//
// Thin wrapper around typst::compile() that converts the raw diag types into
// JSON-serialisable forms we can send over Tauri IPC.

use serde::Serialize;
use typst::{
    diag::{Severity, SourceDiagnostic},
    layout::PagedDocument,
    World,
};

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn serialize_diags(world: &dyn World, diags: &[SourceDiagnostic]) -> Vec<SerializedDiagnostic> {
    diags
        .iter()
        .map(|d| {
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
        })
        .collect()
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
