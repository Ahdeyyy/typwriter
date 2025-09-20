use crate::workspace::WorkSpace;
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter};

fn char_to_byte_position(str: &str, char_position: usize) -> usize {
    str.char_indices()
        .map(|(i, _)| i)
        .nth(char_position)
        .unwrap_or(str.len())
}

#[derive(Serialize, Clone, Debug)]
struct PreviewPosition {
    page: usize,
    x: f64,
    y: f64,
}

// #[derive(Serialize, Clone, Debug)]
// struct RenderEventPayload {
//     pages: Vec<RenderResponse>,
// }

// #[derive(Serialize, Clone, Debug)]
// struct DiagnosticEventPayload {
//     diagnostics: Vec<TypstSourceDiagnostic>,
// }

// #[derive(Serialize, Clone, Debug)]
// struct PreviewPositionPayload {
//     position: PreviewPosition,
// }

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
