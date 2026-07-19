// Thin Tauri-command wrappers over `LspState` — the frontend drives the
// tinymist bridge through these (`lsp_start` / `lsp_send` / `lsp_stop`).

use tauri::{AppHandle, Runtime, State};

use crate::lsp::LspState;

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
