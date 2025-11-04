use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::typst_compiler::{
    app_state::AppState,
    compiler::{
        CompilationError, CompletionResponse, DocumentClickResponse, ExportError, ExportFormat,
        ExportPngOptions, ExportSvgOptions, PreviewPosition, RenderResponse, TooltipResponse,
        TypstSourceDiagnostic,
    },
};

#[derive(Debug, Serialize, Deserialize)]
pub enum RenderError {
    NoCompilationCache,
    NoPage,
}

/// command to render all pages
#[tauri::command(rename_all = "snake_case")]
pub async fn render_pages(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RenderResponse>, RenderError> {
    let compiler = state.compiler.read().await;
    let rendered_pages = compiler.render_main();

    if rendered_pages.is_empty() {
        Err(RenderError::NoCompilationCache)
    } else {
        Ok(rendered_pages)
    }
}

/// command to render a single page
/// gets the page to be rendered
/// 0-indexed
#[tauri::command(rename_all = "snake_case")]
pub async fn render_page(
    state: tauri::State<'_, AppState>,
    page: usize,
) -> Result<RenderResponse, RenderError> {
    let compiler = state.compiler.read().await;
    compiler.render_page_n(page).ok_or(RenderError::NoPage)
}

/// command to compile the main file
#[tauri::command(rename_all = "snake_case")]
pub async fn compile_main_file(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TypstSourceDiagnostic>, CompilationError> {
    let mut compiler = state.compiler.write().await;
    compiler.compile_main()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_cursor_position_info_extern(
    state: tauri::State<'_, AppState>,
    cursor: usize,
    source_text: String,
    source_path: String,
) -> Result<PreviewPosition, ()> {
    let compiler = state.compiler.write().await;
    let path = PathBuf::from(source_path);
    match compiler.get_position_info_extern(cursor, source_text, path) {
        Some(position) => Ok(position),
        None => Err(()),
    }
}

/// command to autocomplete at a given position
#[tauri::command(rename_all = "snake_case")]
pub async fn autocomplete_at_position(
    state: tauri::State<'_, AppState>,
    source_text: String,
    cursor_position: usize,
    explicit: bool,
) -> Result<Option<CompletionResponse>, ()> {
    let compiler = state.compiler.read().await;
    let completions = compiler.get_autocomplete_suggestions(source_text, cursor_position, explicit);
    Ok(completions)
}

/// command to provide hover information at a given position
#[tauri::command(rename_all = "snake_case")]
pub async fn provide_hover_info(
    state: tauri::State<'_, AppState>,
    source_text: String,
    cursor_position: usize,
) -> Result<Option<TooltipResponse>, ()> {
    let compiler = state.compiler.read().await;
    let tooltip = compiler.get_hover_tooltip_info(source_text, cursor_position);
    Ok(tooltip)
}

/// command to handle document click at a given point
#[tauri::command(rename_all = "snake_case")]
pub async fn document_click_at_point(
    state: tauri::State<'_, AppState>,
    source_text: String,
    page_number: usize,
    x: f64,
    y: f64,
) -> Result<DocumentClickResponse, ()> {
    let compiler = state.compiler.read().await;
    let response = compiler.handle_page_click(source_text, page_number, x, y);
    Ok(response)
}

/// command to open a workspace
#[tauri::command(rename_all = "snake_case")]
pub async fn open_workspace(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), ()> {
    use tauri::path::BaseDirectory;

    let resource_path = app
        .path()
        .resolve("fonts/", BaseDirectory::Resource)
        .unwrap_or_default();

    let root = PathBuf::from(path);
    let mut compiler = state.compiler.write().await;

    *compiler = crate::typst_compiler::compiler::TypstCompiler::new(root, resource_path);

    Ok(())
}

/// command to update file source
#[tauri::command(rename_all = "snake_case")]
pub async fn update_file_source(
    state: tauri::State<'_, AppState>,
    path: String,
    source: String,
) -> Result<(), ()> {
    let mut compiler = state.compiler.write().await;
    let file_path = PathBuf::from(path);
    compiler.update_file_in_world(&file_path, source);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_pages_len(state: tauri::State<'_, AppState>) -> Result<usize, ()> {
    let compiler = state.compiler.read().await;
    Ok(compiler.get_pages_len())
}

/// command to export the main file
#[tauri::command(rename_all = "snake_case")]
pub async fn export_main_file(
    state: tauri::State<'_, AppState>,
    export_path: PathBuf,
    format: String,
    start_page: Option<usize>,
    end_page: Option<usize>,
    merged: bool,
) -> Result<(), ExportError> {
    let mut compiler = state.compiler.write().await;
    let start_page = start_page.unwrap_or_default();
    let end_page = end_page.unwrap_or_default();
    let export_format = match format.to_lowercase().as_str() {
        "pdf" => ExportFormat::PDF,
        "png" => ExportFormat::PNG(ExportPngOptions {
            start_page,
            end_page,
        }),
        "svg" => ExportFormat::SVG(ExportSvgOptions {
            start_page,
            end_page,
            merged,
        }),
        _ => return Err(ExportError::UnsupportedFormat),
    };
    compiler.export_main(export_path, export_format)
}

/// command to set the main file
#[tauri::command(rename_all = "snake_case")]
pub async fn set_main_file(state: tauri::State<'_, AppState>, path: String) -> Result<(), ()> {
    let mut compiler = state.compiler.write().await;
    let file_path = PathBuf::from(path);
    let _ = compiler.set_active_file(file_path);
    Ok(())
}

/// command to add a new file
#[tauri::command(rename_all = "snake_case")]
pub async fn add_new_file(
    state: tauri::State<'_, AppState>,
    path: String,
    source: String,
) -> Result<(), ()> {
    let path = PathBuf::from(path);
    let mut compiler = state.compiler.write().await;
    compiler.add_file_to_world(path.clone(), source);

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_cursor_position_info(
    state: tauri::State<'_, AppState>,
    cursor: usize,
    source_text: String,
) -> Result<PreviewPosition, ()> {
    let compiler = state.compiler.write().await;
    match compiler.get_cursor_position_info(cursor, source_text) {
        Some(position) => Ok(position),
        None => Err(()),
    }
}
