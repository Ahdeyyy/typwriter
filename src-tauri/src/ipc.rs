use crate::app_state::AppState;
use crate::compiler;
use crate::compiler::{
    render_file, DocumentClickResponse, FileExportError, PreviewPosition, RenderResponse,
    TypstCompiler, TypstSourceDiagnostic,
};
use crate::manager::ProjectManager;
use crate::utils::{char_to_byte_position, pixel_to_point};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Emitter;
use tauri::{path::BaseDirectory, AppHandle, Manager};
// use tokio::sync::RwLock;
use typst::layout::{Abs, Point};

/// IPC command to compile a file with its source text
/// Emits the compilation diagnostics and rendered pages back to the frontend
/// Emits the position of the cursor in the compiled output
/// TODO: Better errors
///

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

#[derive(Debug, Serialize, Deserialize)]
pub enum CursorPositionError {
    NoCompilationCache,
    NoPosition,
}
#[tauri::command(rename_all = "snake_case")]
pub async fn get_cursor_position(
    state: tauri::State<'_, AppState>,
    cursor_position: usize,
    source: String,
) -> Result<PreviewPosition, CursorPositionError> {
    let compiler = state.compiler.read().await;
    let byte_position = char_to_byte_position(&source, cursor_position);
    if let Some(cache) = compiler.get_cache() {
        let position = compiler
            .get_preview_page_from_cursor(cache, byte_position, state.render_scale)
            .await;
        if let Some(position) = position {
            Ok(position)
        } else {
            Err(CursorPositionError::NoPosition)
        }
    } else {
        Err(CursorPositionError::NoCompilationCache)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum RenderError {
    NoCompilationCache,
    NoPage,
}
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
                let rendered_page = compiler::render_page(page, state.render_scale);
                return Ok(rendered_page);
            }
            None => return Err(RenderError::NoPage),
        }
    } else {
        return Err(RenderError::NoCompilationCache);
    }
}

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

#[derive(Debug, Serialize, Deserialize)]
pub enum ClickError {
    NoWorkspace,
    NoPage,
    NoCompilationCache,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn page_click(
    state: tauri::State<'_, AppState>,
    page_number: usize,
    source_text: String,
    x: f64,
    y: f64,
) -> Result<DocumentClickResponse, ClickError> {
    let compiler = state.compiler.read().await;
    let page = compiler.get_cached_page(page_number);

    match page {
        Some(page) => {
            let frame = page.frame.clone();
            let point = Point::new(
                Abs::pt(pixel_to_point(x, state.render_scale)),
                Abs::pt(pixel_to_point(y, state.render_scale)),
            );

            if let Some(doc) = compiler.get_cache() {
                let response = compiler
                    .handle_preview_page_click(source_text, doc, &frame, point)
                    .await;
                Ok(response)
            } else {
                Err(ClickError::NoCompilationCache)
            }
        }
        None => Err(ClickError::NoPage),
    }
}

// Open a workspace at the given path
#[tauri::command(rename_all = "snake_case")]
pub async fn open_workspace(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), ()> {
    let resource_path = app
        .path()
        .resolve("fonts/", BaseDirectory::Resource)
        .unwrap_or_default();

    let root = PathBuf::from(path);
    let mut project_manager = state.project.write().await;
    let mut compiler = state.compiler.write().await;
    *project_manager = ProjectManager::new(root.clone());
    *compiler = TypstCompiler::new(root, resource_path);
    Ok(())
}

// Open a file in the currently active workspace
#[tauri::command(rename_all = "snake_case")]
pub async fn open_file(state: tauri::State<'_, AppState>, file_path: String) -> Result<(), ()> {
    let mut project_manager = state.project.write().await;

    project_manager.set_active_file(PathBuf::from(file_path));

    Ok(())
}

/// TODO: add additional formats for the export function
/// TODO: error status for frontend
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

#[tauri::command(rename_all = "snake_case")]
pub async fn autocomplete(
    state: tauri::State<'_, AppState>,
    source_text: String,
    cursor_position: usize,
    explicit: bool,
) -> Result<Option<crate::compiler::CompletionResponse>, ()> {
    let compiler = state.compiler.read().await;
    let byte_position = char_to_byte_position(&source_text, cursor_position);

    match compiler.get_cache() {
        Some(doc) => {
            let completions = compiler
                .get_completions(source_text, doc, byte_position, explicit)
                .await;
            Ok(completions)
        }
        None => {
            // No compilation cache available
            Ok(None)
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn tooltip(
    state: tauri::State<'_, AppState>,
    source_text: String,
    cursor_position: usize,
) -> Result<Option<crate::compiler::TooltipResponse>, ()> {
    let compiler = state.compiler.read().await;

    let tooltip_info = compiler
        .tooltip_hover_information(source_text, cursor_position)
        .await;
    Ok(tooltip_info)
}
