pub mod app_state;
mod commands;
pub mod compiler;
pub mod manager;
pub mod utils;

pub mod world;
use app_state::AppState;

use commands::compiler::{compile, compile_file, create_file, export_to, render, render_page};
use commands::editor::{autocomplete, get_cursor_position, page_click, tooltip};
use commands::workspace::{open_file, open_workspace};

use tauri::{path::BaseDirectory, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_devtools::init());
    #[cfg(not(debug_assertions))]
    let builder = tauri::Builder::default();

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_svelte::init())
        .setup(move |app| {
            let resource_path = app
                .path()
                .resolve("fonts/", BaseDirectory::Resource)
                .unwrap_or_default();
            let default_root = app
                .path()
                .resolve("./", BaseDirectory::AppData)
                .unwrap_or_default();
            app.manage(AppState::new(default_root, resource_path));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            open_file,
            compile_file,
            page_click,
            export_to,
            autocomplete,
            tooltip,
            render,
            compile,
            get_cursor_position,
            render_page,
            create_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
