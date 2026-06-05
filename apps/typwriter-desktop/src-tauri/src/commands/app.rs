use std::path::Path;
use std::sync::Arc;

use log::info;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use crate::world::EditorWorld;

#[tauri::command]
pub fn is_fonts_loaded(world: State<'_, Arc<EditorWorld>>) -> bool {
    world.fonts_ready()
}

/// One seed file for the onboarding workspace: a bare file name plus its
/// starting Typst source.
#[derive(Deserialize)]
pub struct OnboardingFile {
    name: String,
    content: String,
}

/// Prepare the disposable workspace used by the onboarding tutorial.
///
/// Lives under the Tauri-provided app-data directory (`<app_data>/onboarding`)
/// and is kept between runs so replaying the tutorial is instant. Each tutorial
/// step is its own `*.typ` file — giving every step a distinct *main file* is
/// what keeps the preview pipeline from ever serving one step's cached render
/// for another. The files are (re)seeded here via plain `std::fs`, which runs
/// *before* `WorkspaceState::open_folder` rebinds the editor world (so we can't
/// go through `save_file`, which resolves paths against the world root). Each
/// entry starts pristine on disk; in-session edits live in the editor world's
/// shadow buffers, not on disk.
#[tauri::command]
pub fn prepare_onboarding_workspace(
    files: Vec<OnboardingFile>,
    app: AppHandle,
) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let dir = base.join("onboarding");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create onboarding dir: {e}"))?;

    for file in &files {
        // Only accept a bare file name — guard against path traversal escaping
        // the scratch directory.
        let name = Path::new(&file.name)
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|n| *n == file.name)
            .ok_or_else(|| format!("Invalid onboarding file name: {}", file.name))?;
        let target = dir.join(name);
        std::fs::write(&target, &file.content)
            .map_err(|e| format!("Failed to seed {name}: {e}"))?;
    }

    let path = dir.to_string_lossy().into_owned();
    info!(
        "prepare_onboarding_workspace: ready at {path:?} ({} files)",
        files.len()
    );
    Ok(path)
}
