// lib.rs — application entry point and Tauri state setup.

mod commands;
mod compiler;
mod workspace;
mod world;

use std::sync::Arc;

use compiler::PreviewPipeline;
use tauri::Manager;
use typst_kit::fonts::FontSearcher;
use workspace::WorkspaceState;
use world::EditorWorld;

use commands::{
    click::{jump_from_click, jump_from_cursor},
    editor::{
        discard_shadow, get_completions, get_definitions, get_tooltip, save_file,
        update_file_content,
    },
    export::{export_pdf, export_png, export_svg},
    preview::{get_zoom, set_zoom, trigger_preview},
    workspace::{
        create_file, create_folder, delete_file, delete_folder, get_file_tree,
        get_recent_workspaces, move_file, move_folder, open_folder, rename_file, set_main_file,
    },
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Font loading ───────────────────────────────────────────────
            let font_results = FontSearcher::new().search();
            let fonts: Vec<typst::text::Font> = font_results
                .fonts
                .iter()
                .filter_map(|slot| slot.get())
                .collect();

            // ── Initial workspace root (cwd; replaced when user opens a folder) ─
            let root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

            // ── Shared state ───────────────────────────────────────────────
            let world = Arc::new(EditorWorld::new(root, fonts, handle.clone()));
            let pipeline = Arc::new(PreviewPipeline::new(world.clone(), handle.clone()));
            let workspace = Arc::new(WorkspaceState::new(
                world.clone(),
                pipeline.clone(),
                handle.clone(),
            ));

            app.manage(world);
            app.manage(pipeline);
            app.manage(workspace);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // workspace / file-system
            open_folder,
            set_main_file,
            get_file_tree,
            get_recent_workspaces,
            create_file,
            create_folder,
            delete_file,
            delete_folder,
            rename_file,
            move_file,
            move_folder,
            // editor buffer + IDE features
            update_file_content,
            save_file,
            discard_shadow,
            get_completions,
            get_tooltip,
            get_definitions,
            // preview control
            trigger_preview,
            set_zoom,
            get_zoom,
            // bidirectional jump
            jump_from_click,
            jump_from_cursor,
            // export
            export_pdf,
            export_png,
            export_svg,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
