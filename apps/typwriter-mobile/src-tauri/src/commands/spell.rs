//! Spell-check commands. See `crate::spell` for who checks what.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_spellcheck::{NativeIssueKind, NativeSpellcheckExt};

use crate::spell::{SpellIssue, SpellReport, SpellState, SUGGESTION_LIMIT};

/// Caps on one request, so a runaway caller can't park the keyboard's service
/// or a blocking thread on a whole book. The frontend batches well below them.
const MAX_TEXTS: usize = 64;
const MAX_TOTAL_UTF16: usize = 32_000;

/// Whether the device answered for grammar last time (0: not asked yet,
/// 1: yes, 2: no), so the log says when that changes —
/// `adb logcat | grep spell` on a device.
static LAST_GRAMMAR: AtomicU8 = AtomicU8::new(0);

fn note_grammar(answered: bool) {
    let code = if answered { 1 } else { 2 };
    if LAST_GRAMMAR.swap(code, Ordering::Relaxed) != code {
        if answered {
            log::info!("spell: spelling from the bundled dictionary, grammar from the device");
        } else {
            log::info!("spell: spelling from the bundled dictionary, no grammar checker on the device");
        }
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

    // Spelling: the bundled dictionary, on a blocking thread, while the
    // device's service is asked for grammar alongside it.
    let bundled = {
        let state = state.inner().clone();
        let texts = texts.clone();
        tauri::async_runtime::spawn_blocking(move || state.check_bundled(&texts))
    };
    let grammar = device_grammar(&app, &state, &texts).await;
    let mut results = bundled
        .await
        .map_err(|err| format!("spell check failed: {err}"))?;

    note_grammar(grammar.is_some());
    let device_grammar = grammar.is_some();
    if let Some(grammar) = grammar {
        for (issues, flagged) in results.iter_mut().zip(grammar) {
            if flagged.is_empty() {
                continue;
            }
            issues.extend(flagged);
            issues.sort_by_key(|issue| (issue.start, issue.end));
        }
    }
    Ok(SpellReport {
        results,
        device_grammar,
    })
}

/// The grammar issues the device's spellchecker service finds in `texts`
/// (its spelling ones are dropped: the bundled dictionary has the say on
/// spelling), or `None` when there's no service, it failed, or it's in its
/// back-off after a failure.
async fn device_grammar<R: Runtime>(
    app: &AppHandle<R>,
    state: &SpellState,
    texts: &[String],
) -> Option<Vec<Vec<SpellIssue>>> {
    if state.native_paused() {
        return None;
    }
    match app.native_spellcheck().check(texts, SUGGESTION_LIMIT).await {
        Ok(Some(results)) => Some(
            results
                .into_iter()
                .map(|issues| {
                    issues
                        .into_iter()
                        .filter(|issue| issue.kind == NativeIssueKind::Grammar)
                        .map(Into::into)
                        .collect()
                })
                .collect(),
        ),
        Ok(None) => None,
        Err(err) => {
            log::warn!("spell: device spellchecker failed, checking without grammar: {err}");
            state.pause_native();
            None
        }
    }
}

/// Suggestions for a misspelled word, from the bundled dictionary.
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
