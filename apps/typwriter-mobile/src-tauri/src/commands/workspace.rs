// Workspace lifecycle + file operations. Every mutation returns the refreshed
// file tree (root node) so the frontend never patches the tree client-side.
//
// All commands here are `async` so they run on the async runtime instead of
// the main thread — a sync command doing disk IO (or worse, a blocking dialog)
// on the main thread can stall the whole UI on Android. Long-blocking bodies
// (pickers, SAF reads) additionally hop to `spawn_blocking`.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use log::{info, warn};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    compiler::CompileState,
    folders::{
        self,
        registry::{self, FolderEntry, APP_PREFIX, FOLDER_PREFIX},
        remote::{open_remote, Remote, RemoteEntry, RemoteSpec},
        sync::{has_synced, FolderSync, SyncStatus},
    },
    watcher::WatcherState,
    workspace::{
        build_tree, detect_main_file, read_meta, remap_meta, resolve_in_root, update_meta,
        workspaces_root, EntryChange, FileNode, MetaRemap, WorkspaceInfo, WorkspaceMeta,
        WorkspaceState,
    },
    world::MobileWorld,
};

const STARTER_MAIN: &str = "= Hello, Typst!\n";

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) fn root_dir(app: &AppHandle) -> PathBuf {
    let documents = app.path().document_dir().ok();
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    workspaces_root(documents, app_data)
}

fn current_root(workspace: &WorkspaceState) -> Result<PathBuf, String> {
    if workspace.document.lock().is_some() {
        return Err("Open a workspace to manage files and folders".into());
    }
    workspace
        .root
        .read()
        .clone()
        .ok_or_else(|| "No workspace open".to_string())
}

fn tree_of(workspace: &WorkspaceState) -> Result<FileNode, String> {
    if let Some(document) = workspace.document.lock().as_ref() {
        return Ok(document.tree());
    }
    Ok(build_tree(&current_root(workspace)?))
}

/// Finish an entry rename / move / delete: rewrite every path the workspace
/// metadata stores, resync the compiler's main file with it, and hand back the
/// refreshed tree along with the change so the frontend can move its open tabs.
///
/// The world's main file is a `FileId` built from a path; leaving it pointing at
/// the old one makes every later compile fail with "file not found" even though
/// the document is sitting right there under its new name.
fn finish_entry_change(
    root: &Path,
    workspace: &WorkspaceState,
    world: &MobileWorld,
    compile: &CompileState,
    from: String,
    to: Option<String>,
) -> Result<EntryChange, String> {
    let MetaRemap { meta, main_changed } = remap_meta(root, &from, to.as_deref())?;
    match &meta.main_file {
        Some(rel) => world.set_main(world.rel_to_id(rel)?),
        None => world.clear_main(),
    }
    if main_changed {
        // The cached document belongs to the main file's *old* identity. Left
        // in place it outlives the file: `export_pdf` would still write out the
        // document the user just deleted, and the renderer would keep serving
        // its pages. Same reasoning as the reset in `open_workspace`.
        *compile.document.lock() = None;
        compile.page_lookup.lock().clear();
    }
    info!(
        "entry change: {from:?} -> {to:?} (main={:?}, main_changed={main_changed})",
        meta.main_file
    );
    Ok(EntryChange {
        tree: tree_of(workspace)?,
        from,
        to,
    })
}

/// The last `/`-separated segment of a workspace-relative path.
fn last_segment(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

/// Join a folder's relative path with a child name; an empty parent is the root.
fn join_rel(parent: &str, name: &str) -> String {
    let parent = parent.trim_end_matches('/');
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// Reject names that are unsafe as a single path segment.
fn validate_workspace_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Workspace name cannot be empty".into());
    }
    if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Workspace name contains invalid characters".into());
    }
    Ok(())
}

/// The package store directory (if it lives under the workspaces root). Such
/// an entry is listed as a `system` workspace so the UI can present it as
/// app-managed rather than user-created.
fn system_dir(app: &AppHandle) -> Option<PathBuf> {
    crate::packages_dirs(app).1
}

/// Which workspace an id names. Ids are `app:<name>` for app-storage
/// workspaces and `folder:<hex>` for picked folders; a bare name is an
/// app-storage workspace (what `lastWorkspace` held before folders existed).
pub(crate) enum Target {
    App { name: String, dir: PathBuf },
    Folder { entry: FolderEntry, mirror: PathBuf },
}

pub(crate) fn resolve_target(app: &AppHandle, id: &str) -> Result<Target, String> {
    if id.starts_with(FOLDER_PREFIX) {
        let entry = registry::find(app, id)
            .ok_or_else(|| "This workspace is no longer in the list".to_string())?;
        let mirror = registry::mirror_dir(app, id)?;
        return Ok(Target::Folder { entry, mirror });
    }
    let name = id.strip_prefix(APP_PREFIX).unwrap_or(id).to_string();
    validate_workspace_name(&name)?;
    let dir = root_dir(app).join(&name);
    Ok(Target::App { name, dir })
}

fn app_id(name: &str) -> String {
    format!("{APP_PREFIX}{name}")
}

fn folder_meta(entry: &FolderEntry) -> WorkspaceMeta {
    WorkspaceMeta {
        id: entry.id.clone(),
        name: entry.name.clone(),
        path: entry.remote.display(),
        kind: "folder",
        last_opened_ms: entry.last_opened_ms,
        system: false,
    }
}

/// The user workspaces still in app storage (not the package store).
fn app_workspace_dirs(app: &AppHandle) -> Vec<(String, PathBuf)> {
    let system = system_dir(app);
    let Ok(entries) = std::fs::read_dir(root_dir(app)) else {
        return Vec::new();
    };
    let mut out: Vec<(String, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && system.as_deref() != Some(path.as_path()))
        .filter_map(|path| {
            let name = path.file_name()?.to_str()?.to_string();
            (!name.starts_with('.')).then_some((name, path))
        })
        .collect();
    out.sort();
    out
}

#[tauri::command]
pub async fn list_workspaces(app: AppHandle) -> Result<Vec<WorkspaceMeta>, String> {
    let root = root_dir(&app);
    let system = system_dir(&app);
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let meta = read_meta(&path);
        out.push(WorkspaceMeta {
            id: app_id(name),
            name: name.to_string(),
            path: path.to_string_lossy().into_owned(),
            kind: "app",
            last_opened_ms: meta.last_opened_ms,
            system: system.as_deref() == Some(path.as_path()),
        });
    }
    out.extend(registry::read(&app).folders.iter().map(folder_meta));
    out.sort_by(|a, b| {
        b.last_opened_ms
            .cmp(&a.last_opened_ms)
            .then(a.name.cmp(&b.name))
    });
    Ok(out)
}

/// Where "New workspace" will create the next one, as a readable label, or
/// `None` before the user has chosen.
#[tauri::command]
pub async fn get_workspace_location(app: AppHandle) -> Result<Option<String>, String> {
    Ok(registry::read(&app).last_parent.map(|spec| spec.display()))
}

/// Let the user choose where new workspaces are created. Returns the new
/// location's label, or `None` when they cancelled.
#[tauri::command]
pub async fn pick_workspace_location(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(spec) = folders::pick_folder(&app)? else {
            return Ok(None);
        };
        set_last_parent(&app, spec.clone())?;
        Ok(Some(spec.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn set_last_parent(app: &AppHandle, spec: RemoteSpec) -> Result<(), String> {
    let previous = registry::update(app, |r| r.last_parent.replace(spec.clone()))?;
    if let Some(previous) = previous.filter(|p| *p != spec) {
        folders::release_unused_grant(app, &previous);
    }
    Ok(())
}

/// Create a workspace with a starter `main.typ`, and list it: in the app's
/// own storage, or — once the user has opted into folder workspaces
/// (`in_folder`) — as a new folder inside the chosen location.
#[tauri::command]
pub async fn create_workspace(
    name: String,
    in_folder: bool,
    app: AppHandle,
) -> Result<WorkspaceMeta, String> {
    validate_workspace_name(&name)?;
    if !in_folder {
        let dir = root_dir(&app).join(&name);
        if dir.exists() {
            return Err(format!("A workspace named \"{name}\" already exists"));
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("main.typ"), STARTER_MAIN).map_err(|e| e.to_string())?;
        update_meta(&dir, |meta| meta.main_file = Some("main.typ".to_string()))?;
        info!("create_workspace: {name:?} in app storage");
        return Ok(WorkspaceMeta {
            id: app_id(&name),
            name,
            path: dir.to_string_lossy().into_owned(),
            kind: "app",
            last_opened_ms: None,
            system: false,
        });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let parent_spec = registry::read(&app)
            .last_parent
            .ok_or_else(|| "Choose where to create the workspace first".to_string())?;
        let parent = open_remote(&app, &parent_spec);
        if parent.exists(&name) {
            return Err(format!(
                "A folder named \"{name}\" already exists in {}",
                parent_spec.display()
            ));
        }
        parent.create_dir(&name)?;
        let spec = parent.child_spec(&name)?;
        open_remote(&app, &spec).write("main.typ", STARTER_MAIN.as_bytes())?;
        let entry = registry::register(&app, name.clone(), spec, None)?;
        // Seed the mirror's metadata so the first open lands on main.typ.
        let mirror = registry::mirror_dir(&app, &entry.id)?;
        std::fs::create_dir_all(&mirror).map_err(|e| e.to_string())?;
        update_meta(&mirror, |meta| meta.main_file = Some("main.typ".to_string()))?;
        info!("create_workspace: {name:?} in {}", parent_spec.display());
        Ok(folder_meta(&entry))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pick an existing folder and list it as a workspace. `None` when the user
/// cancelled. Adding a folder that is already listed returns its entry.
#[tauri::command]
pub async fn add_folder_workspace(app: AppHandle) -> Result<Option<WorkspaceMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(spec) = folders::pick_folder(&app)? else {
            return Ok(None);
        };
        let name = folders::folder_name(&app, &spec);
        let entry = registry::register(&app, name, spec, None)?;
        info!(
            "add_folder_workspace: {:?} at {}",
            entry.name,
            entry.remote.display()
        );
        Ok(Some(folder_meta(&entry)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete an app-storage workspace, or take a folder workspace off the list.
/// A folder's files are the user's and stay where they are; only the app's
/// mirror and its access grant go.
#[tauri::command]
pub async fn delete_workspace(
    id: String,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<(), String> {
    match resolve_target(&app, &id)? {
        Target::App { name, dir } => {
            if system_dir(&app).as_deref() == Some(dir.as_path()) {
                return Err("The package store is managed by the app and can't be deleted".into());
            }
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
            }
            info!("delete_workspace: {name:?}");
        }
        Target::Folder { entry, mirror } => {
            if workspace.root.read().as_deref() == Some(mirror.as_path()) {
                workspace.replace_sync(None);
                watcher.stop();
                *workspace.root.write() = None;
            }
            registry::update(&app, |r| r.folders.retain(|f| f.id != entry.id))?;
            let _ = std::fs::remove_dir_all(&mirror);
            folders::release_unused_grant(&app, &entry.remote);
            info!("remove folder workspace: {:?}", entry.name);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_workspace(
    id: String,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<WorkspaceInfo, String> {
    let workspace = workspace.inner().clone();
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    let watcher = watcher.inner().clone();
    // A folder workspace's first sync is a SAF walk; keep it off the runtime.
    tauri::async_runtime::spawn_blocking(move || {
        open_workspace_blocking(&app, &id, &workspace, &world, &compile, &watcher)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn open_workspace_blocking(
    app: &AppHandle,
    id: &str,
    workspace: &WorkspaceState,
    world: &MobileWorld,
    compile: &CompileState,
    watcher: &WatcherState,
) -> Result<WorkspaceInfo, String> {
    let t = Instant::now();
    let target = resolve_target(app, id)?;
    // Whatever was syncing is being left: say "stopped" for it before this
    // workspace says "started", so the announcements read in order.
    workspace.replace_sync(None);
    let (id, name, dir, sync) = match target {
        Target::App { name, dir } => {
            if !dir.is_dir() {
                return Err(format!("Workspace \"{name}\" not found"));
            }
            (app_id(&name), name, dir, None)
        }
        Target::Folder { entry, mirror } => {
            std::fs::create_dir_all(&mirror).map_err(|e| e.to_string())?;
            let location = entry.remote.display();
            let sync = Arc::new(
                FolderSync::new(open_remote(app, &entry.remote), mirror.clone()).with_events(
                    app.clone(),
                    entry.id.clone(),
                    entry.name.clone(),
                    location.clone(),
                ),
            );
            // Syncing starts now, and the UI says so (progress included).
            sync.announce();
            if has_synced(&mirror) {
                // The fastest open: straight from the last synced copy. The
                // frontend asks for a rescan as soon as the editor is up, and
                // whatever changed meanwhile arrives like any external edit.
                info!("open_workspace: opening {location} from its last synced copy");
            } else {
                // Nothing to show yet: the first copy has to finish first.
                let changed = sync.pull().map_err(|e| {
                    format!(
                        "Can't reach the folder {location}. It may have been moved or deleted, or access to it was revoked. ({e})"
                    )
                })?;
                info!(
                    "open_workspace: first sync copied {} entries from {location}",
                    changed.len()
                );
            }
            registry::touch(app, &entry.id, now_ms())?;
            (entry.id, entry.name, mirror, Some(sync))
        }
    };

    // Record last-opened and persist the resolved main file in one pass.
    let mut main_file = None;
    let meta = update_meta(&dir, |meta| {
        main_file = detect_main_file(&dir, meta.main_file.as_deref());
        meta.main_file = main_file.clone();
        meta.last_opened_ms = Some(now_ms());
    })?;

    let _gate = world.session_gate.write();
    *workspace.document.lock() = None;
    // Stops the previous folder's polling, if any.
    workspace.replace_sync(sync.clone());
    *workspace.root.write() = Some(dir.clone());
    world.set_root(dir.clone());
    // Follow the new root. This also tears down the previous workspace's
    // watcher, whose paths mean nothing here. A folder workspace needs none:
    // nothing but the folder sync writes to its private mirror, and the sync
    // reports what it brings in itself — no second poll, no extra latency.
    match &sync {
        None => watcher.start(dir.clone(), app.clone()),
        Some(sync) => {
            watcher.stop();
            sync.set_hot(meta.active_tab.clone());
            sync.start_polling(false);
        }
    }
    // Drop the previous workspace's compiled document so the preview (and PDF
    // export) can never serve the old workspace's pages after a switch.
    *compile.document.lock() = None;
    compile.page_lookup.lock().clear();
    if let Some(rel) = &main_file {
        world.set_main(world.rel_to_id(rel)?);
    }

    let still_exists = |rel: &str| {
        resolve_in_root(&dir, rel)
            .map(|p| p.is_file())
            .unwrap_or(false)
    };

    let last_file = meta.last_file.clone().filter(|rel| still_exists(rel));

    // Restore open tabs, dropping any whose file no longer exists.
    let open_tabs: Vec<String> = meta
        .open_tabs
        .iter()
        .filter(|rel| still_exists(rel))
        .cloned()
        .collect();
    let active_tab = meta
        .active_tab
        .clone()
        .filter(|rel| open_tabs.iter().any(|t| t == rel));
    // The caret only means anything against the tab it was recorded in: drop it
    // when that tab didn't survive, so the frontend can't seed it into whatever
    // file it falls back to.
    let cursor = meta.cursor.filter(|_| active_tab.is_some());

    info!(
        "open_workspace: {name:?} main={main_file:?} tabs={} ({:.1}ms)",
        open_tabs.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(WorkspaceInfo {
        id,
        name,
        root: dir.to_string_lossy().into_owned(),
        tree: build_tree(&dir),
        main_file,
        last_file,
        open_tabs,
        active_tab,
        cursor,
        document: false,
    })
}

/// The open folder workspace's sync state, for a freshly mounted indicator.
/// `None` when no folder workspace is open.
#[tauri::command]
pub async fn get_sync_status(
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<Option<SyncStatus>, String> {
    Ok(workspace.sync().map(|sync| sync.status()))
}

/// Pause polling while the app is in the background; resuming catches up
/// immediately.
#[tauri::command]
pub async fn set_sync_paused(
    paused: bool,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    if let Some(sync) = workspace.sync() {
        sync.set_paused(paused);
    }
    Ok(())
}

/// Stop syncing the open folder workspace (the user left it). Announced as a
/// `stopped` status. Opening it again starts a new sync.
#[tauri::command]
pub async fn stop_folder_sync(workspace: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    workspace.replace_sync(None);
    Ok(())
}

// ─── Moving app-storage workspaces into a folder ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub moved: Vec<MovedWorkspace>,
    pub failed: Vec<FailedWorkspace>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedWorkspace {
    pub name: String,
    /// The id it had in app storage.
    pub from: String,
    /// Its id as a folder workspace.
    pub to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedWorkspace {
    pub name: String,
    pub error: String,
}

/// Move every workspace still in app storage into a folder the user picks.
/// The package store stays where it is. Returns `None` when the picker was
/// cancelled.
///
/// Each workspace is copied, the copy checked against the original, and only
/// then is the original deleted; one that fails is left where it was and
/// reported. Tab state and the main file come along in the new mirror, so the
/// workspace reopens exactly as it was left.
#[tauri::command]
pub async fn migrate_app_workspaces(
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<Option<MigrationReport>, String> {
    let workspace = workspace.inner().clone();
    let watcher = watcher.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let sources = app_workspace_dirs(&app);
        if sources.is_empty() {
            return Err("There are no workspaces in app storage to move".into());
        }
        let Some(dest) = folders::pick_folder(&app)? else {
            return Ok(None);
        };
        // New workspaces go to the same place from now on.
        set_last_parent(&app, dest.clone())?;

        // Home keeps the last workspace open in the backend. If that is one of
        // these, let go of it first: its watcher would otherwise rewrite
        // metadata into a folder that is being copied and then deleted.
        let base = root_dir(&app);
        if workspace
            .root
            .read()
            .as_deref()
            .is_some_and(|root| root.starts_with(&base))
        {
            watcher.stop();
            *workspace.root.write() = None;
        }

        let parent = open_remote(&app, &dest);
        let mut report = MigrationReport {
            moved: Vec::new(),
            failed: Vec::new(),
        };
        for (name, dir) in sources {
            let t = Instant::now();
            match migrate_one(&app, &*parent, &name, &dir) {
                Ok(id) => {
                    info!(
                        "migrate: {name:?} -> {} ({:.1}ms)",
                        dest.display(),
                        t.elapsed().as_secs_f64() * 1000.0
                    );
                    report.moved.push(MovedWorkspace {
                        from: app_id(&name),
                        to: id,
                        name,
                    });
                }
                Err(error) => {
                    warn!("migrate: {name:?} failed: {error}");
                    report.failed.push(FailedWorkspace { name, error });
                }
            }
        }
        Ok(Some(report))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn migrate_one(
    app: &AppHandle,
    parent: &dyn Remote,
    name: &str,
    dir: &Path,
) -> Result<String, String> {
    if parent.exists(name) {
        return Err("A folder with this name already exists there".into());
    }
    parent.create_dir(name)?;
    let copy = || -> Result<(RemoteSpec, Vec<RemoteEntry>), String> {
        let spec = parent.child_spec(name)?;
        let remote = open_remote(app, &spec);
        let (dirs, files) = local_tree(dir);
        for rel in &dirs {
            remote.create_dir(rel)?;
        }
        for (rel, abs) in &files {
            let bytes = std::fs::read(abs).map_err(|e| format!("{rel}: {e}"))?;
            remote.write(rel, &bytes)?;
        }
        // Check what arrived before anything is deleted.
        let listed = remote.list("", false)?;
        for (rel, abs) in &files {
            let len = std::fs::metadata(abs).map_err(|e| e.to_string())?.len();
            let arrived = listed
                .iter()
                .any(|entry| entry.rel == *rel && entry.stamp.map(|s| s.len) == Some(len));
            if !arrived {
                return Err(format!("\"{rel}\" did not arrive intact"));
            }
        }
        Ok((spec, listed))
    };
    let (spec, listed) = match copy() {
        Ok(done) => done,
        Err(e) => {
            // Only ever the folder this call created a moment ago.
            let _ = parent.remove(name);
            return Err(e);
        }
    };

    let entry = registry::register(
        app,
        name.to_string(),
        spec.clone(),
        read_meta(dir).last_opened_ms,
    )?;
    let mirror = registry::mirror_dir(app, &entry.id)?;
    let _ = std::fs::remove_dir_all(&mirror);
    // The whole workspace, `.typwriter/` included: the tabs, caret and main
    // file live there and should survive the move.
    copy_dir(dir, &mirror)?;
    FolderSync::new(open_remote(app, &spec), mirror).adopt(&listed);

    if let Err(e) = std::fs::remove_dir_all(dir) {
        warn!("migrate: copied {name:?} but could not remove the original: {e}");
    }
    Ok(entry.id)
}

/// The non-hidden directories (parents first) and files under `root`,
/// relative to it.
fn local_tree(root: &Path) -> (Vec<String>, Vec<(String, PathBuf)>) {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::new())];
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
            if path.is_dir() {
                dirs.push(child.clone());
                stack.push((path, child));
            } else {
                files.push((child, path));
            }
        }
    }
    (dirs, files)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_dir(&source, &target)?;
        } else {
            std::fs::copy(&source, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_file_tree(workspace: State<'_, Arc<WorkspaceState>>) -> Result<FileNode, String> {
    tree_of(&workspace)
}

/// Re-read the workspace from disk and drop every cached file slot, then hand
/// back the fresh tree.
///
/// The frontend calls this when the app returns to the foreground. Android is
/// free to freeze a backgrounded process, so the poll watcher may simply not
/// have run while the user was in their file manager — and when it resumes it
/// diffs against the snapshot it took before the freeze, which can miss a
/// change that was made and then undone. Asking outright on resume is cheap and
/// removes the whole question.
#[tauri::command]
pub async fn rescan_workspace(
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<FileNode, String> {
    // Stamps are compared against disk on every compile anyway, but a slot
    // whose file was replaced with one of the same length and mtime would
    // survive that check; a resume is a cheap moment to be certain.
    let workspace = workspace.inner().clone();
    let world = world.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // A folder workspace's poller was frozen too: catch the mirror up with
        // whatever a sync client delivered meanwhile. Not fatal — an
        // unreachable folder still leaves the last synced copy to work on, and
        // the poller reports it.
        if let Some(sync) = workspace.sync() {
            if let Err(e) = sync.pull() {
                warn!("rescan: folder sync failed: {e}");
            }
        }
        let _gate = world.session_gate.write();
        crate::document::refresh(&app, &workspace)?;
        world.clear_cache();
        tree_of(&workspace)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_main_file(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<(), String> {
    let root = current_root(&workspace)?;
    let abs = resolve_in_root(&root, &rel_path)?;
    if !abs.is_file() {
        return Err(format!("Not a file: {rel_path}"));
    }
    world.set_main(world.rel_to_id(&rel_path)?);
    update_meta(&root, |meta| meta.main_file = Some(rel_path.clone()))?;
    info!("set_main_file: {rel_path:?}");
    Ok(())
}

#[tauri::command]
pub async fn set_last_file(
    rel_path: Option<String>,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    if workspace.document.lock().is_some() {
        return Ok(());
    }
    let root = current_root(&workspace)?;
    update_meta(&root, |meta| meta.last_file = rel_path)?;
    Ok(())
}

/// Open the platform folder picker and persist the chosen folder as the
/// app-wide fonts source. Returns the folder's display name, or `None` if the
/// user cancelled. On Android this uses the SAF directory picker so the fonts
/// stay reachable after a restart. The fonts are (re)loaded immediately on a
/// background thread — no app restart needed.
#[tauri::command]
pub async fn pick_fonts_dir(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<Option<String>, String> {
    let world = world.inner().clone();
    let handle = app.clone();
    // The picker blocks until the user responds — keep it off the runtime.
    let picked = tauri::async_runtime::spawn_blocking(move || crate::fonts::pick(&handle))
        .await
        .map_err(|e| format!("picker task panicked: {e}"))??;
    if picked.is_some() {
        crate::fonts::load_in_background(app, world);
    }
    Ok(picked)
}

/// Clear the app-wide fonts source (and release any SAF permission), then
/// reload the font set (back to embedded + the conventional folder).
#[tauri::command]
pub async fn clear_fonts_dir(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<(), String> {
    crate::fonts::clear_source(&app)?;
    crate::fonts::load_in_background(app, world.inner().clone());
    Ok(())
}

/// The persisted fonts folder and how many font families the compiler ended up
/// with. The settings UI reads this so the shown folder always matches what the
/// backend actually loads — and so a folder that yielded nothing is visible
/// rather than silent.
#[tauri::command]
pub async fn get_fonts_status(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
) -> Result<crate::fonts::FontsStatus, String> {
    Ok(crate::fonts::FontsStatus {
        folder: crate::fonts::source_display_name(&app),
        family_count: world.font_family_count(),
        loading: world.fonts_loading(),
    })
}

#[tauri::command]
pub async fn set_open_tabs(
    open_tabs: Vec<String>,
    active_tab: Option<String>,
    cursor: Option<usize>,
    workspace: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    if workspace.document.lock().is_some() {
        return Ok(());
    }
    let root = current_root(&workspace)?;
    if let Some(sync) = workspace.sync() {
        sync.set_hot(active_tab.clone());
    }
    update_meta(&root, |meta| {
        meta.open_tabs = open_tabs;
        meta.active_tab = active_tab;
        meta.cursor = cursor;
    })?;
    Ok(())
}

// The file operations below change the folder first when this is a folder
// workspace (see `WorkspaceState::mutate`). That is a SAF round trip, so each
// runs on `spawn_blocking` rather than on the async runtime.

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_file(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<FileNode, String> {
    let workspace = workspace.inner().clone();
    let watcher = watcher.inner().clone();
    blocking(move || {
        let root = current_root(&workspace)?;
        let abs = resolve_in_root(&root, &rel_path)?;
        if abs.exists() {
            return Err(format!("Already exists: {rel_path}"));
        }
        workspace.mutate(
            |folder| folder.create_file(&rel_path),
            || {
                if let Some(parent) = abs.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(&abs, b"").map_err(|e| e.to_string())?;
                watcher.self_writes.note_write(&abs);
                Ok(())
            },
        )?;
        info!("create_file: {rel_path:?}");
        tree_of(&workspace)
    })
    .await
}

#[tauri::command]
pub async fn create_folder(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<FileNode, String> {
    let workspace = workspace.inner().clone();
    let watcher = watcher.inner().clone();
    blocking(move || {
        let root = current_root(&workspace)?;
        let abs = resolve_in_root(&root, &rel_path)?;
        if abs.exists() {
            return Err(format!("Already exists: {rel_path}"));
        }
        workspace.mutate(
            |folder| folder.create_dir(&rel_path),
            || {
                std::fs::create_dir_all(&abs).map_err(|e| e.to_string())?;
                watcher.self_writes.note_write(&abs);
                Ok(())
            },
        )?;
        info!("create_folder: {rel_path:?}");
        tree_of(&workspace)
    })
    .await
}

#[tauri::command]
pub async fn rename_entry(
    rel_path: String,
    new_name: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<EntryChange, String> {
    if new_name.contains(['/', '\\']) {
        return Err("Name cannot contain path separators".into());
    }
    let workspace = workspace.inner().clone();
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    let watcher = watcher.inner().clone();
    blocking(move || {
        let root = current_root(&workspace)?;
        let abs = resolve_in_root(&root, &rel_path)?;
        let parent = abs
            .parent()
            .ok_or_else(|| "Cannot rename the workspace root".to_string())?;
        let dest = parent.join(&new_name);
        if dest.exists() {
            return Err(format!("Already exists: {new_name}"));
        }
        // The entry keeps its parent, so only the last segment changes.
        let parent_rel = match rel_path.rfind('/') {
            Some(i) => &rel_path[..i],
            None => "",
        };
        let to = join_rel(parent_rel, &new_name);
        workspace.mutate(
            |folder| folder.rename(&rel_path, &new_name, &to),
            || {
                let moved = collect_tree(&abs);
                std::fs::rename(&abs, &dest).map_err(|e| e.to_string())?;
                claim_move(&watcher, &abs, &dest, &moved);
                Ok(())
            },
        )?;
        finish_entry_change(&root, &workspace, &world, &compile, rel_path, Some(to))
    })
    .await
}

#[tauri::command]
pub async fn move_entry(
    rel_path: String,
    new_parent_rel: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<EntryChange, String> {
    let workspace = workspace.inner().clone();
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    let watcher = watcher.inner().clone();
    blocking(move || {
        let root = current_root(&workspace)?;
        let abs = resolve_in_root(&root, &rel_path)?;
        // Empty new_parent_rel means the workspace root.
        let new_parent = if new_parent_rel.is_empty() {
            root.clone()
        } else {
            resolve_in_root(&root, &new_parent_rel)?
        };
        if !new_parent.is_dir() {
            return Err(format!("Not a folder: {new_parent_rel}"));
        }
        let file_name = abs
            .file_name()
            .ok_or_else(|| "Invalid source path".to_string())?;
        let dest = new_parent.join(file_name);
        if dest.exists() {
            return Err("Target already exists in destination folder".into());
        }
        // Guard against moving a directory into itself / its descendant.
        if abs.is_dir() && dest.starts_with(&abs) {
            return Err("Cannot move a folder into itself".into());
        }
        // The entry keeps its name, so only the parent changes.
        let to = join_rel(&new_parent_rel, last_segment(&rel_path));
        workspace.mutate(
            |folder| folder.move_into(&rel_path, &new_parent_rel, &to),
            || {
                let moved = collect_tree(&abs);
                std::fs::rename(&abs, &dest).map_err(|e| e.to_string())?;
                claim_move(&watcher, &abs, &dest, &moved);
                Ok(())
            },
        )?;
        finish_entry_change(&root, &workspace, &world, &compile, rel_path, Some(to))
    })
    .await
}

#[tauri::command]
pub async fn delete_entry(
    rel_path: String,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<EntryChange, String> {
    let workspace = workspace.inner().clone();
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    let watcher = watcher.inner().clone();
    blocking(move || {
        let root = current_root(&workspace)?;
        let abs = resolve_in_root(&root, &rel_path)?;
        // A delete that removed nothing must not be reported as one: the caller
        // fans the change out, closing tabs and clearing the main file for a
        // path that was never there.
        if !abs.exists() {
            return Err(format!("Not found: {rel_path}"));
        }
        workspace.mutate(
            |folder| folder.remove(&rel_path),
            || {
                let removed = collect_tree(&abs);
                delete_path(&abs)?;
                watcher.self_writes.note_removal(&abs);
                for path in &removed {
                    watcher.self_writes.note_removal(path);
                }
                Ok(())
            },
        )?;
        finish_entry_change(&root, &workspace, &world, &compile, rel_path, None)
    })
    .await
}

/// Every file under `root`, plus `root` itself when it is a file. Collected
/// *before* a move or delete, while the paths still resolve.
///
/// A folder operation is one call to the app and a whole subtree of events to
/// the watcher, so each of those paths has to be claimed individually or the
/// poll that notices them reports the app's own work back to it.
fn collect_tree(root: &Path) -> Vec<PathBuf> {
    if root.is_file() {
        return vec![root.to_path_buf()];
    }
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path.clone());
            }
            out.push(path);
        }
    }
    out
}

/// Claim both ends of a move: the source paths are gone, the destination ones
/// are new. A poll reports a move as exactly that pair.
fn claim_move(watcher: &WatcherState, src: &Path, dest: &Path, moved: &[PathBuf]) {
    watcher.self_writes.note_removal(src);
    watcher.self_writes.note_write(dest);
    for path in moved {
        watcher.self_writes.note_removal(path);
        if let Ok(tail) = path.strip_prefix(src) {
            watcher.self_writes.note_write(&dest.join(tail));
        }
    }
}

fn delete_path(abs: &Path) -> Result<(), String> {
    if abs.is_dir() {
        std::fs::remove_dir_all(abs).map_err(|e| e.to_string())
    } else if abs.exists() {
        std::fs::remove_file(abs).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}
