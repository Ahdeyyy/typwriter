// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod compiler;
mod workspace;
mod world;

use tauri::Manager;
use typst_kit::fonts::FontSearcher;
use world::EditorWorld;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Discover system fonts and, with the `embed-fonts` feature active,
            // also include Typst's bundled fonts (Libertinus, New CM, DejaVu).
            let font_results = FontSearcher::new().search();

            // Eagerly load all found fonts. FontSlot::get() returns None for
            // any slot whose file cannot be read; filter_map silently skips those.
            let fonts: Vec<typst::text::Font> = font_results
                .fonts
                .iter()
                .filter_map(|slot| slot.get())
                .collect();

            // Use the process working directory as the workspace root.
            // Commands will update this when the user opens a project.
            let root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

            app.manage(EditorWorld::new(root, fonts, handle));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
