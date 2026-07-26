// Thin Tauri-command wrappers over `LspState` — the frontend drives the
// tinymist bridge through these (`lsp_start` / `lsp_send` / `lsp_stop`), plus
// `lsp_probe` for the settings UI's "is tinymist installed?" indicator.

use tauri::{AppHandle, Runtime, State};

use crate::lsp::{LspAvailability, LspState};

#[tauri::command]
pub fn lsp_start<R: Runtime>(app: AppHandle<R>, state: State<'_, LspState>) -> bool {
    state.start(&app)
}

#[tauri::command]
pub fn lsp_send(state: State<'_, LspState>, message: String) -> Result<(), String> {
    state.send(&message)
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, LspState>) {
    state.stop();
}

/// Report whether the `tinymist` CLI is installed, and which Typst version it
/// speaks relative to the one this app bundles. Runs the probe on a blocking
/// thread — it spawns a process and waits for it.
#[tauri::command]
pub async fn lsp_probe() -> LspAvailability {
    tauri::async_runtime::spawn_blocking(crate::lsp::probe)
        .await
        .unwrap_or_else(|_| LspAvailability::unavailable())
}
