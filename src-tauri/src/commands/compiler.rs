use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{
    app_state::AppState,
    compiler::{render_file, FileExportError, RenderResponse, TypstSourceDiagnostic},
    utils::char_to_byte_position,
};

/// compiles the typst source code at a given file path
/// gets the file_path and source text
/// returns a vector of diagnostics
#[tauri::command(rename_all = "snake_case")]
pub async fn compile(
    state: tauri::State<'_, AppState>,
    file_path: String,
    source: String,
) -> Result<Vec<TypstSourceDiagnostic>, ()> {
    let mut compiler = state.compiler.write().await;
    let path = PathBuf::from(file_path);
    let (_, diagnostics) = compiler.compile_file(&path, source);
    Ok(diagnostics)
}

/// possible errors when trying to render the document
#[derive(Debug, Serialize, Deserialize)]
pub enum RenderError {
    NoCompilationCache,
    NoPage,
}

/// renders the current main document
/// returns a vector of render response on success
/// returns render error on failure
#[tauri::command(rename_all = "snake_case")]
pub async fn render(state: tauri::State<'_, AppState>) -> Result<Vec<RenderResponse>, RenderError> {
    let compiler = state.compiler.read().await;
    if let Some(cache) = compiler.get_cache() {
        let rendered_pages = render_file(cache.pages.clone(), state.render_scale);
        return Ok(rendered_pages);
    } else {
        return Err(RenderError::NoCompilationCache);
    }
}

/// same as render but only renders a single page
/// gets the page to be rendered
/// returns a render response on ok
/// and returns a render error on failure
#[tauri::command(rename_all = "snake_case")]
pub async fn render_page(
    state: tauri::State<'_, AppState>,
    page: usize,
) -> Result<RenderResponse, RenderError> {
    let compiler = state.compiler.read().await;
    if let Some(cache) = compiler.get_cache() {
        let page = cache.pages.get(page);
        match page {
            Some(page) => {
                let rendered_page = crate::compiler::render_page(page, state.render_scale);
                return Ok(rendered_page);
            }
            None => return Err(RenderError::NoPage),
        }
    } else {
        return Err(RenderError::NoCompilationCache);
    }
}

/// deprecated
/// compiles and renders the document
#[tauri::command(rename_all = "snake_case")]
pub async fn compile_file(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source: String,
    file_path: String,
    cursor_position: usize,
) -> Result<(), ()> {
    let mut compiler = state.compiler.write().await;
    let path = PathBuf::from(file_path);
    let byte_position = char_to_byte_position(&source, cursor_position);

    let (pages, diagnostics) = compiler.compile_file(&path, source);

    let rendered_pages = render_file(pages, state.render_scale);
    let _ = app.emit("rendered-pages", rendered_pages);

    if let Some(cache) = compiler.get_cache() {
        let position = compiler
            .get_preview_page_from_cursor(cache, byte_position, state.render_scale)
            .await;
        if let Some(position) = position {
            let _ = app.emit("preview-position", position);
        }
    }

    let _ = app.emit("source-diagnostics", diagnostics);
    Ok(())
}

// TODO: add additional formats for the export function
// TODO: error status for frontend
/// exports a compiled typst document to the given path
/// currently only exports to pdf, support for svg and png coming
#[tauri::command(rename_all = "snake_case")]
pub async fn export_to(
    state: tauri::State<'_, AppState>,
    file_path: String,
    export_path: String,
    source: String,
) -> Result<(), FileExportError> {
    let mut compiler = state.compiler.write().await;

    let _ = compiler
        .export_file(
            &PathBuf::from(file_path),
            source,
            &PathBuf::from(export_path),
            None,
        )
        .await?;

    Ok(())
}
