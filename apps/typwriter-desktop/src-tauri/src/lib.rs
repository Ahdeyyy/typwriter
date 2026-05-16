// lib.rs — application entry point and Tauri state setup.

mod commands;
mod compiler;
mod workspace;
mod world;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use compiler::PreviewPipeline;
use tauri::{Emitter, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use typst_kit::fonts::FontSearcher;
use workspace::WorkspaceState;
use world::EditorWorld;

use commands::{
    app::is_fonts_loaded,
    click::{jump_from_click, jump_from_cursor},
    editor::{
        discard_shadow, get_completions, get_definitions, get_tooltip, read_file, save_file,
        update_file_content,
    },
    export::{
        export_pdf, export_pdf_to_uri, export_png, export_png_to_dir_uri, export_svg,
        export_svg_to_dir_uri,
    },
    format::{
        format_typst_cursor_virtual, format_typst_file, format_typst_source,
        format_workspace_typ_files,
    },
    logs::get_log_file_path,
    preview::{get_zoom, set_visible_page, set_zoom, sync_preview, trigger_preview},
    workspace::{
        clear_recent_workspaces, create_file, create_folder, create_workspace, delete_file,
        delete_folder, export_workspace_to_dir_uri, get_file_tree, get_mobile_workspaces_dir,
        get_recent_workspaces, get_workspace_tabs, import_files, import_files_from_uris,
        list_mobile_workspaces, move_file, move_folder, open_folder, remove_recent_workspace,
        rename_file, saf_tree_uri_to_path, save_workspace_tabs, set_main_file,
    },
};

/// Lightweight state managed immediately so the frontend can query readiness.
pub struct AppInit {
    pub fonts_loaded: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .plugin(tauri_plugin_android_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .max_file_size(5 * 1024 * 1024)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("typwriter-desktop".into()),
                    }),
                ])
                .rotation_strategy(RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Initial workspace root (cwd; replaced when user opens a folder) ─
            let root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

            // ── Shared state (managed immediately — fonts arrive later) ──────
            let init = Arc::new(AppInit {
                fonts_loaded: AtomicBool::new(false),
            });
            let world = Arc::new(EditorWorld::new(root, handle.clone()));
            let pipeline = Arc::new(PreviewPipeline::new(world.clone(), handle.clone()));
            pipeline.start_worker();
            let workspace = Arc::new(WorkspaceState::new(
                world.clone(),
                pipeline.clone(),
                handle.clone(),
            ));

            app.manage(init.clone());
            app.manage(world.clone());
            app.manage(pipeline);
            app.manage(workspace);

            // ── Background font loading ─────────────────────────────────────
            std::thread::spawn(move || {
                let font_results = FontSearcher::new().search();
                world.load_fonts(font_results.book, font_results.fonts);
                init.fonts_loaded.store(true, Ordering::Release);
                let _ = handle.emit("app:fonts-loaded", ());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // app init
            is_fonts_loaded,
            // workspace / file-system
            open_folder,
            create_workspace,
            get_mobile_workspaces_dir,
            list_mobile_workspaces,
            saf_tree_uri_to_path,
            set_main_file,
            get_file_tree,
            get_recent_workspaces,
            remove_recent_workspace,
            clear_recent_workspaces,
            save_workspace_tabs,
            get_workspace_tabs,
            create_file,
            create_folder,
            delete_file,
            delete_folder,
            rename_file,
            move_file,
            move_folder,
            import_files,
            import_files_from_uris,
            export_workspace_to_dir_uri,
            // editor buffer + IDE features
            read_file,
            update_file_content,
            save_file,
            discard_shadow,
            get_completions,
            get_tooltip,
            get_definitions,
            // preview control
            trigger_preview,
            sync_preview,
            set_zoom,
            get_zoom,
            set_visible_page,
            // bidirectional jump
            jump_from_click,
            jump_from_cursor,
            // logs
            get_log_file_path,
            // export
            export_pdf,
            export_pdf_to_uri,
            export_png,
            export_png_to_dir_uri,
            export_svg,
            export_svg_to_dir_uri,
            // format
            format_typst_source,
            format_typst_cursor_virtual,
            format_typst_file,
            format_workspace_typ_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
