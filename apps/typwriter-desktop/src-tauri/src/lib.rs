// Application entry point and Tauri state setup.

mod commands;
mod compiler;
mod grammar;
mod lsp;
mod vcs;
mod workspace;
mod world;

use std::sync::Arc;

use compiler::{parse_key, PageDiffEngine, PreviewPipeline};
use parking_lot::RwLock;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use vcs::VcsState;
use workspace::WorkspaceState;
use world::EditorWorld;

use commands::{
    app::{get_typst_version, is_fonts_loaded, prepare_onboarding_workspace},
    click::{jump_from_click, jump_from_cursor},
    editor::{
        discard_shadow, get_completions, get_definitions, get_tooltip, open_file_externally,
        read_file, reveal_file_in_manager, save_file, update_file_content,
    },
    export::{export_html, export_pdf, export_png, export_svg},
    format::{
        format_typst_cursor_virtual, format_typst_file, format_typst_source,
        format_workspace_typ_files,
    },
    grammar::{
        add_grammar_dictionary_word, check_grammar, get_grammar_config, get_grammar_rules,
        set_grammar_config, set_grammar_file_enabled,
    },
    logs::get_log_file_path,
    lsp::{lsp_probe, lsp_send, lsp_start, lsp_stop},
    packages::list_packages,
    present::{enter_presentation, exit_presentation, list_displays},
    preview::{get_zoom, set_visible_page, set_zoom, sync_preview, trigger_preview},
    search::{replace_in_workspace, search_workspace},
    settings::{
        get_app_settings, get_export_presets, get_onboarding_completed, get_user_snippets,
        list_font_families, list_system_font_families, set_app_settings, set_export_presets,
        set_onboarding_completed, set_typst_font_directories, set_user_snippets,
    },
    vcs::{
        vcs_create_restore_point, vcs_current_id, vcs_diff_between, vcs_diff_vs_current,
        vcs_list_history, vcs_page_diff_cancel, vcs_page_diff_render_page,
        vcs_page_diff_request, vcs_restore_file, vcs_restore_workspace,
    },
    workspace::{
        clear_recent_workspaces, create_file, create_folder, create_workspace, delete_file,
        delete_folder, get_file_tree, get_project_snippets, get_recent_workspaces,
        get_workspace_tabs, import_dropped, import_files, move_file, move_folder, open_folder,
        remove_recent_workspace, rename_file, save_workspace_tabs, set_main_file,
        set_project_snippets,
    },
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .register_asynchronous_uri_scheme_protocol("previewimg", |ctx, request, responder| {
            // URL form on Windows: http://previewimg.localhost/{key}.png
            // URL form on macOS/Linux: previewimg://localhost/{key}.png
            //
            // The path is `/{fingerprint}-{zoom}[.png]`. We strip the leading
            // `/` and parse the composite key. Including the zoom in the URL
            // is what lets the webview's HTTP cache distinguish renderings of
            // the same content at different scales — the response is marked
            // `immutable`, so a content-only URL would serve stale bytes after
            // a zoom change.
            //
            // **Asynchronous** on purpose. `page_bytes` falls through to the
            // on-disk cache on an in-memory LRU miss, so answering here can
            // mean a file read; the synchronous form ran that on the main
            // thread, and scrolling a long document turned into a burst of
            // main-thread disk reads. Mirrors the mobile app's handler.
            let path = request.uri().path().trim_start_matches('/').to_string();
            let not_found = || {
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CACHE_CONTROL, "no-store")
                    .body(Vec::new())
                    .expect("static response should build")
            };

            let Some(key) = parse_key(&path) else {
                responder.respond(not_found());
                return;
            };
            let Some(pipeline) = ctx.app_handle().try_state::<Arc<PreviewPipeline>>() else {
                responder.respond(not_found());
                return;
            };
            let pipeline = pipeline.inner().clone();
            // Page-diff thumbnails ride the same scheme but live in their own
            // LRU, so a big comparison can't evict the pages the live preview
            // is showing. Keys are `(content hash, zoom bucket)` in both
            // caches — a key present in both is the same bytes by
            // construction, so the order of the fallback doesn't matter.
            let page_diff = ctx
                .app_handle()
                .try_state::<Arc<PageDiffEngine>>()
                .map(|state| state.inner().clone());

            tauri::async_runtime::spawn_blocking(move || {
                // A panic here would previously escape into a WebView2 COM
                // callback and abort the process. It now happens on a worker
                // thread, but the frontend's `onerror` path still recovers from
                // a 404, so keep degrading to that rather than taking the
                // thread down.
                let fetched = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    pipeline
                        .page_bytes(key)
                        .or_else(|| page_diff.as_ref().and_then(|e| e.page_bytes(key)))
                }));
                let Ok(Some(bytes)) = fetched else {
                    if fetched.is_err() {
                        log::error!("previewimg: page lookup panicked key={path}");
                    }
                    responder.respond(not_found());
                    return;
                };

                responder.respond(
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::OK)
                        .header(tauri::http::header::CONTENT_TYPE, "image/png")
                        // Key encodes both content hash and zoom, so bytes are
                        // immutable for the lifetime of the cache entry. The
                        // webview is free to cache aggressively.
                        .header(
                            tauri::http::header::CACHE_CONTROL,
                            "public, max-age=31536000, immutable",
                        )
                        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(bytes)
                        .expect("png response should build"),
                );
            });
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
            // The presentation window's saved geometry (and its keep-awake
            // request) die with the window. Left behind, the snapshot would be
            // reapplied to the *next* popout the first time it exits
            // presentation, teleporting it to wherever the old one sat.
            if window.label() == commands::present::PRESENTATION_WINDOW
                && matches!(event, tauri::WindowEvent::Destroyed)
            {
                commands::present::forget_geometry(window.app_handle());
            }

            // Child windows (`preview` popout, `settings`, `diff`) outlive the
            // main window (and keep the process alive), so closing the main
            // window would otherwise leave them orphaned on screen. Tear them
            // all down whenever the main window goes away — handled here in
            // Rust so it fires on every close path, not just the ones where
            // the frontend gets to run its cleanup.
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                )
            {
                for (label, child) in window.app_handle().webview_windows() {
                    if label != "main" {
                        // `destroy` rather than `close`: a forced teardown that
                        // the child window's own JS can't prevent, so the
                        // orphan is guaranteed to go away.
                        let _ = child.destroy();
                    }
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
            // Historical compiles run on their own worker so a page
            // comparison never contends with (or blocks) the live preview.
            let page_diff = Arc::new(PageDiffEngine::new(
                world.clone(),
                vcs.clone(),
                pipeline.clone(),
                handle.clone(),
            ));
            page_diff.start_worker();

            // Snapshot policy mirrors the user's persisted prefs. Seeded
            // here so save/compile workers see the right values on the very
            // first event; refreshed on every `set_app_settings` call.
            let snapshot_policy = Arc::new(RwLock::new(
                commands::settings::snapshot_policy_from_handle(&handle),
            ));

            // Same deal for the formatter: seeded from the persisted prefs and
            // refreshed on every `set_app_settings`, so every format command
            // reads the user's current typstyle options.
            let formatter_config: commands::format::FormatterConfig = Arc::new(RwLock::new(
                commands::settings::formatter_config_from_handle(&handle),
            ));

            app.manage(world.clone());
            app.manage(pipeline);
            app.manage(page_diff);
            app.manage(workspace);
            app.manage(vcs);
            app.manage(snapshot_policy);
            app.manage(formatter_config);
            app.manage(lsp::LspState::default());
            app.manage(commands::present::PresentationState::default());
            // Cheap to construct — the dictionary and lint group behind it are
            // built on the first actual check.
            app.manage(commands::grammar::init_engine(&handle));

            // Fonts are loaded lazily: the first workspace open (and, as a
            // safety net, the first compile) calls `EditorWorld::ensure_fonts_loading`,
            // so the system font scan overlaps the rest of the open path instead
            // of blocking startup. See `world::mod`.

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // app init
            is_fonts_loaded,
            get_typst_version,
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
            import_dropped,
            // editor buffer + IDE features
            read_file,
            update_file_content,
            save_file,
            discard_shadow,
            get_completions,
            get_tooltip,
            get_definitions,
            reveal_file_in_manager,
            open_file_externally,
            // preview control
            trigger_preview,
            sync_preview,
            set_zoom,
            get_zoom,
            set_visible_page,
            // presentation mode
            list_displays,
            enter_presentation,
            exit_presentation,
            // bidirectional jump
            jump_from_click,
            jump_from_cursor,
            // grammar checking
            check_grammar,
            get_grammar_config,
            set_grammar_config,
            get_grammar_rules,
            add_grammar_dictionary_word,
            set_grammar_file_enabled,
            // logs
            get_log_file_path,
            list_packages,
            search_workspace,
            replace_in_workspace,
            // language server (tinymist) bridge
            lsp_start,
            lsp_send,
            lsp_stop,
            lsp_probe,
            // settings
            get_app_settings,
            set_app_settings,
            get_export_presets,
            set_export_presets,
            get_user_snippets,
            set_user_snippets,
            get_project_snippets,
            set_project_snippets,
            get_onboarding_completed,
            set_onboarding_completed,
            list_font_families,
            list_system_font_families,
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
            vcs_page_diff_request,
            vcs_page_diff_cancel,
            vcs_page_diff_render_page,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("fatal: tauri application exited with error: {err:?}");
            std::process::exit(1);
        });
}
