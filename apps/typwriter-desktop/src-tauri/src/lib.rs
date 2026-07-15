// lib.rs — application entry point and Tauri state setup.

mod commands;
mod compiler;
mod lsp;
mod vcs;
mod workspace;
mod world;

use std::sync::Arc;

use compiler::{parse_key, PreviewPipeline};
use parking_lot::RwLock;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use vcs::VcsState;
use workspace::WorkspaceState;
use world::EditorWorld;

use commands::{
    app::{is_fonts_loaded, prepare_onboarding_workspace},
    click::{jump_from_click, jump_from_cursor},
    editor::{
        discard_shadow, get_completions, get_definitions, get_tooltip, read_file, save_file,
        update_file_content,
    },
    export::{export_html, export_pdf, export_png, export_svg},
    format::{
        format_typst_cursor_virtual, format_typst_file, format_typst_source,
        format_workspace_typ_files,
    },
    logs::get_log_file_path,
    lsp::{lsp_send, lsp_start, lsp_stop},
    preview::{get_zoom, set_visible_page, set_zoom, sync_preview, trigger_preview},
    settings::{
        get_app_settings, get_onboarding_completed, list_font_families, set_app_settings,
        set_onboarding_completed, set_typst_font_directories,
    },
    vcs::{
        vcs_create_restore_point, vcs_current_id, vcs_diff_between, vcs_diff_vs_current,
        vcs_list_history, vcs_restore_file, vcs_restore_workspace,
    },
    workspace::{
        clear_recent_workspaces, create_file, create_folder, create_workspace, delete_file,
        delete_folder, get_file_tree, get_recent_workspaces, get_workspace_tabs, import_files,
        move_file, move_folder, open_folder, remove_recent_workspace, rename_file,
        save_workspace_tabs, set_main_file,
    },
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("previewimg", |ctx, request| {
            // URL form on Windows: http://previewimg.localhost/{key}.png
            // URL form on macOS/Linux: previewimg://localhost/{key}.png
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
        .on_window_event(|window, event| {
            // The preview pane can be popped out into its own `preview` window.
            // It outlives the main window (and keeps the process alive), so
            // closing the main window would otherwise leave it orphaned on
            // screen. Tear it down whenever the main window goes away — handled
            // here in Rust so it fires on every close path, not just the ones
            // where the frontend gets to run its cleanup.
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                )
            {
                if let Some(preview) = window.app_handle().get_webview_window("preview") {
                    // `destroy` rather than `close`: a forced teardown that the
                    // preview window's own JS can't prevent, so the orphan is
                    // guaranteed to go away.
                    let _ = preview.destroy();
                }

                // Kill the tinymist child so it never outlives the app.
                if let Some(lsp) = window.app_handle().try_state::<lsp::LspState>() {
                    lsp.stop();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Initial workspace root (cwd; replaced when user opens a folder) ─
            let root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

            // ── Shared state (managed immediately — fonts arrive later) ──────
            // `vcs` is constructed first: it owns the `WorkingTreeFs` provider
            // the world reads source files through.
            let vcs = Arc::new(VcsState::new(handle.clone()));
            let world = Arc::new(EditorWorld::new(root, handle.clone(), vcs.clone()));
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

            app.manage(world.clone());
            app.manage(pipeline);
            app.manage(workspace);
            app.manage(vcs);
            app.manage(snapshot_policy);
            app.manage(lsp::LspState::default());

            // Fonts are loaded lazily: the first workspace open (and, as a
            // safety net, the first compile) calls `EditorWorld::ensure_fonts_loading`,
            // so the system font scan overlaps the rest of the open path instead
            // of blocking startup. See `world::mod`.

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // app init
            is_fonts_loaded,
            prepare_onboarding_workspace,
            // workspace / file-system
            open_folder,
            create_workspace,
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
            // language server (tinymist) bridge
            lsp_start,
            lsp_send,
            lsp_stop,
            // settings
            get_app_settings,
            set_app_settings,
            get_onboarding_completed,
            set_onboarding_completed,
            list_font_families,
            set_typst_font_directories,
            // export
            export_pdf,
            export_png,
            export_svg,
            export_html,
            // format
            format_typst_source,
            format_typst_cursor_virtual,
            format_typst_file,
            format_workspace_typ_files,
            // versioning / restore points
            vcs_create_restore_point,
            vcs_current_id,
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
