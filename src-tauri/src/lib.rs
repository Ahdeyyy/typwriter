mod ipc;
pub mod utils;
mod workspace;
pub mod world;
use ipc::{compile_file, export_to, open_file, open_workspace, page_click};
use std::sync::Mutex;
use tauri::Manager;
use workspace::WorkSpace;

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
            export_to,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
