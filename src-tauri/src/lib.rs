use crate::workspace::{RenderResponse, WorkSpace};
use ipc::compile_file;
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use typst::layout::{Abs, Point};
mod ipc;
mod typst_compiler;
mod workspace;
mod world;

fn pixel_to_point(x: f64, scale: f32) -> f64 {
    // Convert image pixels back to document points
    // Since we render at scale factor, we need to divide by scale to get document coordinates
    x / scale as f64
}

fn byte_position_to_char_position(str: &str, byte_position: usize) -> usize {
    str.char_indices()
        .map(|(i, _)| i)
        .take_while(|&i| i < byte_position)
        .count()
}

#[derive(Serialize, Clone, Debug)]
struct DocumentPosition {
    page: usize,
    x: f64,
    y: f64,
}

#[tauri::command(rename_all = "snake_case")]
fn page_click(
    state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
    page_number: usize,
    source_text: String,
    x: f64,
    y: f64,
) -> Result<usize, ()> {
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
                            if let Some(byte_position) = ws.document_click(cache, &frame, &point) {
                                println!("Click resulted in byte position: {}", byte_position);
                                return Ok(byte_position_to_char_position(
                                    &source_text,
                                    byte_position,
                                ));
                            } else {
                                println!("Click did not result in a jump");
                                return Err(());
                            }
                        }
                        None => {
                            println!("No compilation cache available");
                            return Err(());
                        }
                    }
                }
                None => {
                    println!("No page found in cache for page number: {}", page_number);
                    return Err(());
                }
            }
        }
        None => {
            return Err(());
        }
    }
}

// Open a workspace at the given path
#[tauri::command(rename_all = "snake_case")]
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
// #[tauri::command]
// fn compile_file(
//     app: AppHandle,
//     state: tauri::State<'_, Mutex<Option<WorkSpace>>>,
//     source: String,
//     file_path: String,
//     scale: f32,
//     cursor_position: usize,
// ) -> Result<(), ()> {
//     let mut ws = state.lock().unwrap();
//     let path = PathBuf::from(file_path);
//     let byte_position = char_to_byte_position(&source_text, char_position);

//     match ws.as_mut() {
//         Some(workspace) => match workspace.compile_file(&path, source) {
//             Ok((pages, diagnostics)) => {
//                 let _ = app.emit("compilation-diagnostics", diagnostics);

//                 let rendered_pages = workspace.render_current_pages(pages, scale);

//                 #[derive(Serialize, Clone, Debug)]
//                 struct RenderedPagesEvent {
//                     pages: Vec<RenderResponse>,
//                 }

//                 let payload = RenderedPagesEvent {
//                     pages: rendered_pages,
//                 };
//                 let _ = app.emit("rendered-pages", payload);

//                 return Ok(());
//             }
//             Err(diagnostics) => {
//                 let _ = app.emit("compilation-diagnostics", diagnostics);
//                 #[derive(Serialize, Clone, Debug)]
//                 struct RenderedPagesEvent {
//                     pages: Vec<RenderResponse>,
//                 }
//                 let payload = RenderedPagesEvent {
//                     pages: Vec::<RenderResponse>::new(),
//                 };
//                 let _ = app.emit("rendered-pages", payload);

//                 return Ok(());
//             }
//         },
//         None => {
//             dbg!("no workspace open");
//             return Err(());
//         }
//     }
// }

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
            compile_file,
            page_click,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
