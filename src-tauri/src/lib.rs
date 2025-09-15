use crate::workspace::{RenderResponse, WorkSpace};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
mod typst_compiler;
mod workspace;
mod world;

// Open a workspace at the given path
#[tauri::command]
fn open_workspace(
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
#[tauri::command]
fn open_file(
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

// Compile the currently active file in the workspace
// during the compilation emit diagnostics that can be captured in the frontend
// emit the compiled pages that can be rendered in the frontend
#[tauri::command]
fn compile_file(
    app: AppHandle,
    state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
    source: String,
    file_path: String,
    version: u64,
) -> Result<(), ()> {
    let mut ws = state.lock().unwrap();
    let path = PathBuf::from(file_path);

    match ws.as_mut() {
        Some(workspace) => match workspace.compile_file(&path, source) {
            Ok((pages, diagnostics)) => {
                let _ = app.emit("compilation-diagnostics", diagnostics);

                let rendered_pages = workspace.render_current_pages(pages, 1.0);

                #[derive(Serialize, Clone, Debug)]
                struct RenderedPagesEvent {
                    version: u64,
                    pages: Vec<RenderResponse>,
                }

                let payload = RenderedPagesEvent {
                    version,
                    pages: rendered_pages,
                };
                let _ = app.emit("rendered-pages", payload);

                return Ok(());
            }
            Err(diagnostics) => {
                let _ = app.emit("compilation-diagnostics", diagnostics);
                #[derive(Serialize, Clone, Debug)]
                struct RenderedPagesEvent {
                    version: u64,
                    pages: Vec<RenderResponse>,
                }
                let payload = RenderedPagesEvent {
                    version,
                    pages: Vec::<RenderResponse>::new(),
                };
                let _ = app.emit("rendered-pages", payload);

                return Ok(());
            }
        },
        None => {
            dbg!("no workspace open");
            return Err(());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    let builder = tauri::Builder::default().plugin(tauri_plugin_devtools::init());
    #[cfg(not(debug_assertions))]
    let builder = tauri::Builder::default();

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_svelte::init())
        .setup(move |app| {
            app.manage(Mutex::new(None::<WorkSpace>));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            open_file,
            compile_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
