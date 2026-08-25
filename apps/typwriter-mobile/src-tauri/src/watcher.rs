// Watches the open workspace so files changed *outside* the app — a laptop
// writing over USB, a file manager, a sync client, another editor — show up in
// the tree and in the open buffer instead of quietly going stale.
//
// ## Why polling
//
// `notify`'s recommended backend on Android is inotify, and inotify on shared
// storage is not trustworthy for this: `/storage/emulated/0` is a FUSE mount,
// and writes that reach the lower filesystem another way (MTP, `adb push`,
// MediaProvider on another app's behalf) can land without ever raising an
// event on our mount. Missing a change silently is the one failure this feature
// cannot have, so we poll instead: `PollWatcher` re-stats the tree on a timer
// and reports what actually differs, whatever wrote it. A managed workspace is
// a handful of files, which is what makes that affordable.
//
// The cost of polling is latency, not correctness — up to [`POLL_INTERVAL`]
// before a change is noticed. The frontend also asks for a rescan when the app
// returns to the foreground, which covers the case where Android froze this
// thread while the user was away.
//
// ## What is *not* here
//
// Renames are reported as a removal plus a creation, not as a move. A poll
// compares two snapshots and has nothing to pair the halves with (no inode
// tracking, no rename cookie), and guessing from size and timing would be a
// guess. In-app renames don't come through here at all — they return an
// `EntryChange` that carries the open tabs across (see `applyEntryChange` on
// the frontend) — so what this affects is only the rarer external rename, where
// closing the old tab and showing the new file in the tree is honest.

use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant, SystemTime},
};

use log::{info, warn};
use notify::{
    event::{EventKind, ModifyKind},
    Config, Event, PollWatcher, RecursiveMode, Watcher,
};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    compiler::CompileState,
    workspace::{read_meta, remap_meta, remap_rel, MetaRemap, PathRemap},
    world::MobileWorld,
};

/// How often the workspace tree is re-stated. Long enough to be invisible on
/// battery for a workspace of this size, short enough that switching back from
/// another app feels like the change was already there.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Directories never reported and never descended into. Mirrors the file tree's
/// own skip list — `.typwriter/` in particular holds the metadata this app
/// rewrites on every tab change, which would otherwise poll as constant churn.
const IGNORED_DIRS: &[&str] = &[".typwriter"];

/// What happened to a path between two polls.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Workspace-relative, `/`-separated — the coordinate space every other
    /// path crossing this IPC boundary uses.
    pub rel_path: String,
    pub kind: ChangeKind,
    /// Whether the entry is a directory. Always `false` for `Removed`, where
    /// there is nothing left to ask; the frontend treats a removed path as
    /// covering everything beneath it either way.
    pub is_dir: bool,
}

#[derive(Serialize, Clone)]
struct FilesChangedPayload {
    changes: Vec<FileChange>,
}

// ─── Self-write suppression ──────────────────────────────────────────────────

/// What a file looked like the moment the app finished writing it. `None`
/// records a deletion: "we expect this path to be gone".
type Stamp = Option<(u64, Option<SystemTime>)>;

fn stamp_of(path: &Path) -> Stamp {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

/// Beyond this many records the oldest are dropped. A workspace has nowhere
/// near this many files; the cap only exists so a long session that renames
/// through hundreds of paths can't grow the map without bound.
const MAX_SELF_WRITES: usize = 512;

/// Writes the app performed itself, so the poll that notices them doesn't send
/// the app chasing its own tail.
///
/// Every autosave would otherwise come back as an external change: the tree
/// would be re-walked, and the buffer the user is typing into would be
/// reconciled against the bytes it had just produced.
///
/// Records are matched by *state*, not by a time window. A record claims an
/// event only while the file still looks exactly as the app left it, so there
/// is no interval in which a genuine external edit can hide behind one of ours
/// — the moment someone else writes, the stamp stops matching and the record
/// retires itself.
#[derive(Default)]
pub struct SelfWriteLog {
    entries: Mutex<HashMap<PathBuf, (Stamp, Instant)>>,
}

impl SelfWriteLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that the app just wrote `path`. Call *after* the write lands:
    /// the stamp has to describe the finished file.
    pub fn note_write(&self, path: &Path) {
        self.record(path, stamp_of(path));
    }

    /// Record that the app just deleted `path` (or moved it away).
    pub fn note_removal(&self, path: &Path) {
        self.record(path, None);
    }

    fn record(&self, path: &Path, stamp: Stamp) {
        let mut entries = self.entries.lock();
        entries.insert(path.to_path_buf(), (stamp, Instant::now()));
        if entries.len() > MAX_SELF_WRITES {
            // Cheapest correct eviction: drop the single oldest record. Losing
            // one only costs a redundant refresh.
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, (_, at))| *at)
                .map(|(path, _)| path.clone())
            {
                entries.remove(&oldest);
            }
        }
    }

    /// Whether `path` still looks exactly as the app last left it — in which
    /// case the event reporting it is ours and should go no further.
    ///
    /// A record that no longer matches is dropped: something else has written
    /// the file, and every later event for it must get through.
    pub fn claims(&self, path: &Path) -> bool {
        let mut entries = self.entries.lock();
        let Some((expected, _)) = entries.get(path) else {
            return false;
        };
        if *expected == stamp_of(path) {
            return true;
        }
        entries.remove(path);
        false
    }

    /// Forget everything. Called when the workspace changes: the paths belong
    /// to a root we are no longer watching.
    pub fn clear(&self) {
        self.entries.lock().clear();
    }
}

// ─── Watcher state ───────────────────────────────────────────────────────────

/// Tauri-managed. Owns the live watcher (dropping it stops the poll thread) and
/// the self-write log the commands file their claims with.
pub struct WatcherState {
    /// `PollWatcher` stops polling when dropped, which is how a workspace
    /// switch tears the old one down.
    active: Mutex<Option<PollWatcher>>,
    pub self_writes: Arc<SelfWriteLog>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            self_writes: Arc::new(SelfWriteLog::new()),
        }
    }
}

impl WatcherState {
    /// Watch `root`, replacing any workspace watched before it.
    ///
    /// Failing to start is not fatal — the app is fully usable without live
    /// updates, and refusing to open a workspace over it would be a much worse
    /// trade — so this logs and moves on.
    pub fn start(&self, root: PathBuf, app: AppHandle) {
        self.stop();
        self.self_writes.clear();

        let self_writes = self.self_writes.clone();
        let watch_root = root.clone();
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let config = Config::default().with_poll_interval(POLL_INTERVAL);

        let watcher = match PollWatcher::new(tx, config) {
            Ok(mut watcher) => match watcher.watch(&root, RecursiveMode::Recursive) {
                Ok(()) => watcher,
                Err(e) => {
                    warn!("watcher: cannot watch {root:?} err=\"{e}\" — live updates are off");
                    return;
                }
            },
            Err(e) => {
                warn!("watcher: cannot start err=\"{e}\" — live updates are off");
                return;
            }
        };

        thread::spawn(move || dispatch_loop(watch_root, rx, app, self_writes));
        *self.active.lock() = Some(watcher);
        info!("watcher: polling {root:?} every {POLL_INTERVAL:?}");
    }

    /// Stop watching. The dispatch thread ends on its own when the channel
    /// closes with the watcher.
    pub fn stop(&self) {
        *self.active.lock() = None;
    }
}

fn dispatch_loop(
    root: PathBuf,
    rx: mpsc::Receiver<notify::Result<Event>>,
    app: AppHandle,
    self_writes: Arc<SelfWriteLog>,
) {
    // One poll produces its whole diff at once. Draining what has already
    // arrived before doing anything keeps a `git checkout`-sized change to a
    // single event instead of one per file.
    let drain = Duration::from_millis(50);

    loop {
        let first = match rx.recv() {
            Ok(event) => event,
            Err(_) => break,
        };

        let mut batch = vec![first];
        loop {
            match rx.recv_timeout(drain) {
                Ok(event) => batch.push(event),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }

        let changes = collect(&root, batch.into_iter().flatten(), |path| {
            self_writes.claims(path)
        });
        if changes.is_empty() {
            continue;
        }

        // Before the frontend hears about it: the compiler's main file and the
        // persisted metadata are keyed by path, and neither survives a delete
        // done by another program on its own.
        reconcile_removals(&app, &root, &changes);

        info!("watcher: {} external change(s)", changes.len());
        let _ = app.emit("workspace:files-changed", FilesChangedPayload { changes });
    }
}

/// Follow the workspace metadata through paths that disappeared outside the
/// app.
///
/// The in-app delete already does this (`finish_entry_change`); nothing did so
/// for a file removed by another program, which left the compiler holding a
/// `FileId` for a path that no longer exists — every later compile failing
/// "file not found", and the last render still being served for a document the
/// user deleted. The metadata would keep naming it too, so the next launch
/// would restore a tab that cannot open.
///
/// Deliberately backend-side rather than routed through the frontend: the world
/// has to stay consistent whether or not a window is listening.
fn reconcile_removals(app: &AppHandle, root: &Path, changes: &[FileChange]) {
    let removed: Vec<&str> = changes
        .iter()
        .filter(|change| change.kind == ChangeKind::Removed)
        .map(|change| change.rel_path.as_str())
        .collect();
    if removed.is_empty() {
        return;
    }

    // Rewriting the metadata means reading and writing a file, so check first
    // whether any of it actually points into what was removed. A batch of
    // deletes that touches nothing we track is the common case.
    let meta = read_meta(root);
    let tracked = meta
        .main_file
        .iter()
        .chain(meta.last_file.iter())
        .chain(meta.active_tab.iter())
        .chain(meta.open_tabs.iter());
    let mut affected: Vec<&str> = Vec::new();
    for rel in removed {
        if tracked
            .clone()
            .any(|stored| remap_rel(stored, rel, None) != PathRemap::Unaffected)
        {
            affected.push(rel);
        }
    }
    if affected.is_empty() {
        return;
    }

    let (Some(world), Some(compile)) = (
        app.try_state::<Arc<MobileWorld>>(),
        app.try_state::<Arc<CompileState>>(),
    ) else {
        return;
    };

    for rel in affected {
        let Ok(MetaRemap { meta, main_changed }) = remap_meta(root, rel, None) else {
            continue;
        };
        if !main_changed {
            continue;
        }
        match &meta.main_file {
            Some(main) => match world.rel_to_id(main) {
                Ok(id) => world.set_main(id),
                Err(_) => world.clear_main(),
            },
            None => world.clear_main(),
        }
        // The cached document describes the file that just went away; left in
        // place, the renderer and the PDF export would keep serving it.
        *compile.document.lock() = None;
        compile.page_lookup.lock().clear();
        info!("watcher: main file removed externally ({rel:?}) — compiler reset");
    }
}

/// Turn one drained batch of poll events into the changes the frontend acts on:
/// one entry per path, workspace-relative, with the kind settled against the
/// filesystem as it stands now rather than against what the event claimed.
fn collect(
    root: &Path,
    events: impl Iterator<Item = Event>,
    is_self_write: impl Fn(&Path) -> bool,
) -> Vec<FileChange> {
    // Sorted so the emitted order doesn't depend on hash iteration; a parent
    // directory also sorts before its children, which is the order the frontend
    // would rather apply removals in.
    let mut seen: std::collections::BTreeMap<PathBuf, bool> = std::collections::BTreeMap::new();

    for event in events {
        if !is_relevant(&event) {
            continue;
        }
        let created = matches!(event.kind, EventKind::Create(_));
        for path in event.paths {
            if is_ignored(root, &path) || is_self_write(&path) {
                continue;
            }
            let entry = seen.entry(path).or_insert(false);
            *entry |= created;
        }
    }

    seen.into_iter()
        .filter_map(|(path, created)| {
            let rel_path = to_rel(root, &path)?;
            Some(match std::fs::metadata(&path) {
                Ok(meta) => FileChange {
                    rel_path,
                    kind: if created {
                        ChangeKind::Created
                    } else {
                        ChangeKind::Modified
                    },
                    is_dir: meta.is_dir(),
                },
                Err(_) => FileChange {
                    rel_path,
                    kind: ChangeKind::Removed,
                    is_dir: false,
                },
            })
        })
        .collect()
}

fn is_relevant(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Any)
    )
}

fn is_ignored(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        // Not under the root we watch. Nothing sensible to say about it.
        return true;
    };
    rel.components().any(|component| match component {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            IGNORED_DIRS.iter().any(|ignored| name == *ignored)
        }
        _ => false,
    })
}

/// Workspace-relative, forward slashes. `None` for the root itself (there is
/// no change to report about the workspace as a whole) or anything outside it.
fn to_rel(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let rel: Vec<String> = rel
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    if rel.is_empty() {
        return None;
    }
    Some(rel.join("/"))
}

#[cfg(test)]
mod tests {
    use super::{collect, is_ignored, to_rel, ChangeKind, SelfWriteLog};
    use notify::event::{CreateKind, DataChange, EventAttributes, EventKind, ModifyKind};
    use notify::Event;
    use std::path::{Path, PathBuf};

    fn event(kind: EventKind, paths: &[&Path]) -> Event {
        Event {
            kind,
            paths: paths.iter().map(PathBuf::from).collect(),
            attrs: EventAttributes::new(),
        }
    }

    /// A real directory to stat against — `collect` settles every kind by
    /// asking the filesystem, so the paths have to exist (or not) for real.
    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("typwriter-watcher-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn a_write_collapses_into_one_modification() {
        let root = temp_root("write");
        let file = root.join("main.typ");
        std::fs::write(&file, "= x\n").expect("write");

        let events = vec![
            event(EventKind::Modify(ModifyKind::Any), &[&file]),
            event(
                EventKind::Modify(ModifyKind::Data(DataChange::Any)),
                &[&file],
            ),
        ];
        let changes = collect(&root, events.into_iter(), |_| false);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Modified);
        assert_eq!(changes[0].rel_path, "main.typ");
        assert!(!changes[0].is_dir);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_path_that_is_gone_is_a_removal_whatever_the_event_said() {
        let root = temp_root("removed");
        let file = root.join("gone.typ");

        // Deliberately a Create: the poll saw it appear, and it was gone again
        // by the time we looked. Disk is the tie-breaker, not the event.
        let events = vec![event(EventKind::Create(CreateKind::Any), &[&file])];
        let changes = collect(&root, events.into_iter(), |_| false);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Removed);
        assert_eq!(changes[0].rel_path, "gone.typ");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nested_paths_are_reported_relative_with_forward_slashes() {
        let root = temp_root("nested");
        std::fs::create_dir_all(root.join("chapters")).expect("mkdir");
        let file = root.join("chapters").join("one.typ");
        std::fs::write(&file, "= one\n").expect("write");

        let events = vec![event(EventKind::Create(CreateKind::File), &[&file])];
        let changes = collect(&root, events.into_iter(), |_| false);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Created);
        assert_eq!(changes[0].rel_path, "chapters/one.typ");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_directory_is_reported_as_one() {
        let root = temp_root("dir");
        let dir = root.join("assets");
        std::fs::create_dir_all(&dir).expect("mkdir");

        let events = vec![event(EventKind::Create(CreateKind::Folder), &[&dir])];
        let changes = collect(&root, events.into_iter(), |_| false);

        assert_eq!(changes.len(), 1);
        assert!(changes[0].is_dir);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn self_writes_are_dropped_but_neighbours_are_not() {
        // The whole point: an external tool touching a *different* file in the
        // same poll must still reach the frontend.
        let root = temp_root("self");
        let mine = root.join("mine.typ");
        let theirs = root.join("theirs.typ");
        std::fs::write(&mine, "a").expect("write");
        std::fs::write(&theirs, "b").expect("write");

        let events = vec![
            event(EventKind::Modify(ModifyKind::Any), &[&mine]),
            event(EventKind::Modify(ModifyKind::Any), &[&theirs]),
        ];
        let changes = collect(&root, events.into_iter(), |path| path == mine);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].rel_path, "theirs.typ");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_metadata_directory_is_ignored() {
        let root = Path::new("/w");
        assert!(is_ignored(root, &root.join(".typwriter").join("mobile.json")));
        assert!(!is_ignored(root, &root.join("main.typ")));
        // A file merely *named* like the metadata dir is not inside it.
        assert!(!is_ignored(root, &root.join(".typwriter-notes.typ")));
    }

    #[test]
    fn the_root_itself_has_no_relative_path() {
        let root = Path::new("/w");
        assert_eq!(to_rel(root, root), None);
        assert_eq!(to_rel(root, &root.join("a")).as_deref(), Some("a"));
        assert_eq!(to_rel(Path::new("/other"), &root.join("a")), None);
    }

    // ─── SelfWriteLog ────────────────────────────────────────────────────────

    #[test]
    fn a_file_still_as_we_left_it_is_claimed() {
        let root = temp_root("claim");
        let file = root.join("main.typ");
        std::fs::write(&file, "= x\n").expect("write");

        let log = SelfWriteLog::new();
        assert!(!log.claims(&file), "nothing recorded yet");
        log.note_write(&file);
        assert!(log.claims(&file));
        // One write fans out into several events; every one of them must be
        // suppressed, not just the first.
        assert!(log.claims(&file));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_someone_else_rewrote_is_not_claimed_again() {
        // The failure mode that would matter most: a record that keeps matching
        // would make the app permanently blind to changes to that file.
        let root = temp_root("stale");
        let file = root.join("main.typ");
        std::fs::write(&file, "= x\n").expect("write");

        let log = SelfWriteLog::new();
        log.note_write(&file);
        std::fs::write(&file, "= a much longer document\n").expect("rewrite");

        assert!(!log.claims(&file));
        // And the record is gone, so a second poll for the same file also gets
        // through rather than resurrecting the claim.
        assert!(!log.claims(&file));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_deletion_we_made_is_claimed_until_the_path_comes_back() {
        let root = temp_root("delete");
        let file = root.join("main.typ");
        std::fs::write(&file, "= x\n").expect("write");

        let log = SelfWriteLog::new();
        std::fs::remove_file(&file).expect("remove");
        log.note_removal(&file);
        assert!(log.claims(&file));

        // Something else puts the file back: that is an external change.
        std::fs::write(&file, "= back\n").expect("recreate");
        assert!(!log.claims(&file));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unrelated_path_is_never_claimed() {
        let log = SelfWriteLog::new();
        log.note_removal(Path::new("/w/main.typ"));
        assert!(!log.claims(Path::new("/w/other.typ")));
    }

    #[test]
    fn clearing_forgets_everything() {
        // A workspace switch must not leave claims behind: the paths belong to
        // a root we no longer watch, and a same-named file in the new one would
        // inherit them.
        let log = SelfWriteLog::new();
        log.note_removal(Path::new("/w/main.typ"));
        assert!(log.claims(Path::new("/w/main.typ")));
        log.clear();
        assert!(!log.claims(Path::new("/w/main.typ")));
    }
}
