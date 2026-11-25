//! A Rust-side bridge to Android's spellchecker service — the same service
//! (Gboard, Samsung Keyboard, …) that underlines words in ordinary text
//! fields, in the user's languages, with their personal dictionary. The
//! checking runs in the keyboard's process, not ours.
//!
//! The plugin has no JS commands. The app calls [`NativeSpellcheck::check`]
//! and treats `Ok(None)` — no service on this device, the user switched it
//! off, or not Android at all — as the cue to use its bundled dictionary.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// What the service flagged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeIssueKind {
    Spelling,
    /// `RESULT_ATTR_LOOKS_LIKE_GRAMMAR_ERROR` (Android 12+). Only some
    /// services report it — Gboard does, for the languages it covers.
    Grammar,
}

/// One flagged range, in UTF-16 code units of the text it was found in.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeIssue {
    pub start: usize,
    pub end: usize,
    pub kind: NativeIssueKind,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Read only on Android.
struct NativeResponse {
    available: bool,
    #[serde(default)]
    results: Vec<Vec<NativeIssue>>,
}

pub struct NativeSpellcheck<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> NativeSpellcheck<R> {
    /// Check each of `texts` with the device's spellchecker. Returns one list
    /// of issues per text, in order, or `None` when there is no service to
    /// ask. An `Err` means the service was there but failed or timed out.
    pub async fn check(
        &self,
        texts: &[String],
        suggestion_limit: usize,
    ) -> Result<Option<Vec<Vec<NativeIssue>>>, String> {
        #[cfg(target_os = "android")]
        {
            let response: NativeResponse = self
                .handle
                .run_mobile_plugin_async(
                    "check",
                    serde_json::json!({ "texts": texts, "suggestionLimit": suggestion_limit }),
                )
                .await
                .map_err(|e| e.to_string())?;
            if !response.available {
                return Ok(None);
            }
            if response.results.len() != texts.len() {
                return Err(format!(
                    "spellchecker answered {} of {} texts",
                    response.results.len(),
                    texts.len()
                ));
            }
            Ok(Some(response.results))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (texts, suggestion_limit);
            Ok(None)
        }
    }
}

/// `app.native_spellcheck()`.
pub trait NativeSpellcheckExt<R: Runtime> {
    fn native_spellcheck(&self) -> &NativeSpellcheck<R>;
}

impl<R: Runtime, T: Manager<R>> NativeSpellcheckExt<R> for T {
    fn native_spellcheck(&self) -> &NativeSpellcheck<R> {
        self.state::<NativeSpellcheck<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("spellcheck")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let state = NativeSpellcheck {
                handle: _api
                    .register_android_plugin("com.typwriter.spellcheck", "SpellcheckPlugin")?,
            };
            #[cfg(not(target_os = "android"))]
            let state = NativeSpellcheck::<R> {
                _runtime: std::marker::PhantomData,
            };
            app.manage(state);
            Ok(())
        })
        .build()
}
