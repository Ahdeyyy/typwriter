// lib.rs — application entry point and Tauri state setup.

mod commands;
mod compiler;
mod vcs;
mod workspace;
mod world;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use compiler::{parse_key, PreviewPipeline};
use parking_lot::RwLock;
use tauri::{Emitter, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use typst_kit::fonts::FontSearcher;
use vcs::VcsState;
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
    settings::{
        get_app_settings, import_font_directory_uri, list_font_families, set_app_settings,
        set_typst_font_directories,
    },
    vcs::{
        vcs_create_restore_point, vcs_diff_between, vcs_diff_vs_current, vcs_list_history,
        vcs_restore_file, vcs_restore_workspace,
    },
    workspace::{
        clear_recent_workspaces, create_file, create_folder, create_workspace, delete_file,
        delete_folder, export_workspace_to_dir_uri, get_file_tree, get_mobile_workspaces_dir,
        get_recent_workspaces, get_workspace_tabs, import_files, import_files_from_uris,
        list_mobile_workspaces, move_file, move_folder, open_folder, register_saf_workspace_root,
        remove_recent_workspace, rename_file, saf_tree_uri_to_path, save_workspace_tabs,
        set_main_file,
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
        .register_uri_scheme_protocol("previewimg", |ctx, request| {
            // URL form on Windows/Android: http://previewimg.localhost/{key}.png
            // URL form on macOS/iOS/Linux: previewimg://localhost/{key}.png
            //
            // The path is `/{fingerprint}-{zoom}[.png]`. We strip the leading
            // `/` and parse the composite key. Including the zoom in the URL
            // is what lets the webview's HTTP cache distinguish renderings of
            // the same content at different scales — the response is marked
            // `immutable`, so a content-only URL would serve stale bytes after
            // a zoom change.
            let path = request.uri().path().trim_start_matches('/');
            let not_found = || {
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CACHE_CONTROL, "no-store")
                    .body(Vec::new())
                    .expect("static response should build")
            };

            let Some(key) = parse_key(path) else {
                return not_found();
            };
            let Some(pipeline) = ctx.app_handle().try_state::<Arc<PreviewPipeline>>() else {
                return not_found();
            };
            let Some(bytes) = pipeline.page_bytes(key) else {
                return not_found();
            };

            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::OK)
                .header(tauri::http::header::CONTENT_TYPE, "image/png")
                // Key encodes both content hash and zoom, so bytes are
                // immutable for the lifetime of the cache entry. The webview
                // is free to cache aggressively.
                .header(
                    tauri::http::header::CACHE_CONTROL,
                    "public, max-age=31536000, immutable",
                )
                .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(bytes)
                .expect("png response should build")
        })
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
            let vcs = Arc::new(VcsState::new(handle.clone()));
            let pipeline = Arc::new(PreviewPipeline::new(
                world.clone(),
                handle.clone(),
                vcs.clone(),
            ));
            pipeline.start_worker();
            let workspace = Arc::new(WorkspaceState::new(
                world.clone(),
                pipeline.clone(),
                vcs.clone(),
                handle.clone(),
            ));

            // Snapshot policy mirrors the user's persisted prefs. Seeded
            // here so save/compile workers see the right values on the very
            // first event; refreshed on every `set_app_settings` call.
            let snapshot_policy = Arc::new(RwLock::new(
                commands::settings::snapshot_policy_from_handle(&handle),
            ));

            app.manage(init.clone());
            app.manage(world.clone());
            app.manage(pipeline);
            app.manage(workspace);
            app.manage(vcs);
            app.manage(snapshot_policy);

            // ── Background font loading ─────────────────────────────────────
            // Pick up any extra font directories the user configured in a
            // previous session so their custom fonts are available from the
            // first compile.
            let extra_font_dirs = commands::settings::load_font_directories(&handle);
            std::thread::spawn(move || {
                let font_results = FontSearcher::new().search_with(&extra_font_dirs);
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
            register_saf_workspace_root,
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
            // settings
            get_app_settings,
            set_app_settings,
            list_font_families,
            set_typst_font_directories,
            import_font_directory_uri,
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
            // versioning / restore points
            vcs_create_restore_point,
            vcs_list_history,
            vcs_diff_vs_current,
            vcs_diff_between,
            vcs_restore_workspace,
            vcs_restore_file,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("fatal: tauri application exited with error: {err:?}");
            std::process::exit(1);
        });
}
