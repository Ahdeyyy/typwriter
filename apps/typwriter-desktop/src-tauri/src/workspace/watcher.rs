// workspace/watcher.rs
//
// Wraps the `notify` crate to watch the workspace root for changes that
// originate outside the editor (external editors, version control checkouts,
// asset pipeline output, etc.).
//
// When a change is detected the affected file's EditorWorld cache entry is
// invalidated and the PreviewPipeline is asked to re-compile and emit updated
// page events to the frontend.

use std::{path::PathBuf, sync::mpsc, sync::Arc, thread, time::Duration};

use notify::{
    event::{EventKind, ModifyKind},
    Event, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{compiler::PreviewPipeline, world::EditorWorld};

// ─── IPC payload ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct FileChangedPayload {
    path: String,
}

// ─── Public entry point ───────────────────────────────────────────────────────

/// Start a recursive watcher on `root`.  Returns the watcher handle which the
/// caller must keep alive (dropping it stops watching).
pub fn start_watcher(
    root: PathBuf,
    world: Arc<EditorWorld>,
    pipeline: Arc<PreviewPipeline>,
    app_handle: AppHandle,
) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(&root, RecursiveMode::Recursive)?;

    // Move the blocking receiver loop to a background thread.
    thread::spawn(move || {
        dispatch_loop(rx, world, pipeline, app_handle);
    });

    Ok(watcher)
}

// ─── Event loop ───────────────────────────────────────────────────────────────

fn dispatch_loop(
    rx: mpsc::Receiver<notify::Result<Event>>,
    world: Arc<EditorWorld>,
    pipeline: Arc<PreviewPipeline>,
    app_handle: AppHandle,
) {
    // Collect events with a short debounce so rapid sequences of writes
    // (e.g. a file save that creates a .tmp then renames) don't fire multiple
    // full recompiles.
    let debounce = Duration::from_millis(100);

    loop {
        // Wait for the first event.
        let first = match rx.recv() {
            Ok(ev) => ev,
            Err(_) => break, // sender dropped — watcher was stopped
        };

        // Drain any additional events that arrive within the debounce window.
        let mut batch: Vec<notify::Result<Event>> = vec![first];
        loop {
            match rx.recv_timeout(debounce) {
                Ok(ev) => batch.push(ev),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }

        // Collect distinct affected paths.
        let mut paths: Vec<PathBuf> = batch
            .into_iter()
            .flatten()
            .filter(|ev| is_relevant(ev))
            .flat_map(|ev| ev.paths)
            .collect();
        paths.sort();
        paths.dedup();

        if paths.is_empty() {
            continue;
        }

        // Invalidate each affected file in the EditorWorld.
        // Skip files with an active shadow — the shadow content takes
        // priority in World::source anyway, and invalidating here would
        // just cause a redundant recompile.
        for path in &paths {
            if let Some(id) = world.path_to_id(path) {
                if !world.has_shadow(id) {
                    world.invalidate_file(id);
                }
            }
            // Emit event to the frontend so the file tree can refresh.
            let path_str = path.to_string_lossy().to_string();
            let _ = app_handle.emit(
                "workspace:file-changed",
                FileChangedPayload { path: path_str },
            );
        }

        // Trigger a recompile and stream updated pages.
        pipeline.trigger_compile_and_emit();
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Only react to meaningful content events — ignore access-time or
/// metadata-only changes so we don't recompile on every directory crawl.
fn is_relevant(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Modify(ModifyKind::Any)
    )
}
