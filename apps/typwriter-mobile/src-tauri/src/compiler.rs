// compiler.rs
//
// Compile state + diagnostics serialization. The actual `compile` Tauri
// command lives in `commands/compile.rs`; this module owns the shared state it
// mutates and the helpers that turn typst diagnostics into IPC payloads.

use std::{
    collections::HashMap,
    sync::{atomic::AtomicU64, Arc},
};

use parking_lot::Mutex;
use serde::Serialize;
use typst::{
    diag::{Severity, SourceDiagnostic},
    layout::PagedDocument,
    World,
};

use crate::world::MobileWorld;

#[derive(Default)]
pub struct CompileState {
    /// Monotonic id; one per compile call. The frontend discards responses
    /// whose generation is older than the newest it has seen.
    pub generation: AtomicU64,
    /// Last successfully compiled document (for render + export + IDE calls).
    pub document: Mutex<Option<Arc<PagedDocument>>>,
    /// fingerprint (hex) -> page index in `document`, rebuilt per compile.
    pub page_lookup: Mutex<HashMap<String, usize>>,
}

// ─── Serialisable IPC types (mirror src/lib/ipc/types.ts) ────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticRange {
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    /// `"error"` or `"warning"`.
    pub severity: String,
    pub message: String,
    pub hints: Vec<String>,
    /// Workspace-relative path, or null for package/internal spans.
    pub file_path: Option<String>,
    pub range: Option<DiagnosticRange>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    /// 128-bit page-frame hash, hex. Combine with a scale bucket to form the
    /// image URL: previewimg://localhost/{fingerprint}-{bucket}.png
    pub fingerprint: String,
    pub width_pt: f64,
    pub height_pt: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub generation: u64,
    /// Present (possibly empty) on success; null when no document was produced.
    pub pages: Option<Vec<PageMeta>>,
    pub errors: Vec<Diagnostic>,
    pub warnings: Vec<Diagnostic>,
    pub compile_ms: f64,
}

// ─── Diagnostics serialization ───────────────────────────────────────────────

pub fn serialize_diags(world: &MobileWorld, diags: &[SourceDiagnostic]) -> Vec<Diagnostic> {
    diags.iter().map(|d| serialize_one(world, d)).collect()
}

fn serialize_one(world: &MobileWorld, d: &SourceDiagnostic) -> Diagnostic {
    let (file_path, range) = resolve_span(world, d);
    Diagnostic {
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

fn resolve_span(
    world: &MobileWorld,
    diag: &SourceDiagnostic,
) -> (Option<String>, Option<DiagnosticRange>) {
    let Some(id) = diag.span.id() else {
        return (None, None);
    };
    let Ok(source) = world.source(id) else {
        return (None, None);
    };
    // Package/internal spans have no workspace-relative path.
    let file_path = if id.package().is_some() {
        None
    } else {
        id.vpath()
            .as_rootless_path()
            .to_str()
            .map(|s| s.replace('\\', "/"))
    };
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
