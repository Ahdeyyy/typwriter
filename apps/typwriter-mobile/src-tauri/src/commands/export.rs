// commands/export.rs
//
// Exports. `pdf_bytes` renders the last successfully compiled document;
// `export_pdf_to_uri` saves it through the Android SAF save dialog (or the
// desktop dialog in the dev loop); `export_pdf_to_cache_file` writes a temp PDF
// for sharing; `export_workspace` copies a whole workspace into a user-chosen
// folder. Everything runs async — the save/pick dialogs block until the user
// responds, so their bodies hop to `spawn_blocking`.

use std::{path::Path, sync::Arc, time::Instant};

use log::{error, info};
use tauri::{AppHandle, Manager, State};

use crate::{compiler::CompileState, world::MobileWorld};

/// Render the last compiled document to PDF bytes.
fn pdf_bytes(state: &CompileState) -> Result<Vec<u8>, String> {
    let doc = state
        .document
        .lock()
        .as_ref()
        .ok_or_else(|| "Nothing compiled yet — open the preview first".to_string())?
        .clone();

    typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).map_err(|diags| {
        diags
            .iter()
            .map(|d| d.message.to_string())
            .collect::<Vec<_>>()
            .join("; ")
    })
}

/// Stem of the main file (e.g. "main" for "main.typ"), for the suggested name.
fn main_stem(world: &MobileWorld) -> String {
    world
        .main_id()
        .and_then(|id| {
            Path::new(id.vpath().get_without_slash())
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "document".to_string())
}

/// Save the compiled document to a user-chosen location. Returns the display
/// name of the created file. Android uses the SAF save dialog; the desktop dev
/// loop falls back to tauri-plugin-dialog + std::fs.
#[tauri::command]
pub async fn export_pdf_to_uri(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<String, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    tauri::async_runtime::spawn_blocking(move || export_pdf_blocking(&app, &world, &compile))
        .await
        .map_err(|e| format!("export task panicked: {e}"))?
}

fn export_pdf_blocking(
    app: &AppHandle,
    world: &MobileWorld,
    compile: &CompileState,
) -> Result<String, String> {
    let t = Instant::now();
    let bytes = pdf_bytes(compile)?;
    let suggested = format!("{}.pdf", main_stem(world));

    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        let api = app.android_fs();
        let uri = api
            .file_picker()
            .save_file(None, &suggested, Some("application/pdf"), false)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Export cancelled".to_string())?;
        api.write(&uri, &bytes).map_err(|e| e.to_string())?;
        info!(
            "export_pdf_to_uri: ok {suggested} {} bytes ({:.1}ms)",
            bytes.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(suggested)
    }

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let path = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .set_file_name(&suggested)
            .blocking_save_file()
            .ok_or_else(|| "Export cancelled".to_string())?;
        let path = path
            .into_path()
            .map_err(|e| format!("Invalid save path: {e}"))?;
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&suggested)
            .to_string();
        info!(
            "export_pdf_to_uri: ok {name} {} bytes ({:.1}ms)",
            bytes.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(name)
    }
}

/// Write the compiled document to a temp PDF and return its absolute path (for
/// a share intent). The Share button is optional in v1.
#[tauri::command]
pub async fn export_pdf_to_cache_file(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<String, String> {
    let bytes = pdf_bytes(&compile)?;
    let stem = main_stem(&world);
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("export");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{stem}.pdf"));
    std::fs::write(&path, &bytes).map_err(|e| {
        error!("export_pdf_to_cache_file: write failed err=\"{e}\"");
        e.to_string()
    })?;
    Ok(path.to_string_lossy().into_owned())
}

// ─── Workspace export ────────────────────────────────────────────────────────

/// Copy the named workspace into a user-chosen folder (a `<name>/` subfolder is
/// created there). Hidden entries (`.typwriter` etc.) are skipped. Returns the
/// number of files copied. Android writes through the SAF directory picker;
/// the desktop dev loop uses the plain folder dialog + std::fs.
#[tauri::command]
pub async fn export_workspace(name: String, app: AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || export_workspace_blocking(&app, &name))
        .await
        .map_err(|e| format!("export task panicked: {e}"))?
}

fn export_workspace_blocking(app: &AppHandle, name: &str) -> Result<usize, String> {
    let t = Instant::now();
    let src = crate::commands::workspace::root_dir(app).join(name);
    if !src.is_dir() {
        return Err(format!("Workspace \"{name}\" not found"));
    }

    // Collect (relative path, absolute path) for every visible file up front so
    // both platform branches share the same walk.
    let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
    collect_files(&src, &src, &mut files)?;
    if files.is_empty() {
        return Err("The workspace has no files to export".into());
    }

    #[cfg(target_os = "android")]
    let copied = {
        use tauri_plugin_android_fs::AndroidFsExt;
        let api = app.android_fs();
        let dest = api
            .file_picker()
            .pick_dir(None, false)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Export cancelled".to_string())?;
        let mut copied = 0usize;
        for (rel, abs) in &files {
            let bytes = std::fs::read(abs).map_err(|e| e.to_string())?;
            let uri = api
                .create_new_file(&dest, format!("{name}/{rel}"), None)
                .map_err(|e| e.to_string())?;
            api.write(&uri, &bytes).map_err(|e| e.to_string())?;
            copied += 1;
        }
        copied
    };

    #[cfg(not(target_os = "android"))]
    let copied = {
        use tauri_plugin_dialog::DialogExt;
        let picked = app
            .dialog()
            .file()
            .blocking_pick_folder()
            .ok_or_else(|| "Export cancelled".to_string())?;
        let dest = picked
            .into_path()
            .map_err(|e| format!("Invalid folder: {e}"))?
            .join(name);
        let mut copied = 0usize;
        for (rel, abs) in &files {
            let target = dest.join(rel);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(abs, &target).map_err(|e| e.to_string())?;
            copied += 1;
        }
        copied
    };

    info!(
        "export_workspace: {name:?} {copied} files ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(copied)
}

/// Recursively collect visible files under `dir` as workspace-relative
/// forward-slash paths. Hidden (`.`-prefixed) entries are skipped.
fn collect_files(
    dir: &Path,
    root: &Path,
    out: &mut Vec<(String, std::path::PathBuf)>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files(&path, root, out)?;
        } else {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, path));
        }
    }
    Ok(())
}
