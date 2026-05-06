// commands/format.rs
//
// Tauri commands for Typst source formatting via `typstyle-core`:
//   - format_typst_source         (pure text → text)
//   - format_typst_file           (read → format → write back, returns text)
//   - format_workspace_typ_files  (recursively format every .typ in the workspace)

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use log::{debug, error, info, warn};
use serde::Serialize;
use tauri::State;
use typstyle_core::Typstyle;

use crate::workspace::WorkspaceState;

/// Format a Typst source string and return the formatted output.
#[tauri::command]
pub fn format_typst_source(source: String) -> Result<String, String> {
    let t = Instant::now();
    debug!("format_typst_source: bytes={}", source.len());

    let formatted = Typstyle::default()
        .format_text(source)
        .render()
        .map_err(|e| {
            error!("format_typst_source: err=\"{e}\"");
            e.to_string()
        })?;

    debug!(
        "format_typst_source: ok ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(formatted)
}

/// Format a single .typ file in place. Reads from disk, formats, writes the
/// result back, and returns the formatted content so the frontend can refresh
/// any open editor view.
#[tauri::command]
pub fn format_typst_file(path: String) -> Result<String, String> {
    let t = Instant::now();
    info!("format_typst_file: path={path:?}");

    let abs = Path::new(&path);
    let content = std::fs::read_to_string(abs).map_err(|e| {
        error!("format_typst_file: read failed path={path:?} err=\"{e}\"");
        e.to_string()
    })?;

    let formatted = Typstyle::default()
        .format_text(content.clone())
        .render()
        .map_err(|e| {
            error!("format_typst_file: format failed path={path:?} err=\"{e}\"");
            e.to_string()
        })?;

    if formatted != content {
        std::fs::write(abs, formatted.as_bytes()).map_err(|e| {
            error!("format_typst_file: write failed path={path:?} err=\"{e}\"");
            e.to_string()
        })?;
    }

    info!(
        "format_typst_file: ok changed={} ({:.1}ms)",
        formatted != content,
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(formatted)
}

/// Outcome of a workspace-wide format pass.
#[derive(Serialize)]
pub struct FormatWorkspaceReport {
    /// Total .typ files discovered.
    pub total: usize,
    /// Files whose content was rewritten on disk.
    pub formatted: usize,
    /// Files left unchanged because they were already formatted.
    pub unchanged: usize,
    /// File paths that failed to format (read/parse/write error).
    pub failed: Vec<String>,
}

/// Format every .typ file under the current workspace root.
#[tauri::command]
pub fn format_workspace_typ_files(
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<FormatWorkspaceReport, String> {
    let t = Instant::now();
    info!("format_workspace_typ_files");

    let root = workspace
        .root
        .read()
        .clone()
        .ok_or_else(|| "No workspace open".to_string())?;

    let files = collect_typ_files(&root);
    let total = files.len();
    info!("format_workspace_typ_files: found {total} .typ file(s)");

    let typstyle = Typstyle::default();
    let mut formatted_count = 0usize;
    let mut unchanged = 0usize;
    let mut failed: Vec<String> = Vec::new();

    for path in files {
        let display = path.display().to_string();
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                warn!("format_workspace_typ_files: read failed path={path:?} err=\"{e}\"");
                failed.push(display);
                continue;
            }
        };

        let formatted = match typstyle.format_text(content.clone()).render() {
            Ok(out) => out,
            Err(e) => {
                warn!("format_workspace_typ_files: format failed path={path:?} err=\"{e}\"");
                failed.push(display);
                continue;
            }
        };

        if formatted == content {
            unchanged += 1;
            continue;
        }

        if let Err(e) = std::fs::write(&path, formatted.as_bytes()) {
            warn!("format_workspace_typ_files: write failed path={path:?} err=\"{e}\"");
            failed.push(display);
            continue;
        }
        formatted_count += 1;
    }

    info!(
        "format_workspace_typ_files: ok total={total} formatted={formatted_count} unchanged={unchanged} failed={} ({:.1}ms)",
        failed.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(FormatWorkspaceReport {
        total,
        formatted: formatted_count,
        unchanged,
        failed,
    })
}

/// Recursively collect every `.typ` file under `dir`, skipping hidden
/// directories (e.g. `.git`, `.typwriter`).
fn collect_typ_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            files.extend(collect_typ_files(&path));
        } else if path.extension().and_then(|e| e.to_str()) == Some("typ") {
            files.push(path);
        }
    }
    files
}
