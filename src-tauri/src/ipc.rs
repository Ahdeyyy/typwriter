use crate::utils::{byte_position_to_char_position, char_to_byte_position, pixel_to_point};
use crate::workspace::{self, DocumentClickResponseType, WorkSpace};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use typst::layout::{Abs, Point};

#[derive(Serialize, Clone, Debug)]
struct PreviewPosition {
    page: usize,
    x: f64,
    y: f64,
}

/// IPC command to compile a file with its source text
/// Emits the compilation diagnostics and rendered pages back to the frontend
/// Emits the position of the cursor in the compiled output

#[tauri::command(rename_all = "snake_case")]
pub fn compile_file(
    app: AppHandle,
    state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
    source: String,
    file_path: String,
    scale: f32,
    cursor_position: usize,
) -> Result<(), ()> {
    let mut ws = state.lock().unwrap();

    match ws.as_mut() {
        Some(workspace) => {
            let path = PathBuf::from(file_path);
            let byte_position = char_to_byte_position(&source, cursor_position);
            match workspace.compile_file(&path, source.clone()) {
                Ok((pages, diagnostics)) => {
                    let _ = app.emit("source-diagnostics", diagnostics);
                    let rendered_pages = workspace.render_current_pages(pages, scale);
                    let _ = app.emit("rendered-pages", rendered_pages);
                    if let Some(compilation_cache) = workspace.get_compilation_cache() {
                        if let Some(position) = workspace.move_document_to_cursor(
                            compilation_cache,
                            source,
                            byte_position,
                        ) {
                            let x = position.point.x.to_pt() * scale as f64;
                            let y = position.point.y.to_pt() * scale as f64;
                            let pos = PreviewPosition {
                                page: position.page.into(),
                                x,
                                y,
                            };
                            let _ = app.emit("preview-position", pos);
                        }
                    }
                }
                Err(diagnostics) => {
                    let _ = app.emit("source-diagnostics", diagnostics);
                }
            }
            Ok(())
        }
        None => {
            // No active workspace
            return Err(());
        }
    }
}

#[derive(Serialize, Clone, Debug)]
struct DocumentPosition {
    page: usize,
    x: f64,
    y: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ClickError {
    NoWorkspace,
    NoPage,
    NoCompilationCache,
}

#[tauri::command(rename_all = "snake_case")]
pub fn page_click(
    state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
    page_number: usize,
    source_text: String,
    x: f64,
    y: f64,
) -> Result<DocumentClickResponseType, ClickError> {
    let workspace = state.lock().unwrap();

    println!("=== Page Click Debug ===");
    println!("Page: {}, Raw coords: ({:.1}, {:.1})", page_number, x, y);
    match workspace.as_ref() {
        Some(ws) => {
            let scale = ws.get_render_scale();
            let page = ws.get_page_from_cache(page_number);
            match page {
                Some(doc) => {
                    let frame = doc.frame.clone();
                    let point = Point::new(
                        Abs::pt(pixel_to_point(x, scale)),
                        Abs::pt(pixel_to_point(y, scale)),
                    );
                    println!(
                        "click point: ({}, {}) scale: {}",
                        point.x.to_raw(),
                        point.y.to_raw(),
                        scale
                    );
                    match ws.get_compilation_cache() {
                        Some(cache) => {
                            return Ok(ws.document_click(source_text, cache, &frame, &point))
                        }
                        None => {
                            println!("No compilation cache available");
                            return Err(ClickError::NoCompilationCache);
                        }
                    }
                }
                None => {
                    println!("No page found in cache for page number: {}", page_number);
                    return Err(ClickError::NoPage);
                }
            }
        }
        None => {
            return Err(ClickError::NoWorkspace);
        }
    }
}

// Open a workspace at the given path
#[tauri::command(rename_all = "snake_case")]
pub fn open_workspace(
    app: AppHandle,
    state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
    path: String,
) -> Result<(), ()> {
    let resource_path = app
        .path()
        .resolve("fonts/", BaseDirectory::Resource)
        .unwrap_or_default();

    let mut ws = state.lock().unwrap();
    *ws = Some(WorkSpace::new(PathBuf::from(path), resource_path));
    Ok(())
}

// Open a file in the currently active workspace
#[tauri::command(rename_all = "snake_case")]
pub fn open_file(
    state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
    file_path: String,
) -> Result<(), ()> {
    let mut workspace = state.lock().unwrap();
    match workspace.as_mut() {
        Some(ws) => {
            ws.set_active_file(PathBuf::from(file_path));
            return Ok(());
        }
        None => {
            return Err(());
        }
    }
}

// TODO: add additional formats for the export function
#[tauri::command(rename_all = "snake_case")]
pub fn export_to(
    state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
    file_path: String,
    export_path: String,
    source: String,
) -> Result<(), ()> {
    let mut workspace = state.lock().unwrap();
    dbg!("=== EXPORT_FILE CALLED ===");
    dbg!(export_path.clone());
    match workspace.as_mut() {
        Some(ws) => {
            let _ = ws.export_file(
                &PathBuf::from(file_path),
                source,
                &PathBuf::from(export_path.clone()),
                crate::workspace::ExportFormat::Pdf,
            );
            dbg!("=== EXPORT_FILE SUCCEEDED ===");
            dbg!(export_path.clone());
        }
        None => {
            dbg!("=== EXPORT_FILE FAILED ===");
            dbg!(export_path);

            return Err(());
        }
    }
    Ok(())
}
