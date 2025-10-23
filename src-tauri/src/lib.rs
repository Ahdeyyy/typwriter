mod typst_compiler;
pub mod utils;

pub mod world;
// use app_state::AppState;

// use commands::compiler::{
//     compile, compile_file, create_file, export_to, render, render_page, update_file,
// };
// use commands::editor::{autocomplete, get_cursor_position, page_click, tooltip};
// use commands::workspace::{open_file, open_workspace};

// use tauri::AppHandle;
use typst_compiler::app_state::AppState;
use typst_compiler::commands::{
    add_new_file, autocomplete_at_position, compile_main_file, document_click_at_point,
    export_main_file, get_cursor_position_info, open_workspace, provide_hover_info, render_page,
    render_pages, set_main_file, update_file_source,
};

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
            add_new_file,
            autocomplete_at_position,
            compile_main_file,
            export_main_file,
            set_main_file,
            update_file_source,
            render_page,
            render_pages,
            provide_hover_info,
            document_click_at_point,
            open_workspace,
            get_cursor_position_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
