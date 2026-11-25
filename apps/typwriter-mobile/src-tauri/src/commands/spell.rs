//! Spell-check commands. See `crate::spell` for which checker answers.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_spellcheck::NativeSpellcheckExt;

use crate::spell::{SpellEngine, SpellReport, SpellState, SUGGESTION_LIMIT};

/// Caps on one request, so a runaway caller can't park the keyboard's service
/// or a blocking thread on a whole book. The frontend batches well below them.
const MAX_TEXTS: usize = 64;
const MAX_TOTAL_UTF16: usize = 32_000;

/// Which engine answered last (0: none yet, 1: native, 2: bundled), so the
/// log says when it changes — `adb logcat | grep spell` on a device.
static LAST_ENGINE: AtomicU8 = AtomicU8::new(0);

fn note_engine(engine: SpellEngine, results: &[Vec<crate::spell::SpellIssue>]) {
    let code = match engine {
        SpellEngine::Native => 1,
        SpellEngine::Bundled => 2,
    };
    if LAST_ENGINE.swap(code, Ordering::Relaxed) != code {
        let issues: usize = results.iter().map(Vec::len).sum();
        log::info!(
            "spell: now checking with the {engine:?} engine ({} texts, {issues} issues)",
            results.len()
        );
    }
}

/// Check prose paragraphs (already stripped of Typst markup by the frontend).
/// Offsets in the report are UTF-16, relative to each text.
#[tauri::command]
pub async fn spell_check(
    app: AppHandle,
    state: State<'_, Arc<SpellState>>,
    texts: Vec<String>,
) -> Result<SpellReport, String> {
    let mut total = 0;
    let texts: Vec<String> = texts
        .into_iter()
        .take(MAX_TEXTS)
        .take_while(|text| {
            total += text.encode_utf16().count();
            total <= MAX_TOTAL_UTF16
        })
        .collect();

    if !state.native_paused() {
        match app.native_spellcheck().check(&texts, SUGGESTION_LIMIT).await {
            Ok(Some(results)) => {
                let results: Vec<Vec<_>> = results
                    .into_iter()
                    .map(|issues| issues.into_iter().map(Into::into).collect())
                    .collect();
                note_engine(SpellEngine::Native, &results);
                return Ok(SpellReport {
                    engine: SpellEngine::Native,
                    results,
                });
            }
            Ok(None) => {}
            Err(err) => {
                log::warn!("spell: device spellchecker failed, using the bundled one: {err}");
                state.pause_native();
            }
        }
    }

    let state = state.inner().clone();
    let results = tauri::async_runtime::spawn_blocking(move || state.check_bundled(&texts))
        .await
        .map_err(|err| format!("spell check failed: {err}"))?;
    note_engine(SpellEngine::Bundled, &results);
    Ok(SpellReport {
        engine: SpellEngine::Bundled,
        results,
    })
}

/// Suggestions for a word the bundled dictionary flagged. (The device's
/// service sends its suggestions with the check.)
#[tauri::command]
pub async fn spell_suggest(
    state: State<'_, Arc<SpellState>>,
    word: String,
) -> Result<Vec<String>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.suggest(&word))
        .await
        .map_err(|err| format!("spell suggestions failed: {err}"))
}
