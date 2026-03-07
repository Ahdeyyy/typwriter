// workspace/watcher.rs
//
// Wraps the `notify` crate to watch the workspace root for changes that
// originate outside the editor (external editors, version control checkouts,
// asset pipeline output, etc.).
//
// When a change is detected the affected file's EditorWorld cache entry is
// invalidated and the PreviewPipeline is asked to re-compile and emit updated
// page events to the frontend.

use std::{
    path::{Component, Path, PathBuf},
    sync::mpsc,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use log::info;
use notify::{
    event::{EventKind, ModifyKind},
    Event, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{
    compiler::{CompileReason, PreviewPipeline},
    world::EditorWorld,
};

#[derive(Serialize, Clone)]
struct FilesChangedPayload {
    paths: Vec<String>,
}

const IGNORED_DIRS: &[&str] = &[
    ".typwriter",
    ".git",
    "node_modules",
    "target",
    "dist",
    ".svelte-kit",
];

pub fn start_watcher(
    root: PathBuf,
    world: Arc<EditorWorld>,
    pipeline: Arc<PreviewPipeline>,
    app_handle: AppHandle,
) -> notify::Result<RecommendedWatcher> {
    let t = Instant::now();
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(&root, RecursiveMode::Recursive)?;

    info!(
        "watcher: initialized on {:?} ({:.1}ms)",
        root.file_name().unwrap_or_default(),
        t.elapsed().as_secs_f64() * 1000.0
    );

    thread::spawn(move || {
        dispatch_loop(root, rx, world, pipeline, app_handle);
    });

    Ok(watcher)
}

fn dispatch_loop(
    root: PathBuf,
    rx: mpsc::Receiver<notify::Result<Event>>,
    world: Arc<EditorWorld>,
    pipeline: Arc<PreviewPipeline>,
    app_handle: AppHandle,
) {
    let debounce = Duration::from_millis(100);

    loop {
        let first = match rx.recv() {
            Ok(ev) => ev,
            Err(_) => break,
        };

        let mut batch: Vec<notify::Result<Event>> = vec![first];
        loop {
            match rx.recv_timeout(debounce) {
                Ok(ev) => batch.push(ev),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }

        let t_batch = Instant::now();
        let mut paths: Vec<PathBuf> = batch
            .into_iter()
            .flatten()
            .filter(|ev| is_relevant(ev))
            .flat_map(|ev| ev.paths)
            .filter(|path| !is_ignored_path(&root, path))
            .collect();
        paths.sort();
        paths.dedup();

        if paths.is_empty() {
            continue;
        }

        for path in &paths {
            if let Some(id) = world.path_to_id(path) {
                if !world.has_shadow(id) {
                    world.invalidate_file(id);
                }
            }
        }

        let payload_paths = paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        let _ = app_handle.emit(
            "workspace:files-changed",
            FilesChangedPayload {
                paths: payload_paths,
            },
        );

        info!(
            "watcher_batch: processed {} files ({:.1}ms)",
            paths.len(),
            t_batch.elapsed().as_secs_f64() * 1000.0
        );

        pipeline.request_compile(CompileReason::Watcher);
    }
}

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

fn is_ignored_path(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|component| match component {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            IGNORED_DIRS.iter().any(|ignored| name.eq_ignore_ascii_case(ignored))
        }
        _ => false,
    })
}
