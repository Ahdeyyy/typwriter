//! Tauri commands for the grammar checker.
//!
//! Checking a document is CPU-bound and scales with file size, so every
//! command that touches the lint group runs on a blocking thread — the first
//! call also pays for building the dictionary and the curated linters.

use std::sync::Arc;

use log::info;
use tauri::{AppHandle, State};

use crate::commands::settings::write_grammar_config;
use crate::grammar::engine::{GrammarConfig, GrammarEngine, GrammarReport, GrammarRuleInfo};

/// Check one file's text. `path` is workspace-relative and only decides which
/// parser is used and whether the file has been opted out.
#[tauri::command]
pub async fn check_grammar(
    engine: State<'_, Arc<GrammarEngine>>,
    path: String,
    text: String,
) -> Result<GrammarReport, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.check(&path, &text))
        .await
        .map_err(|err| format!("grammar check failed: {err}"))
}

#[tauri::command(async)]
pub fn get_grammar_config(engine: State<'_, Arc<GrammarEngine>>) -> GrammarConfig {
    engine.config()
}

#[tauri::command(async)]
pub fn set_grammar_config(
    handle: AppHandle,
    engine: State<'_, Arc<GrammarEngine>>,
    config: GrammarConfig,
) {
    engine.set_config(config.clone());
    write_grammar_config(&handle, &config);
}

/// The full rule catalog for the settings pane. Forces the lint group to be
/// built, hence the blocking thread.
#[tauri::command]
pub async fn get_grammar_rules(
    engine: State<'_, Arc<GrammarEngine>>,
) -> Result<Vec<GrammarRuleInfo>, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.rule_catalog())
        .await
        .map_err(|err| format!("could not read grammar rules: {err}"))
}

/// Add a word to the user dictionary — the "Add to dictionary" quick fix.
/// Returns the updated config so the frontend stays in sync.
#[tauri::command(async)]
pub fn add_grammar_dictionary_word(
    handle: AppHandle,
    engine: State<'_, Arc<GrammarEngine>>,
    word: String,
) -> GrammarConfig {
    let config = engine.add_dictionary_word(&word);
    write_grammar_config(&handle, &config);
    config
}

/// Turn checking on or off for a single file.
#[tauri::command(async)]
pub fn set_grammar_file_enabled(
    handle: AppHandle,
    engine: State<'_, Arc<GrammarEngine>>,
    path: String,
    enabled: bool,
) -> GrammarConfig {
    let config = engine.set_file_enabled(&path, enabled);
    write_grammar_config(&handle, &config);
    config
}

/// Build the engine from the persisted configuration. The lint group itself is
/// constructed lazily on the first check, so this is cheap enough for setup.
pub fn init_engine(handle: &AppHandle) -> Arc<GrammarEngine> {
    let config = crate::commands::settings::read_grammar_config(handle);
    if config.enabled {
        info!(
            "grammar: enabled ({} custom rules, {} dictionary words)",
            config.rules.len(),
            config.user_dictionary.len()
        );
    }
    Arc::new(GrammarEngine::new(config))
}
