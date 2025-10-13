use serde::{Deserialize, Serialize};
use typst::layout::{Abs, Point};

use crate::{
    app_state::AppState,
    compiler::{DocumentClickResponse, PreviewPosition},
    utils::pixel_to_point,
};

/// possible errors while trying to get the cursor position
#[derive(Debug, Serialize, Deserialize)]
pub enum CursorPositionError {
    NoCompilationCache,
    NoPosition,
    OutOfBounds,
}

/// gets the cursors position, maps the cursors position to its corresponding position
/// in the generated typst document
#[tauri::command(rename_all = "snake_case")]
pub async fn get_cursor_position(
    state: tauri::State<'_, AppState>,
    cursor_position: usize,
) -> Result<PreviewPosition, CursorPositionError> {
    let compiler = state.compiler.read().await;
    if let Some(cache) = compiler.get_cache() {
        let position = compiler
            .get_preview_page_from_cursor(cache, cursor_position, state.render_scale)
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

/// possible errors gotten when getting the click response
#[derive(Debug, Serialize, Deserialize)]
pub enum ClickError {
    NoWorkspace,
    NoPage,
    NoCompilationCache,
}

/// returns an action for the click on a point in the document
///
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

#[derive(Serialize, Deserialize, Debug)]
pub enum AutocompleteError {
    NoCompletion,
    CursorOutOfBounds,
    NoCompletions,
}

/// gets completions at a given cursor position
///
#[tauri::command(rename_all = "snake_case")]
pub async fn autocomplete(
    state: tauri::State<'_, AppState>,
    source_text: String,
    cursor_position: usize,
    explicit: bool,
) -> Result<Option<crate::compiler::CompletionResponse>, ()> {
    let compiler = state.compiler.read().await;

    match compiler.get_cache() {
        Some(doc) => {
            let completions = compiler
                .get_completions(source_text, doc, cursor_position, explicit)
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
