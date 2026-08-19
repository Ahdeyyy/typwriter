// Wraps the `notify` crate to watch the workspace root for changes that
// originate outside the editor (external editors, version control checkouts,
// asset pipeline output, etc.).
//
// A raw `notify` batch is a stream of low-level events; the frontend needs to
// know *what happened to which path* so it can reload a clean buffer, warn
// about a dirty one, close a tab whose file is gone, and follow a rename. That
// translation is [`classify`]: it pairs the two halves of a rename back
// together, collapses the several events one write produces into a single
// change, and settles create-vs-modify-vs-remove against the filesystem as it
// stands once the batch has gone quiet.
//
// The affected files' EditorWorld cache entries are invalidated and the
// PreviewPipeline is asked to re-compile, so the preview follows the disk too.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path, PathBuf},
    sync::mpsc,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use log::info;
use notify::{
    event::{EventKind, ModifyKind, RenameMode},
    Event, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    compiler::{CompileReason, PreviewPipeline},
    workspace::self_writes::SelfWriteLog,
    world::EditorWorld,
};

/// What happened to a path between two quiet moments on disk.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    /// The path did not exist before and does now.
    Created,
    /// The path existed before and its contents changed.
    Modified,
    /// The path is gone.
    Removed,
    /// The path moved to `to`, which is still inside the workspace.
    Renamed,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Absolute path. For a rename this is where the entry *was*.
    pub path: String,
    pub kind: ChangeKind,
    /// Where a renamed entry landed. `None` for every other kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    /// Whether the entry is a directory. Always `false` for `Removed`, where
    /// there is nothing left to ask — the frontend treats a removed path as
    /// covering everything beneath it regardless.
    pub is_dir: bool,
}

#[derive(Serialize, Clone)]
struct FilesChangedPayload {
    changes: Vec<FileChange>,
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
    self_writes: Arc<SelfWriteLog>,
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
        dispatch_loop(root, rx, world, pipeline, app_handle, self_writes);
    });

    Ok(watcher)
}

fn dispatch_loop(
    root: PathBuf,
    rx: mpsc::Receiver<notify::Result<Event>>,
    world: Arc<EditorWorld>,
    pipeline: Arc<PreviewPipeline>,
    app_handle: AppHandle,
    self_writes: Arc<SelfWriteLog>,
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
        let events: Vec<Event> = batch
            .into_iter()
            .flatten()
            .filter(|ev| is_relevant(ev))
            .collect();

        // Settling create/modify/remove against the *current* filesystem is
        // only sound now that the batch has gone quiet — that's why this runs
        // after the debounce rather than per event.
        let changes = classify(events, &probe_disk);

        // Drop changes the editor itself caused. A save cannot change the shape
        // of the tree, the world cache already holds exactly those bytes (see
        // `EditorWorld::shadow_commit`), and every in-app file operation has
        // already updated the frontend — so passing these through would only
        // discard a good parse tree and make the app re-walk and re-read a
        // workspace that is already in the state it expects. External edits to
        // other files in the same batch survive.
        let changes = scope_changes(&root, changes, |path| self_writes.is_recent(path));

        if changes.is_empty() {
            continue;
        }

        for change in &changes {
            for path in change_paths(change) {
                if let Some(id) = world.path_to_id(path) {
                    // A file with a live shadow is an open buffer with unsaved
                    // edits. Disk is not the authority for it until the user
                    // decides — the frontend prompts, and dropping the shadow
                    // here would throw those edits away behind their back.
                    if !world.has_shadow(id) {
                        world.invalidate_file(id);
                    }
                }
            }
        }

        // Before the frontend hears about it: the compiler's own main-file
        // pointer has to survive a rename or delete done by another program,
        // and the compile queued at the bottom of this loop runs against it.
        if let Some(state) = app_handle.try_state::<Arc<crate::workspace::WorkspaceState>>() {
            state.reconcile_main_file(&changes);
        }

        let count = changes.len();
        let _ = app_handle.emit("workspace:files-changed", FilesChangedPayload { changes });

        info!(
            "watcher_batch: processed {count} change(s) ({:.1}ms)",
            t_batch.elapsed().as_secs_f64() * 1000.0
        );

        pipeline.request_compile(CompileReason::Watcher);
    }
}

/// The paths a change touches: both endpoints of a rename, one for the rest.
fn change_paths(change: &FileChange) -> impl Iterator<Item = &Path> {
    std::iter::once(Path::new(change.path.as_str())).chain(change.to.as_deref().map(Path::new))
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

// ─── Classification ──────────────────────────────────────────────────────────

/// `None` when the path does not exist, `Some(is_dir)` when it does.
type Probe = dyn Fn(&Path) -> Option<bool>;

fn probe_disk(path: &Path) -> Option<bool> {
    std::fs::metadata(path).ok().map(|meta| meta.is_dir())
}

/// Turn one debounced batch of `notify` events into the set of changes the
/// frontend acts on: one entry per path, renames paired back up, and each kind
/// settled against `probe` (the filesystem as it stands now).
///
/// Platform backends describe a rename in three different ways — a single
/// `Name(Both)` carrying two paths, a `Name(From)`/`Name(To)` couple sharing a
/// tracker id, or (when the other half fell outside the watch) just one of
/// them. All three are handled here so the frontend only ever sees `Renamed`
/// with both endpoints, or a plain create/remove when the move crossed the
/// workspace boundary.
fn classify(events: Vec<Event>, probe: &Probe) -> Vec<FileChange> {
    let mut pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    // Keyed by notify's rename tracker. BTreeMap, not HashMap: an unpaired
    // half falls through to the plain set, and the order it does so in decides
    // the emitted order — which the tests (and a reader diffing two runs)
    // should be able to rely on.
    let mut rename_from: BTreeMap<usize, PathBuf> = BTreeMap::new();
    let mut rename_to: BTreeMap<usize, PathBuf> = BTreeMap::new();
    // path -> "some event for it was a creation". Several events for one path
    // collapse into a single change; the flag is what separates a file that
    // appeared from one that was overwritten in place.
    let mut plain: BTreeMap<PathBuf, bool> = BTreeMap::new();

    let mut note = |path: PathBuf, created: bool| {
        let entry = plain.entry(path).or_insert(false);
        *entry |= created;
    };

    for event in events {
        let created = matches!(event.kind, EventKind::Create(_));
        match event.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() == 2 => {
                let mut paths = event.paths.into_iter();
                let from = paths.next().expect("len checked");
                let to = paths.next().expect("len checked");
                pairs.push((from, to));
            }
            EventKind::Modify(ModifyKind::Name(mode @ (RenameMode::From | RenameMode::To))) => {
                let tracker = event.attrs.tracker();
                for path in event.paths {
                    match tracker {
                        Some(tracker) if mode == RenameMode::From => {
                            rename_from.insert(tracker, path);
                        }
                        Some(tracker) => {
                            rename_to.insert(tracker, path);
                        }
                        // No tracker to pair on: let the existence probe below
                        // decide, which gets the common case right anyway (the
                        // old path is gone, the new one is there).
                        None => note(path, mode == RenameMode::To),
                    }
                }
            }
            _ => {
                for path in event.paths {
                    note(path, created);
                }
            }
        }
    }

    // A half whose partner never arrived moved across the watch boundary.
    for (tracker, from) in std::mem::take(&mut rename_from) {
        match rename_to.remove(&tracker) {
            Some(to) => pairs.push((from, to)),
            None => note(from, false),
        }
    }
    for (_, to) in std::mem::take(&mut rename_to) {
        note(to, true);
    }

    let mut out: Vec<FileChange> = Vec::new();
    let mut paired: BTreeSet<PathBuf> = BTreeSet::new();

    for (from, to) in pairs {
        paired.insert(from.clone());
        paired.insert(to.clone());
        match probe(&to) {
            Some(is_dir) => out.push(FileChange {
                path: display(&from),
                kind: ChangeKind::Renamed,
                to: Some(display(&to)),
                is_dir,
            }),
            // Renamed and then deleted again before the batch settled. All the
            // frontend can act on is that `from` is gone.
            None => out.push(removed(&from)),
        }
    }

    for (path, created) in plain {
        if paired.contains(&path) {
            continue;
        }
        out.push(match probe(&path) {
            Some(is_dir) => FileChange {
                path: display(&path),
                kind: if created {
                    ChangeKind::Created
                } else {
                    ChangeKind::Modified
                },
                to: None,
                is_dir,
            },
            None => removed(&path),
        });
    }

    out
}

fn removed(path: &Path) -> FileChange {
    FileChange {
        path: display(path),
        kind: ChangeKind::Removed,
        to: None,
        is_dir: false,
    }
}

fn display(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Drop everything the app should not react to, and rewrite the changes that
/// are only partly out of scope.
///
/// A path is out of scope when it sits in an ignored directory or when the
/// editor itself just wrote it (`is_self_write`). A rename can have exactly one
/// endpoint out of scope, and then it is not a rename any more from the app's
/// point of view: a file moved *into* `node_modules` has been removed, and one
/// moved out of it has appeared.
fn scope_changes(
    root: &Path,
    changes: Vec<FileChange>,
    is_self_write: impl Fn(&Path) -> bool,
) -> Vec<FileChange> {
    let out_of_scope =
        |path: &Path| is_ignored_path(root, path) || is_self_write(path);

    changes
        .into_iter()
        .filter_map(|change| {
            let from = PathBuf::from(&change.path);
            let from_out = out_of_scope(&from);
            let Some(to) = change.to.as_deref().map(PathBuf::from) else {
                return (!from_out).then_some(change);
            };
            match (from_out, out_of_scope(&to)) {
                (true, true) => None,
                (false, false) => Some(change),
                (true, false) => Some(FileChange {
                    path: display(&to),
                    kind: ChangeKind::Created,
                    to: None,
                    is_dir: change.is_dir,
                }),
                (false, true) => Some(removed(&from)),
            }
        })
        .collect()
}

fn is_ignored_path(root: &Path, path: &Path) -> bool {
    // notify only fires for paths under what we watch, so strip_prefix should
    // always succeed. If it doesn't, the event is outside our scope — treat
    // it as ignored rather than scanning unrelated parent components for
    // accidental name matches (e.g. a user's "~/node_modules").
    let Ok(rel) = path.strip_prefix(root) else {
        return true;
    };
    rel.components().any(|component| match component {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            IGNORED_DIRS
                .iter()
                .any(|ignored| name.eq_ignore_ascii_case(ignored))
        }
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::{classify, scope_changes, ChangeKind, FileChange, Probe};
    use notify::event::{
        CreateKind, DataChange, EventAttributes, EventKind, ModifyKind, RemoveKind, RenameMode,
    };
    use notify::Event;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    /// A stand-in filesystem: names present in `dirs` probe as directories,
    /// names in `files` as files, everything else as gone.
    fn probe_with(files: &[&str], dirs: &[&str]) -> impl Fn(&Path) -> Option<bool> {
        let mut map: HashMap<PathBuf, bool> = HashMap::new();
        for f in files {
            map.insert(PathBuf::from(f), false);
        }
        for d in dirs {
            map.insert(PathBuf::from(d), true);
        }
        move |path: &Path| map.get(path).copied()
    }

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        Event {
            kind,
            paths: paths.iter().map(PathBuf::from).collect(),
            attrs: EventAttributes::new(),
        }
    }

    fn tracked(kind: EventKind, path: &str, tracker: usize) -> Event {
        let mut attrs = EventAttributes::new();
        attrs.set_tracker(tracker);
        Event {
            kind,
            paths: vec![PathBuf::from(path)],
            attrs,
        }
    }

    fn run(events: Vec<Event>, probe: impl Fn(&Path) -> Option<bool> + 'static) -> Vec<FileChange> {
        let probe: Box<Probe> = Box::new(probe);
        classify(events, probe.as_ref())
    }

    #[test]
    fn a_write_collapses_into_one_modification() {
        // One save from an external editor fans out into several events for the
        // same path; the frontend must be told once, not four times.
        let events = vec![
            event(EventKind::Modify(ModifyKind::Any), &["/w/main.typ"]),
            event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &["/w/main.typ"],
            ),
            event(EventKind::Modify(ModifyKind::Any), &["/w/main.typ"]),
        ];
        let changes = run(events, probe_with(&["/w/main.typ"], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Modified);
        assert_eq!(changes[0].path, "/w/main.typ");
        assert!(!changes[0].is_dir);
    }

    #[test]
    fn a_create_that_survives_the_batch_is_a_creation() {
        let events = vec![
            event(EventKind::Create(CreateKind::File), &["/w/new.typ"]),
            event(EventKind::Modify(ModifyKind::Any), &["/w/new.typ"]),
        ];
        let changes = run(events, probe_with(&["/w/new.typ"], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Created);
    }

    #[test]
    fn a_path_that_no_longer_exists_is_a_removal() {
        // An atomic save writes a temp file and renames it over the target; the
        // temp file is created and gone by the time the batch settles. Whatever
        // the events said, "not there any more" is the only truth left.
        let events = vec![
            event(EventKind::Create(CreateKind::File), &["/w/main.typ.tmp"]),
            event(EventKind::Remove(RemoveKind::File), &["/w/main.typ.tmp"]),
        ];
        let changes = run(events, probe_with(&[], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Removed);
        assert_eq!(changes[0].path, "/w/main.typ.tmp");
    }

    #[test]
    fn a_directory_creation_reports_is_dir() {
        let events = vec![event(EventKind::Create(CreateKind::Folder), &["/w/assets"])];
        let changes = run(events, probe_with(&[], &["/w/assets"]));
        assert_eq!(changes[0].kind, ChangeKind::Created);
        assert!(changes[0].is_dir);
    }

    #[test]
    fn a_both_ended_rename_is_paired_from_one_event() {
        let events = vec![event(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &["/w/old.typ", "/w/new.typ"],
        )];
        let changes = run(events, probe_with(&["/w/new.typ"], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Renamed);
        assert_eq!(changes[0].path, "/w/old.typ");
        assert_eq!(changes[0].to.as_deref(), Some("/w/new.typ"));
    }

    #[test]
    fn split_rename_halves_are_paired_by_tracker() {
        // Windows and Linux both report the two ends separately; without the
        // tracker they would look like an unrelated delete and create, and an
        // open tab would be closed instead of following the file.
        let events = vec![
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                "/w/old.typ",
                7,
            ),
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::To)),
                "/w/new.typ",
                7,
            ),
        ];
        let changes = run(events, probe_with(&["/w/new.typ"], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Renamed);
        assert_eq!(changes[0].to.as_deref(), Some("/w/new.typ"));
    }

    #[test]
    fn rename_halves_with_different_trackers_stay_apart() {
        // Two unrelated renames in one batch must not be cross-paired.
        let events = vec![
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                "/w/a.typ",
                1,
            ),
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::To)),
                "/w/b.typ",
                1,
            ),
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                "/w/c.typ",
                2,
            ),
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::To)),
                "/w/d.typ",
                2,
            ),
        ];
        let changes = run(events, probe_with(&["/w/b.typ", "/w/d.typ"], &[]));
        assert_eq!(changes.len(), 2);
        let pairs: Vec<(&str, Option<&str>)> = changes
            .iter()
            .map(|c| (c.path.as_str(), c.to.as_deref()))
            .collect();
        assert!(pairs.contains(&("/w/a.typ", Some("/w/b.typ"))));
        assert!(pairs.contains(&("/w/c.typ", Some("/w/d.typ"))));
    }

    #[test]
    fn an_unpaired_rename_half_falls_back_to_existence() {
        // The file was moved out of the workspace: only the `From` half is ours.
        let events = vec![tracked(
            EventKind::Modify(ModifyKind::Name(RenameMode::From)),
            "/w/gone.typ",
            3,
        )];
        let changes = run(events, probe_with(&[], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Removed);
    }

    #[test]
    fn a_rename_onto_a_path_that_vanished_degrades_to_removal() {
        let events = vec![event(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &["/w/old.typ", "/w/new.typ"],
        )];
        let changes = run(events, probe_with(&[], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Removed);
        assert_eq!(changes[0].path, "/w/old.typ");
        assert!(changes[0].to.is_none());
    }

    #[test]
    fn a_renamed_endpoint_is_not_also_reported_on_its_own() {
        // Backends often emit a Create for the destination alongside the rename
        // halves. Reporting both would make the frontend reload a file it is
        // already carrying across the rename.
        let events = vec![
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                "/w/old.typ",
                9,
            ),
            tracked(
                EventKind::Modify(ModifyKind::Name(RenameMode::To)),
                "/w/new.typ",
                9,
            ),
            event(EventKind::Create(CreateKind::File), &["/w/new.typ"]),
        ];
        let changes = run(events, probe_with(&["/w/new.typ"], &[]));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Renamed);
    }

    #[test]
    fn unrelated_files_in_one_batch_all_survive() {
        let events = vec![
            event(EventKind::Modify(ModifyKind::Any), &["/w/a.typ"]),
            event(EventKind::Create(CreateKind::File), &["/w/b.typ"]),
            event(EventKind::Remove(RemoveKind::File), &["/w/c.typ"]),
        ];
        let changes = run(events, probe_with(&["/w/a.typ", "/w/b.typ"], &[]));
        assert_eq!(changes.len(), 3);
    }

    // ─── scope_changes ───────────────────────────────────────────────────────

    fn change(path: &str, kind: ChangeKind, to: Option<&str>) -> FileChange {
        FileChange {
            path: path.to_string(),
            kind,
            to: to.map(str::to_string),
            is_dir: false,
        }
    }

    #[test]
    fn ignored_directories_are_dropped() {
        let changes = vec![
            change("/w/node_modules/x.js", ChangeKind::Modified, None),
            change("/w/.git/HEAD", ChangeKind::Modified, None),
            change("/w/.typwriter/history/x", ChangeKind::Created, None),
            change("/w/main.typ", ChangeKind::Modified, None),
        ];
        let kept = scope_changes(Path::new("/w"), changes, |_| false);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].path, "/w/main.typ");
    }

    #[test]
    fn self_writes_are_dropped_but_neighbours_are_not() {
        // The whole point: an external tool touching a *different* file in the
        // same batch must still reach the frontend.
        let changes = vec![
            change("/w/mine.typ", ChangeKind::Modified, None),
            change("/w/theirs.typ", ChangeKind::Modified, None),
        ];
        let kept = scope_changes(Path::new("/w"), changes, |p| {
            p == Path::new("/w/mine.typ")
        });
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].path, "/w/theirs.typ");
    }

    #[test]
    fn a_move_into_an_ignored_directory_reads_as_a_removal() {
        let changes = vec![change(
            "/w/main.typ",
            ChangeKind::Renamed,
            Some("/w/node_modules/main.typ"),
        )];
        let kept = scope_changes(Path::new("/w"), changes, |_| false);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].kind, ChangeKind::Removed);
        assert_eq!(kept[0].path, "/w/main.typ");
        assert!(kept[0].to.is_none());
    }

    #[test]
    fn a_move_out_of_an_ignored_directory_reads_as_a_creation() {
        let changes = vec![change(
            "/w/target/out.typ",
            ChangeKind::Renamed,
            Some("/w/out.typ"),
        )];
        let kept = scope_changes(Path::new("/w"), changes, |_| false);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].kind, ChangeKind::Created);
        assert_eq!(kept[0].path, "/w/out.typ");
    }

    #[test]
    fn a_rename_wholly_inside_an_ignored_directory_is_dropped() {
        let changes = vec![change(
            "/w/dist/a.js",
            ChangeKind::Renamed,
            Some("/w/dist/b.js"),
        )];
        assert!(scope_changes(Path::new("/w"), changes, |_| false).is_empty());
    }

    #[test]
    fn a_path_outside_the_root_is_ignored() {
        let changes = vec![change("/elsewhere/main.typ", ChangeKind::Modified, None)];
        assert!(scope_changes(Path::new("/w"), changes, |_| false).is_empty());
    }
}
