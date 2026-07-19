// commands/editor.rs
//
// Editor-facing commands: read_file, save_file, get_completions. Plus the
// UTF-16 ↔ UTF-8 offset helpers that bridge CodeMirror (UTF-16 code units) and
// Typst (UTF-8 byte offsets). Every offset crossing IPC is in UTF-16 units.

use std::{sync::Arc, time::Instant};

use base64::Engine;
use log::info;
use serde::Serialize;
use tauri::State;
use typst::syntax::Source;
use typst_layout::PagedDocument;

use crate::{compiler::CompileState, workspace::resolve_in_root, world::MobileWorld};

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileContent {
    Text { content: String },
    Image { mime: String, data: String },
    Unsupported,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub kind: String,
    pub label: String,
    pub apply: Option<String>,
    pub detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionsResponse {
    /// UTF-16 offset where the completion replaces text.
    pub from: usize,
    pub completions: Vec<CompletionItem>,
}

/// Server-side cap on the completion list — the touch strip can't use more.
const MAX_COMPLETIONS: usize = 48;

fn workspace_root(world: &MobileWorld) -> Result<std::path::PathBuf, String> {
    world.root().ok_or_else(|| "No workspace open".to_string())
}

#[tauri::command]
pub async fn read_file(
    rel_path: String,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<FileContent, String> {
    let t = Instant::now();
    let root = workspace_root(&world)?;
    let abs = resolve_in_root(&root, &rel_path)?;

    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let image_mime = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        _ => None,
    };

    if let Some(mime) = image_mime {
        let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        info!(
            "read_file: ok image {rel_path:?} bytes={} ({:.1}ms)",
            bytes.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Ok(FileContent::Image {
            mime: mime.to_string(),
            data: format!("data:{mime};base64,{encoded}"),
        });
    }

    let is_text = matches!(
        ext.as_str(),
        "typ" | "txt" | "md" | "json" | "toml" | "yaml" | "yml" | "csv" | "bib" | "xml"
    );
    if is_text {
        let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
        info!(
            "read_file: ok text {rel_path:?} bytes={} ({:.1}ms)",
            content.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        return Ok(FileContent::Text { content });
    }

    info!("read_file: unsupported {rel_path:?} ext={ext:?}");
    Ok(FileContent::Unsupported)
}

#[tauri::command]
pub async fn save_file(
    rel_path: String,
    content: String,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<(), String> {
    let t = Instant::now();
    let root = workspace_root(&world)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Atomic write: temp file in the same dir, then rename over the target.
    let tmp = abs.with_extension(format!(
        "{}.tmp",
        abs.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &abs).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    info!(
        "save_file: ok {rel_path:?} bytes={} ({:.1}ms)",
        content.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

#[tauri::command]
pub async fn get_completions(
    rel_path: String,
    text: String,
    cursor: usize,
    explicit: bool,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<CompletionsResponse, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    // The IDE traversal can take 100ms+ on a big document — keep it off the
    // runtime worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let id = world.rel_to_id(&rel_path)?;
        let byte_cursor = utf16_to_byte(&text, cursor);

        // Snapshot the last compiled document for richer (doc-aware) completions.
        let doc = compile.document.lock().clone();
        let doc_ref: Option<&PagedDocument> = doc.as_deref();

        let response = world.with_overlay(id, &text, |w| {
            let source = Source::new(id, text.clone());
            match typst_ide::autocomplete(w, doc_ref, &source, byte_cursor, explicit) {
                Some((from, items)) => CompletionsResponse {
                    from: byte_to_utf16(&text, from),
                    completions: items
                        .into_iter()
                        .take(MAX_COMPLETIONS)
                        .map(|c| CompletionItem {
                            kind: format!("{:?}", c.kind),
                            label: c.label.to_string(),
                            apply: c.apply.map(|a| a.to_string()),
                            detail: c.detail.map(|d| d.to_string()),
                        })
                        .collect(),
                },
                None => CompletionsResponse {
                    from: cursor,
                    completions: vec![],
                },
            }
        });

        info!(
            "get_completions: {rel_path:?} {} items explicit={explicit} ({:.1}ms)",
            response.completions.len(),
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(response)
    })
    .await
    .map_err(|e| format!("completions task panicked: {e}"))?
}

// ─── Offset conversion ───────────────────────────────────────────────────────

pub(crate) fn byte_to_utf16(text: &str, byte_offset: usize) -> usize {
    let clamped = byte_offset.min(text.len());
    text[..clamped].encode_utf16().count()
}

pub(crate) fn utf16_to_byte(text: &str, utf16_offset: usize) -> usize {
    let mut utf16_count = 0usize;
    for (byte_idx, ch) in text.char_indices() {
        if utf16_count >= utf16_offset {
            return byte_idx;
        }
        utf16_count += ch.len_utf16();
    }
    text.len()
}

#[cfg(test)]
mod tests {
    use super::{byte_to_utf16, utf16_to_byte};

    #[test]
    fn roundtrip_ascii() {
        let s = "hello world";
        for i in 0..=s.len() {
            assert_eq!(utf16_to_byte(s, byte_to_utf16(s, i)), i);
        }
    }

    #[test]
    fn handles_two_byte_char() {
        // "é" is 2 UTF-8 bytes but 1 UTF-16 unit.
        let s = "aéb";
        assert_eq!(byte_to_utf16(s, 0), 0);
        assert_eq!(byte_to_utf16(s, 1), 1); // before é
        assert_eq!(byte_to_utf16(s, 3), 2); // after é (2 bytes)
        assert_eq!(byte_to_utf16(s, 4), 3); // after b
        assert_eq!(utf16_to_byte(s, 2), 3);
    }

    #[test]
    fn handles_emoji_surrogate_pair() {
        // "😀" is 4 UTF-8 bytes and 2 UTF-16 units (surrogate pair).
        let s = "a😀b";
        assert_eq!(byte_to_utf16(s, 1), 1); // before emoji
        assert_eq!(byte_to_utf16(s, 5), 3); // after emoji (4 bytes -> +2 units)
        assert_eq!(utf16_to_byte(s, 3), 5);
    }

    #[test]
    fn out_of_range_clamps() {
        let s = "abc";
        assert_eq!(byte_to_utf16(s, 999), 3);
        assert_eq!(utf16_to_byte(s, 999), 3);
    }
}
