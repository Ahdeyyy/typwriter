// lib.rs
//
// Tauri app assembly: the `previewimg://` URI scheme (async, renders page PNGs
// on demand), plugins, shared state, and the full invoke_handler. The IPC
// contract is documented in plans/typwriter-mobile/02-rust-core.md.

mod commands;
mod compiler;
mod renderer;
mod workspace;
mod world;

use std::{path::PathBuf, sync::Arc};

use tauri::Manager;

use compiler::CompileState;
use renderer::{parse_preview_key, Renderer};
use workspace::WorkspaceState;
use world::MobileWorld;

/// Resolve the (cache, packages) directories for the package store. Both point
/// at an app-reachable `Typwriter/Packages` dir; `std::fs` can always read it.
fn packages_dirs(app: &tauri::AppHandle) -> (Option<PathBuf>, Option<PathBuf>) {
    let base = app
        .path()
        .document_dir()
        .map(|d| d.join("Typwriter").join("Packages"))
        .or_else(|_| app.path().app_cache_dir().map(|d| d.join("packages")))
        .ok();
    if let Some(dir) = &base {
        let _ = std::fs::create_dir_all(dir);
    }
    (base.clone(), base)
}

/// App-wide font directories searched at startup: the conventional
/// `<documents>/Typwriter/Fonts/` folder plus any user-selected folder
/// persisted to `<app_data>/fonts_dir.txt` (see `set_fonts_dir`). Only existing
/// directories are returned. Changes apply on the next launch.
fn fonts_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(docs) = app.path().document_dir() {
        let conventional = docs.join("Typwriter").join("Fonts");
        if conventional.is_dir() {
            dirs.push(conventional);
        }
    }
    if let Ok(app_data) = app.path().app_data_dir() {
        if let Ok(saved) = std::fs::read_to_string(app_data.join("fonts_dir.txt")) {
            let path = PathBuf::from(saved.trim());
            if path.is_dir() && !dirs.contains(&path) {
                dirs.push(path);
            }
        }
    }
    dirs
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("previewimg", |ctx, request, responder| {
            // URL: http://previewimg.localhost/{fp}-{bucket}.png (Android/Windows)
            //      previewimg://localhost/{fp}-{bucket}.png (macOS/iOS/Linux)
            let not_found = || {
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CACHE_CONTROL, "no-store")
                    .body(Vec::new())
                    .expect("static 404 builds")
            };

            let Some((fp, bucket)) = parse_preview_key(request.uri().path()) else {
                responder.respond(not_found());
                return;
            };
            let app = ctx.app_handle().clone();
            let (Some(state), Some(renderer)) = (
                app.try_state::<Arc<CompileState>>(),
                app.try_state::<Arc<Renderer>>(),
            ) else {
                responder.respond(not_found());
                return;
            };
            let state = state.inner().clone();
            let renderer = renderer.inner().clone();

            // Rendering can take 50–300 ms; never block the protocol thread.
            tauri::async_runtime::spawn_blocking(move || {
                let response = match renderer.render(&state, &fp, bucket) {
                    Some(bytes) => tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::OK)
                        .header(tauri::http::header::CONTENT_TYPE, "image/png")
                        .header(
                            tauri::http::header::CACHE_CONTROL,
                            "public, max-age=31536000, immutable",
                        )
                        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(bytes)
                        .expect("png response builds"),
                    None => not_found(),
                };
                responder.respond(response);
            });
        })
        .plugin(tauri_plugin_android_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let (cache, pkgdir) = packages_dirs(&handle);
            let font_dirs = fonts_dirs(&handle);
            app.manage(Arc::new(MobileWorld::new(cache, pkgdir, font_dirs)));
            app.manage(Arc::new(CompileState::default()));
            app.manage(Arc::new(Renderer::new()));
            app.manage(Arc::new(WorkspaceState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::list_workspaces,
            commands::workspace::create_workspace,
            commands::workspace::delete_workspace,
            commands::workspace::open_workspace,
            commands::workspace::get_file_tree,
            commands::workspace::set_main_file,
            commands::workspace::set_last_file,
            commands::workspace::set_open_tabs,
            commands::workspace::set_fonts_dir,
            commands::workspace::create_file,
            commands::workspace::create_folder,
            commands::workspace::rename_entry,
            commands::workspace::move_entry,
            commands::workspace::delete_entry,
            commands::editor::read_file,
            commands::editor::save_file,
            commands::editor::get_completions,
            commands::compile::compile,
            commands::export::export_pdf_to_uri,
            commands::export::export_pdf_to_cache_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
