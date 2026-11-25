// Keeps a folder workspace's private mirror and the user's folder in step.
//
// Folder workspaces are opt-in (the frontend explains the trade-offs before a
// user turns them on). Everything below only runs for one that is open.
//
// ## Why a mirror
//
// The compiler, the file tree, rename/move bookkeeping and the exports all
// work on plain `std::fs` paths, and on Android a folder the user picks is only
// reachable through SAF — one provider round trip per operation. Going through
// SAF for every compile would make typing-to-preview noticeably slower. So the
// app works on a copy in its own storage (the *mirror*) and this module keeps
// the two in step:
//
// - **Outbound, immediately.** Every change the app makes (save, create,
//   rename, move, delete) goes to the folder *first* and only then to the
//   mirror, inside one [`FolderSync::run`] call. A failed write never leaves
//   the mirror claiming something the folder doesn't have, and a sync client
//   (Syncthing, …) sees the change the moment it happens.
// - **Inbound, by polling — as cheaply as it can be.** The file open in the
//   editor is checked every [`HOT_INTERVAL`] (one stat), the whole folder is
//   listed every [`FULL_INTERVAL`] (one query per directory), and nothing runs
//   while the app is in the background ([`FolderSync::set_paused`]); coming
//   back triggers an immediate full pull. Inbound changes are reported to the
//   frontend directly (`watcher::report_external`) — the mirror has no poll
//   watcher of its own, which saves a second tree walk and its latency.
//
// The folder is the source of truth: the mirror is an exact copy of its
// non-hidden entries, and anything in the mirror that the folder no longer has
// is removed. Dot-prefixed entries are never copied either way (`.git`,
// `.stfolder`, `.stversions`), and the mirror's own `.typwriter/` — tab state,
// the main file, the sync snapshot — never leaves the device.
//
// ## Being visible
//
// The user must always know whether their work is syncing. Every state change
// (syncing with progress, synced, paused, can't reach the folder, stopped) is
// emitted as `workspace:sync-status`, and `get_sync_status` answers for a
// freshly mounted UI. Progress during a copy is throttled to a few updates a
// second.
//
// ## Conflicts
//
// The snapshot records each file's stamp as of the last sync. A save first
// checks the folder's stamp against it: if someone else changed the file since,
// the save is refused with the same "File changed on disk" error a standalone
// document uses, their version is pulled into the mirror (and reported), and
// the editor offers Keep mine / Reload. Nothing the other device wrote is
// overwritten silently.

use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use log::{info, warn};
use parking_lot::{Condvar, Mutex};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::remote::{join_rel, Remote, RemoteEntry, RemoteStamp};
use crate::{
    watcher::{ChangeKind, FileChange},
    workspace::{remap_rel, resolve_in_root, PathRemap},
};

/// How often the file open in the editor is checked — the one a user is
/// actually waiting on when they edit it on another device. One stat.
pub const HOT_INTERVAL: Duration = Duration::from_secs(1);

/// How often the whole folder is listed: one SAF query per directory.
pub const FULL_INTERVAL: Duration = Duration::from_secs(4);

/// Progress updates during a copy, at most this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(200);

/// The error a save returns when the folder's copy changed underneath it. The
/// frontend keys its Keep mine / Reload prompt on this exact prefix.
pub const CONFLICT: &str = "File changed on disk. Choose Keep mine or Reload before saving.";

const META_DIR: &str = ".typwriter";
const SNAPSHOT_FILE: &str = "sync.json";
const TMP_FILE: &str = "sync.tmp";

/// Folder-side stamps as of the last sync, keyed by relative file path.
pub type Snapshot = BTreeMap<String, RemoteStamp>;

/// Whether a mirror has completed a sync before — i.e. holds a copy worth
/// opening while the next sync runs in the background.
pub fn has_synced(mirror: &Path) -> bool {
    mirror.join(META_DIR).join(SNAPSHOT_FILE).is_file()
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyncState {
    /// Copying changes in (with progress), or about to check.
    Syncing,
    /// The mirror matches the folder as of `last_synced_ms`.
    Synced,
    /// The app is in the background; nothing is polled.
    Paused,
    /// The folder can't be reached. Saves fail until it is back.
    Offline,
    /// The workspace was closed; this folder is no longer synced.
    Stopped,
}

/// What the sync indicator shows. Emitted as `workspace:sync-status`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub workspace_id: String,
    pub name: String,
    /// Readable folder location, e.g. `Sync/Thesis`.
    pub location: String,
    pub state: SyncState,
    pub message: Option<String>,
    /// Files copied so far / to copy, while `Syncing` a batch.
    pub done: Option<usize>,
    pub total: Option<usize>,
    pub last_synced_ms: Option<i64>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct FolderSync {
    remote: Box<dyn Remote>,
    mirror: PathBuf,
    /// Held for the whole of every pull and every outbound change, so the two
    /// can never interleave between the folder step and the mirror step.
    snapshot: Mutex<Snapshot>,
    stopped: AtomicBool,
    paused: AtomicBool,
    /// The file open in the editor, checked every [`HOT_INTERVAL`].
    hot: Mutex<Option<String>>,
    /// Set (and the condvar notified) to make the poller run a full pull now.
    wake: Mutex<bool>,
    wake_cv: Condvar,
    /// `None` in tests and one-off syncs: no events, no status emission.
    app: Option<AppHandle>,
    status: Mutex<SyncStatus>,
    last_progress: Mutex<Instant>,
}

impl FolderSync {
    pub fn new(remote: Box<dyn Remote>, mirror: PathBuf) -> Self {
        let snapshot = std::fs::read_to_string(mirror.join(META_DIR).join(SNAPSHOT_FILE))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            remote,
            mirror,
            snapshot: Mutex::new(snapshot),
            stopped: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            hot: Mutex::new(None),
            wake: Mutex::new(false),
            wake_cv: Condvar::new(),
            app: None,
            status: Mutex::new(SyncStatus {
                workspace_id: String::new(),
                name: String::new(),
                location: String::new(),
                state: SyncState::Syncing,
                message: None,
                done: None,
                total: None,
                last_synced_ms: None,
            }),
            last_progress: Mutex::new(Instant::now()),
        }
    }

    /// Report status and inbound changes for the open workspace `id`.
    pub fn with_events(
        mut self,
        app: AppHandle,
        id: String,
        name: String,
        location: String,
    ) -> Self {
        self.app = Some(app);
        let status = self.status.get_mut();
        status.workspace_id = id;
        status.name = name;
        status.location = location;
        self
    }

    pub fn mirror(&self) -> &Path {
        &self.mirror
    }

    pub fn status(&self) -> SyncStatus {
        self.status.lock().clone()
    }

    /// Announce that syncing has started for this workspace.
    pub fn announce(&self) {
        let status = self.status.lock().clone();
        self.emit(status);
    }

    fn emit(&self, status: SyncStatus) {
        if let Some(app) = &self.app {
            let _ = app.emit("workspace:sync-status", status);
        }
    }

    /// Move to `state`, emitting when it is news: a different state or message,
    /// or (throttled) copy progress.
    fn set_state(
        &self,
        state: SyncState,
        message: Option<String>,
        progress: Option<(usize, usize)>,
    ) {
        let mut status = self.status.lock();
        if status.state == SyncState::Stopped {
            return;
        }
        let changed = status.state != state || status.message != message;
        status.state = state;
        status.message = message;
        status.done = progress.map(|(done, _)| done);
        status.total = progress.map(|(_, total)| total);
        if state == SyncState::Synced {
            status.last_synced_ms = Some(now_ms());
        }
        let progress_due = progress.is_some_and(|(done, total)| {
            let mut last = self.last_progress.lock();
            let due = done == 0 || done == total || last.elapsed() >= PROGRESS_EVERY;
            if due {
                *last = Instant::now();
            }
            due
        });
        if changed || progress_due {
            let snapshot = status.clone();
            drop(status);
            self.emit(snapshot);
        }
    }

    fn report(&self, changes: Vec<FileChange>) {
        if let Some(app) = &self.app {
            crate::watcher::report_external(app, &self.mirror, changes);
        }
    }

    /// Run one outbound change under the sync lock. `f` gets the folder-side
    /// operations and does its own mirror work after them, so a pull can never
    /// land between the two halves.
    pub fn run<T>(
        &self,
        f: impl FnOnce(&mut SyncOps<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut inbound = Vec::new();
        let result = {
            let mut snapshot = self.snapshot.lock();
            let mut ops = SyncOps {
                remote: &*self.remote,
                mirror: &self.mirror,
                snapshot: &mut snapshot,
                inbound: &mut inbound,
            };
            let result = f(&mut ops);
            persist(&self.mirror, &snapshot);
            result
        };
        self.report(inbound);
        result
    }

    /// Bring the mirror up to date with the whole folder. Returns what changed
    /// in the mirror (already reported to the frontend).
    pub fn pull(&self) -> Result<Vec<FileChange>, String> {
        let mut snapshot = self.snapshot.lock();
        if self.stopped.load(Ordering::SeqCst) {
            return Ok(Vec::new());
        }
        let result = self.remote.list("", false).and_then(|entries| {
            apply_listing(
                &*self.remote,
                &self.mirror,
                &mut snapshot,
                &entries,
                &|done, total| self.set_state(SyncState::Syncing, None, Some((done, total))),
            )
        });
        let changes = match result {
            Ok(changes) => changes,
            Err(e) => {
                drop(snapshot);
                self.set_state(SyncState::Offline, Some(e.clone()), None);
                return Err(e);
            }
        };
        // Also on a first, empty sync: `has_synced` keys on the snapshot file.
        if !changes.is_empty() || !has_synced(&self.mirror) {
            persist(&self.mirror, &snapshot);
        }
        drop(snapshot);
        self.set_state(SyncState::Synced, None, None);
        self.report(changes.clone());
        Ok(changes)
    }

    /// The cheap check: has the one file open in the editor changed? Only
    /// modifications are handled here — a missing file is left to the next
    /// full pull, which can tell a deletion from a rename.
    pub fn pull_file(&self, rel: &str) -> Result<Vec<FileChange>, String> {
        let mut snapshot = self.snapshot.lock();
        if self.stopped.load(Ordering::SeqCst) {
            return Ok(Vec::new());
        }
        let stamp = match self.remote.stat(rel) {
            Ok(Some(stamp)) => stamp,
            Ok(None) => return Ok(Vec::new()),
            Err(e) => {
                drop(snapshot);
                self.set_state(SyncState::Offline, Some(e.clone()), None);
                return Err(e);
            }
        };
        let mut changes = Vec::new();
        if snapshot.get(rel) != Some(&stamp) {
            self.set_state(SyncState::Syncing, None, Some((0, 1)));
            let bytes = match self.remote.read(rel) {
                Ok(bytes) => bytes,
                Err(e) => {
                    drop(snapshot);
                    self.set_state(SyncState::Offline, Some(e.clone()), None);
                    return Err(e);
                }
            };
            if let Some(change) = copy_in(&self.mirror, rel, &bytes)? {
                changes.push(change);
            }
            snapshot.insert(rel.to_string(), stamp);
            persist(&self.mirror, &snapshot);
        }
        drop(snapshot);
        self.set_state(SyncState::Synced, None, None);
        self.report(changes.clone());
        Ok(changes)
    }

    /// Record a listing as already in sync without copying anything — for a
    /// mirror that was just filled from the same files the folder received.
    pub fn adopt(&self, entries: &[RemoteEntry]) {
        let mut snapshot = self.snapshot.lock();
        snapshot.clear();
        for entry in entries {
            if let Some(stamp) = entry.stamp {
                snapshot.insert(entry.rel.clone(), stamp);
            }
        }
        persist(&self.mirror, &snapshot);
    }

    /// Which file the editor shows, for the fast check. `None` turns it off.
    pub fn set_hot(&self, rel: Option<String>) {
        *self.hot.lock() = rel;
    }

    /// Stop polling while the app is in the background, and catch up the
    /// moment it comes back.
    pub fn set_paused(&self, paused: bool) {
        if self.paused.swap(paused, Ordering::SeqCst) == paused {
            return;
        }
        if paused {
            self.set_state(SyncState::Paused, None, None);
        } else {
            self.set_state(SyncState::Syncing, None, None);
            self.wake_now();
        }
    }

    fn wake_now(&self) {
        *self.wake.lock() = true;
        self.wake_cv.notify_all();
    }

    /// Poll the folder until [`FolderSync::stop`]. `immediately` runs the
    /// first full pull right away (a workspace opened from its last copy).
    pub fn start_polling(self: &Arc<Self>, immediately: bool) {
        if immediately {
            *self.wake.lock() = true;
        }
        let this = self.clone();
        thread::spawn(move || {
            let mut last_full = Instant::now();
            loop {
                let forced = {
                    let mut wake = this.wake.lock();
                    if !*wake {
                        this.wake_cv.wait_for(&mut wake, HOT_INTERVAL);
                    }
                    std::mem::take(&mut *wake)
                };
                if this.stopped.load(Ordering::SeqCst) {
                    break;
                }
                if this.paused.load(Ordering::SeqCst) {
                    continue;
                }
                let offline = this.status.lock().state == SyncState::Offline;
                let full_due = forced || last_full.elapsed() >= FULL_INTERVAL;
                let t = Instant::now();
                let result = if full_due {
                    last_full = Instant::now();
                    this.pull()
                } else if offline {
                    // Retry on the slow cadence only; the fast check would just
                    // fail every second.
                    continue;
                } else if let Some(hot) = this.hot.lock().clone() {
                    this.pull_file(&hot)
                } else {
                    continue;
                };
                match result {
                    Ok(changes) if !changes.is_empty() => info!(
                        "folder sync: pulled {} change(s) ({:.1}ms)",
                        changes.len(),
                        t.elapsed().as_secs_f64() * 1000.0
                    ),
                    Ok(_) => {}
                    Err(e) => warn!("folder sync: {e}"),
                }
            }
        });
    }

    /// End syncing for good (the workspace was closed), and say so.
    pub fn stop(&self) {
        if self.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        self.wake_now();
        let status = {
            let mut status = self.status.lock();
            status.state = SyncState::Stopped;
            status.message = None;
            status.done = None;
            status.total = None;
            status.clone()
        };
        self.emit(status);
    }
}

/// The folder-side half of an outbound change. Each method updates the
/// snapshot to match what it did.
pub struct SyncOps<'a> {
    remote: &'a dyn Remote,
    mirror: &'a Path,
    snapshot: &'a mut Snapshot,
    /// Changes copied *into* the mirror along the way (a conflict brings the
    /// other device's version in), reported once the lock is released.
    inbound: &'a mut Vec<FileChange>,
}

impl SyncOps<'_> {
    /// Write a file's new contents to the folder, refusing with [`CONFLICT`]
    /// when the folder's copy changed since the last sync (unless `overwrite`,
    /// the user's explicit Keep mine).
    pub fn save(&mut self, rel: &str, bytes: &[u8], overwrite: bool) -> Result<(), String> {
        if !overwrite {
            let synced = self.snapshot.get(rel).copied();
            let now = self.remote.stat(rel)?;
            if now != synced && !self.unchanged_content(rel, now) {
                // Theirs goes into the mirror now rather than at the next poll,
                // so Reload has something to load.
                match now {
                    Some(stamp) => {
                        let theirs = self.remote.read(rel)?;
                        if let Some(change) = copy_in(self.mirror, rel, &theirs)? {
                            self.inbound.push(change);
                        }
                        self.snapshot.insert(rel.to_string(), stamp);
                    }
                    None => {
                        remove_local(self.mirror, rel);
                        self.snapshot.remove(rel);
                        self.inbound.push(FileChange {
                            rel_path: rel.to_string(),
                            kind: ChangeKind::Removed,
                            is_dir: false,
                        });
                    }
                }
                return Err(CONFLICT.into());
            }
        }
        self.remote.write(rel, bytes)?;
        self.record(rel);
        Ok(())
    }

    /// A stamp can move without the content changing — a provider touching
    /// the file, or a move done as copy + delete. Not a conflict: adopt the new
    /// stamp and carry on.
    fn unchanged_content(&mut self, rel: &str, now: Option<RemoteStamp>) -> bool {
        let Some(stamp) = now else {
            return false;
        };
        let Ok(local) = std::fs::read(self.mirror.join(rel)) else {
            return false;
        };
        if local.len() as u64 != stamp.len {
            return false;
        }
        match self.remote.read(rel) {
            Ok(theirs) if theirs == local => {
                self.snapshot.insert(rel.to_string(), stamp);
                true
            }
            _ => false,
        }
    }

    pub fn create_file(&mut self, rel: &str) -> Result<(), String> {
        if self.remote.exists(rel) {
            return Err(format!("Already exists: {rel}"));
        }
        self.remote.write(rel, b"")?;
        self.record(rel);
        Ok(())
    }

    pub fn create_dir(&mut self, rel: &str) -> Result<(), String> {
        if self.remote.exists(rel) {
            return Err(format!("Already exists: {rel}"));
        }
        self.remote.create_dir(rel)
    }

    pub fn rename(&mut self, from: &str, new_name: &str, to: &str) -> Result<(), String> {
        self.remote.rename(from, new_name)?;
        remap_keys(self.snapshot, from, Some(to));
        Ok(())
    }

    pub fn move_into(&mut self, from: &str, new_parent: &str, to: &str) -> Result<(), String> {
        self.remote.move_into(from, new_parent)?;
        remap_keys(self.snapshot, from, Some(to));
        Ok(())
    }

    pub fn remove(&mut self, rel: &str) -> Result<(), String> {
        self.remote.remove(rel)?;
        remap_keys(self.snapshot, rel, None);
        Ok(())
    }

    fn record(&mut self, rel: &str) {
        // Can't ask? Forget the stamp: the next pull byte-compares the file and
        // adopts it without reporting anything.
        match self.remote.stat(rel) {
            Ok(Some(stamp)) => {
                self.snapshot.insert(rel.to_string(), stamp);
            }
            _ => {
                self.snapshot.remove(rel);
            }
        }
    }
}

/// Move every snapshot key at or under `from` to `to`, or drop it.
fn remap_keys(snapshot: &mut Snapshot, from: &str, to: Option<&str>) {
    let affected: Vec<String> = snapshot
        .keys()
        .filter(|key| remap_rel(key, from, to) != PathRemap::Unaffected)
        .cloned()
        .collect();
    for key in affected {
        let Some(stamp) = snapshot.remove(&key) else {
            continue;
        };
        if let PathRemap::Moved(next) = remap_rel(&key, from, to) {
            snapshot.insert(next, stamp);
        }
    }
}

/// Write the folder's bytes into the mirror unless they are already there.
/// A stamp that moved over identical bytes (our own write coming back, or a
/// provider touching the file) must not be reported: a dirty buffer would be
/// flagged for a change that never happened.
fn copy_in(mirror: &Path, rel: &str, bytes: &[u8]) -> Result<Option<FileChange>, String> {
    let local = resolve_in_root(mirror, rel)?;
    if std::fs::read(&local).ok().as_deref() == Some(bytes) {
        return Ok(None);
    }
    let existed = local.is_file();
    write_local(mirror, rel, bytes)?;
    Ok(Some(FileChange {
        rel_path: rel.to_string(),
        kind: if existed {
            ChangeKind::Modified
        } else {
            ChangeKind::Created
        },
        is_dir: false,
    }))
}

/// Make the mirror match a listing of the folder. Returns what changed in the
/// mirror; `progress(done, total)` hears about each file that has to be copied.
fn apply_listing(
    remote: &dyn Remote,
    mirror: &Path,
    snapshot: &mut Snapshot,
    entries: &[RemoteEntry],
    progress: &dyn Fn(usize, usize),
) -> Result<Vec<FileChange>, String> {
    let mut changes = Vec::new();
    let present: HashSet<&str> = entries.iter().map(|e| e.rel.as_str()).collect();

    // Directories first (the listing has parents before children), so every
    // copied file has somewhere to land.
    for entry in entries.iter().filter(|e| e.is_dir()) {
        let local = resolve_in_root(mirror, &entry.rel)?;
        if local.is_file() {
            let _ = std::fs::remove_file(&local);
        }
        if !local.is_dir() {
            std::fs::create_dir_all(&local).map_err(|e| e.to_string())?;
            changes.push(FileChange {
                rel_path: entry.rel.clone(),
                kind: ChangeKind::Created,
                is_dir: true,
            });
        }
    }

    // Only files whose stamp moved (or that the mirror lacks) cost a read.
    let mut todo = Vec::new();
    for entry in entries {
        let Some(stamp) = entry.stamp else {
            continue;
        };
        let local = resolve_in_root(mirror, &entry.rel)?;
        if snapshot.get(&entry.rel) != Some(&stamp) || !local.is_file() {
            todo.push((entry, stamp));
        }
    }
    let total = todo.len();
    if total > 0 {
        progress(0, total);
    }
    for (done, (entry, stamp)) in todo.into_iter().enumerate() {
        match remote.read(&entry.rel) {
            Ok(bytes) => {
                if let Some(change) = copy_in(mirror, &entry.rel, &bytes)? {
                    changes.push(change);
                }
                snapshot.insert(entry.rel.clone(), stamp);
            }
            // Mid-sync by the other device, or briefly locked. Keep what we
            // have (and its old stamp, so the next poll tries again).
            Err(e) => warn!("folder sync: cannot read {:?}: {e}", entry.rel),
        }
        progress(done + 1, total);
    }

    // Whatever the folder no longer has goes from the mirror too.
    for (rel, is_dir) in local_entries(mirror) {
        if present.contains(rel.as_str()) {
            continue;
        }
        let Ok(path) = resolve_in_root(mirror, &rel) else {
            continue;
        };
        // A directory removed earlier in this loop took its children with it.
        if !path.exists() {
            continue;
        }
        let result = if is_dir {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match result {
            Ok(()) => changes.push(FileChange {
                rel_path: rel,
                kind: ChangeKind::Removed,
                is_dir: false,
            }),
            Err(e) => warn!("folder sync: cannot remove {rel:?} from the mirror: {e}"),
        }
    }
    snapshot.retain(|rel, _| present.contains(rel.as_str()));
    Ok(changes)
}

/// Every non-hidden entry in the mirror, parents before children.
fn local_entries(mirror: &Path) -> Vec<(String, bool)> {
    let mut out = Vec::new();
    let mut stack = vec![(mirror.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let child = join_rel(&rel, &name);
            let path = entry.path();
            let is_dir = path.is_dir();
            out.push((child.clone(), is_dir));
            if is_dir {
                stack.push((path, child));
            }
        }
    }
    out
}

/// Write into the mirror atomically. The temp file lives in `.typwriter/`,
/// which nothing lists, so nobody can catch it half-written.
fn write_local(mirror: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let target = resolve_in_root(mirror, rel)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    let meta = mirror.join(META_DIR);
    std::fs::create_dir_all(&meta).map_err(|e| e.to_string())?;
    let tmp = meta.join(TMP_FILE);
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

fn remove_local(mirror: &Path, rel: &str) {
    if let Ok(path) = resolve_in_root(mirror, rel) {
        let _ = if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
    }
}

fn persist(mirror: &Path, snapshot: &Snapshot) {
    let dir = mirror.join(META_DIR);
    let result = std::fs::create_dir_all(&dir).and_then(|()| {
        let json = serde_json::to_string(snapshot).map_err(std::io::Error::other)?;
        std::fs::write(dir.join(SNAPSHOT_FILE), json)
    });
    if let Err(e) = result {
        warn!("folder sync: cannot save the sync snapshot: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folders::remote::PathRemote;

    struct Dirs {
        base: PathBuf,
        folder: PathBuf,
        mirror: PathBuf,
    }

    impl Dirs {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "typwriter-sync-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let folder = base.join("folder");
            let mirror = base.join("mirror");
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::create_dir_all(&mirror).unwrap();
            Self {
                base,
                folder,
                mirror,
            }
        }

        fn sync(&self) -> FolderSync {
            FolderSync::new(
                Box::new(PathRemote::new(self.folder.clone())),
                self.mirror.clone(),
            )
        }

        /// Write into the folder as another program would, with an mtime that
        /// can't collide with an earlier write. Stamps keep milliseconds, and
        /// two writes on a fast machine can land in the same one — a
        /// same-length rewrite would then look unchanged — so every write is
        /// pushed one more second into the future than the last.
        fn external_write(&self, rel: &str, content: &str) {
            use std::sync::atomic::{AtomicU64, Ordering};
            static WRITES: AtomicU64 = AtomicU64::new(0);

            let path = self.folder.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, content).unwrap();
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            let n = WRITES.fetch_add(1, Ordering::Relaxed);
            let later = std::time::SystemTime::now() + Duration::from_secs(60 + n);
            file.set_modified(later).unwrap();
        }

        fn mirror_text(&self, rel: &str) -> Option<String> {
            std::fs::read_to_string(self.mirror.join(rel)).ok()
        }

        fn folder_text(&self, rel: &str) -> Option<String> {
            std::fs::read_to_string(self.folder.join(rel)).ok()
        }
    }

    impl Drop for Dirs {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    #[test]
    fn pull_copies_the_folder_and_skips_hidden_entries() {
        let dirs = Dirs::new("pull");
        dirs.external_write("main.typ", "= Hi");
        dirs.external_write("chapters/one.typ", "one");
        dirs.external_write(".stfolder/marker", "");
        dirs.external_write(".git/HEAD", "ref");
        let sync = dirs.sync();
        assert_eq!(sync.pull().unwrap().len(), 3); // main.typ, chapters/, chapters/one.typ
        assert_eq!(dirs.mirror_text("main.typ").as_deref(), Some("= Hi"));
        assert_eq!(dirs.mirror_text("chapters/one.typ").as_deref(), Some("one"));
        assert!(!dirs.mirror.join(".git").exists());
        assert!(!dirs.mirror.join(".stfolder").exists());
        // Nothing changed: nothing written.
        assert_eq!(sync.pull().unwrap().len(), 0);
    }

    #[test]
    fn pull_follows_external_edits_and_deletions() {
        let dirs = Dirs::new("follow");
        dirs.external_write("main.typ", "v1");
        dirs.external_write("old/gone.typ", "x");
        let sync = dirs.sync();
        sync.pull().unwrap();

        dirs.external_write("main.typ", "v2");
        std::fs::remove_dir_all(dirs.folder.join("old")).unwrap();
        sync.pull().unwrap();
        assert_eq!(dirs.mirror_text("main.typ").as_deref(), Some("v2"));
        assert!(!dirs.mirror.join("old").exists());
    }

    #[test]
    fn the_mirrors_own_metadata_survives_a_pull() {
        let dirs = Dirs::new("meta");
        std::fs::create_dir_all(dirs.mirror.join(".typwriter")).unwrap();
        std::fs::write(dirs.mirror.join(".typwriter/mobile.json"), "{}").unwrap();
        dirs.sync().pull().unwrap();
        assert!(dirs.mirror.join(".typwriter/mobile.json").exists());
        assert!(!dirs.folder.join(".typwriter").exists());
    }

    #[test]
    fn saves_write_through_and_do_not_come_back_as_changes() {
        let dirs = Dirs::new("save");
        dirs.external_write("main.typ", "v1");
        let sync = dirs.sync();
        sync.pull().unwrap();
        sync.run(|ops| ops.save("main.typ", b"mine", false))
            .unwrap();
        assert_eq!(dirs.folder_text("main.typ").as_deref(), Some("mine"));
        // The caller writes its own mirror copy; the next poll must not touch it.
        std::fs::write(dirs.mirror.join("main.typ"), "mine").unwrap();
        assert_eq!(sync.pull().unwrap().len(), 0);
    }

    #[test]
    fn a_save_over_someone_elses_change_is_refused_and_theirs_is_pulled() {
        let dirs = Dirs::new("conflict");
        dirs.external_write("main.typ", "v1");
        let sync = dirs.sync();
        sync.pull().unwrap();
        dirs.external_write("main.typ", "theirs");

        let err = sync
            .run(|ops| ops.save("main.typ", b"mine", false))
            .unwrap_err();
        assert_eq!(err, CONFLICT);
        assert_eq!(dirs.folder_text("main.typ").as_deref(), Some("theirs"));
        assert_eq!(dirs.mirror_text("main.typ").as_deref(), Some("theirs"));

        // Keep mine.
        sync.run(|ops| ops.save("main.typ", b"mine", true)).unwrap();
        assert_eq!(dirs.folder_text("main.typ").as_deref(), Some("mine"));
    }

    #[test]
    fn a_touched_but_identical_file_is_not_a_conflict() {
        let dirs = Dirs::new("touch");
        dirs.external_write("main.typ", "same");
        let sync = dirs.sync();
        sync.pull().unwrap();
        dirs.external_write("main.typ", "same"); // new mtime, same bytes
        sync.run(|ops| ops.save("main.typ", b"mine", false))
            .unwrap();
        assert_eq!(dirs.folder_text("main.typ").as_deref(), Some("mine"));
    }

    #[test]
    fn renames_moves_and_deletes_reach_the_folder() {
        let dirs = Dirs::new("ops");
        dirs.external_write("a.typ", "a");
        dirs.external_write("notes/n.typ", "n");
        let sync = dirs.sync();
        sync.pull().unwrap();

        sync.run(|ops| ops.rename("a.typ", "b.typ", "b.typ"))
            .unwrap();
        sync.run(|ops| ops.create_dir("archive")).unwrap();
        sync.run(|ops| ops.move_into("notes", "archive", "archive/notes"))
            .unwrap();
        sync.run(|ops| ops.create_file("new.typ")).unwrap();
        assert_eq!(dirs.folder_text("b.typ").as_deref(), Some("a"));
        assert_eq!(
            dirs.folder_text("archive/notes/n.typ").as_deref(),
            Some("n")
        );
        assert_eq!(dirs.folder_text("new.typ").as_deref(), Some(""));
        assert!(!dirs.folder.join("notes").exists());

        sync.run(|ops| ops.remove("archive")).unwrap();
        assert!(!dirs.folder.join("archive").exists());
        assert!(sync.run(|ops| ops.create_file("b.typ")).is_err());
    }

    #[test]
    fn the_snapshot_survives_a_restart() {
        let dirs = Dirs::new("persist");
        dirs.external_write("main.typ", "v1");
        dirs.sync().pull().unwrap();
        // A fresh engine over the same mirror has nothing to copy.
        assert_eq!(dirs.sync().pull().unwrap().len(), 0);
    }

    #[test]
    fn the_default_move_copies_hidden_entries_too() {
        // `PathRemote` overrides `move_into`; exercise the copy+delete default
        // that SAF relies on through a wrapper that doesn't.
        struct CopyMove(PathRemote);
        impl Remote for CopyMove {
            fn list(&self, under: &str, hidden: bool) -> Result<Vec<RemoteEntry>, String> {
                self.0.list(under, hidden)
            }
            fn stat(&self, rel: &str) -> Result<Option<RemoteStamp>, String> {
                self.0.stat(rel)
            }
            fn exists(&self, rel: &str) -> bool {
                self.0.exists(rel)
            }
            fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
                self.0.read(rel)
            }
            fn write(&self, rel: &str, bytes: &[u8]) -> Result<(), String> {
                self.0.write(rel, bytes)
            }
            fn create_dir(&self, rel: &str) -> Result<(), String> {
                self.0.create_dir(rel)
            }
            fn rename(&self, rel: &str, new_name: &str) -> Result<(), String> {
                self.0.rename(rel, new_name)
            }
            fn remove(&self, rel: &str) -> Result<(), String> {
                self.0.remove(rel)
            }
            fn child_spec(&self, rel: &str) -> Result<super::super::remote::RemoteSpec, String> {
                self.0.child_spec(rel)
            }
        }
        let dirs = Dirs::new("copymove");
        dirs.external_write("src/deep/a.typ", "a");
        dirs.external_write("src/.keep", "");
        dirs.external_write("one.typ", "1");
        std::fs::create_dir_all(dirs.folder.join("dest")).unwrap();
        let remote = CopyMove(PathRemote::new(dirs.folder.clone()));
        remote.move_into("src", "dest").unwrap();
        remote.move_into("one.typ", "dest").unwrap();
        assert_eq!(
            dirs.folder_text("dest/src/deep/a.typ").as_deref(),
            Some("a")
        );
        assert!(dirs.folder.join("dest/src/.keep").exists());
        assert_eq!(dirs.folder_text("dest/one.typ").as_deref(), Some("1"));
        assert!(!dirs.folder.join("src").exists());
        assert!(!dirs.folder.join("one.typ").exists());
    }

    #[test]
    fn pull_reports_what_it_changed() {
        let dirs = Dirs::new("kinds");
        dirs.external_write("a.typ", "1");
        let sync = dirs.sync();
        let first = sync.pull().unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].kind, ChangeKind::Created);

        dirs.external_write("a.typ", "2");
        let second = sync.pull().unwrap();
        assert_eq!(second[0].kind, ChangeKind::Modified);

        std::fs::remove_file(dirs.folder.join("a.typ")).unwrap();
        let third = sync.pull().unwrap();
        assert_eq!(third[0].kind, ChangeKind::Removed);
        assert_eq!(sync.status().state, SyncState::Synced);
    }

    #[test]
    fn the_fast_check_picks_up_the_open_file_only() {
        let dirs = Dirs::new("hot");
        dirs.external_write("main.typ", "v1");
        dirs.external_write("other.typ", "o1");
        let sync = dirs.sync();
        sync.pull().unwrap();
        dirs.external_write("main.typ", "v2");
        dirs.external_write("other.typ", "o2");

        let changes = sync.pull_file("main.typ").unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(dirs.mirror_text("main.typ").as_deref(), Some("v2"));
        assert_eq!(dirs.mirror_text("other.typ").as_deref(), Some("o1"));
        // Nothing new: nothing reported.
        assert!(sync.pull_file("main.typ").unwrap().is_empty());
        // A vanished file is the full pull's business, not the fast check's.
        std::fs::remove_file(dirs.folder.join("main.typ")).unwrap();
        assert!(sync.pull_file("main.typ").unwrap().is_empty());
        assert!(dirs.mirror.join("main.typ").exists());
    }

    #[test]
    fn an_unreachable_folder_is_offline_and_keeps_the_mirror() {
        let dirs = Dirs::new("offline");
        dirs.external_write("main.typ", "v1");
        let sync = dirs.sync();
        sync.pull().unwrap();
        std::fs::remove_dir_all(&dirs.folder).unwrap();
        assert!(sync.pull().is_err());
        assert_eq!(sync.status().state, SyncState::Offline);
        assert_eq!(dirs.mirror_text("main.typ").as_deref(), Some("v1"));
        // Saving fails loudly rather than pretending.
        assert!(sync.run(|ops| ops.save("main.typ", b"x", false)).is_err());
        assert_eq!(dirs.mirror_text("main.typ").as_deref(), Some("v1"));
    }

    #[test]
    fn pausing_and_stopping_are_reflected_in_the_status() {
        let dirs = Dirs::new("states");
        let sync = dirs.sync();
        sync.set_paused(true);
        assert_eq!(sync.status().state, SyncState::Paused);
        sync.set_paused(false);
        assert_eq!(sync.status().state, SyncState::Syncing);
        sync.stop();
        assert_eq!(sync.status().state, SyncState::Stopped);
        // Nothing moves a stopped sync out of Stopped.
        sync.set_paused(true);
        assert_eq!(sync.status().state, SyncState::Stopped);
        assert!(sync.pull().unwrap().is_empty());
    }

    #[test]
    fn a_mirror_is_only_reopened_from_after_a_completed_sync() {
        let dirs = Dirs::new("hassynced");
        assert!(!has_synced(&dirs.mirror));
        dirs.external_write("main.typ", "v1");
        dirs.sync().pull().unwrap();
        assert!(has_synced(&dirs.mirror));
    }
}
