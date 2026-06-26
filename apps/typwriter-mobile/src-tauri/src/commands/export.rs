// commands/export.rs
//
// PDF export. `pdf_bytes` renders the last successfully compiled document;
// `export_pdf_to_uri` saves it through the Android SAF save dialog (or the
// desktop dialog in the dev loop); `export_pdf_to_cache_file` writes a temp PDF
// for sharing.

use std::{sync::Arc, time::Instant};

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
            id.vpath()
                .as_rootless_path()
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
pub fn export_pdf_to_uri(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<String, String> {
    let t = Instant::now();
    let bytes = pdf_bytes(&compile)?;
    let suggested = format!("{}.pdf", main_stem(&world));

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
pub fn export_pdf_to_cache_file(
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
