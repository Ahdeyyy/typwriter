//! Standalone SAF documents. Only the granted file is mirrored for the compiler;
//! metadata and compilation files stay in app data, never beside the original.

use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
};

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_android_fs::FileUri;

use crate::{
    compiler::CompileState,
    watcher::WatcherState,
    workspace::{FileNode, WorkspaceInfo, WorkspaceState},
    world::MobileWorld,
};

#[derive(Default)]
pub struct FileOpenState(pub Mutex<Vec<String>>);

pub struct DocumentSession {
    pub uri: FileUri,
    pub name: String,
    pub root: PathBuf,
    /// Last observed original bytes, used to catch a conflicting external save.
    source: String,
    /// Rescans cannot acknowledge a conflict on behalf of a dirty editor.
    /// Only a successful read or an explicit Keep mine save clears this.
    pub conflicted: bool,
}

impl DocumentSession {
    fn refresh_source(&mut self, fresh: String) -> Result<bool, String> {
        if fresh == self.source {
            return Ok(false);
        }
        write_mirror(&self.root, &self.name, &fresh)?;
        self.source = fresh;
        self.conflicted = true;
        Ok(true)
    }

    fn write_through(
        &mut self,
        content: &str,
        write: impl FnOnce(&FileUri, &str) -> Result<(), String>,
    ) -> Result<(), String> {
        // A failed provider write must not acknowledge a save that only
        // reached our private compilation mirror.
        write(&self.uri, content)?;
        write_mirror(&self.root, &self.name, content)?;
        self.source = content.to_owned();
        self.conflicted = false;
        Ok(())
    }

    pub fn tree(&self) -> FileNode {
        FileNode {
            name: self.name.clone(),
            rel_path: String::new(),
            is_dir: true,
            children: vec![FileNode {
                name: self.name.clone(),
                rel_path: self.name.clone(),
                is_dir: false,
                children: vec![],
            }],
        }
    }
}

fn write_mirror(root: &Path, name: &str, content: &str) -> Result<(), String> {
    let temporary = root.join(format!("{name}.tmp"));
    std::fs::write(&temporary, content).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, root.join(name)).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        e.to_string()
    })
}

pub fn validate_name(name: &str) -> Result<(), String> {
    if name.contains(['/', '\\', ':'])
        || !Path::new(name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("typ"))
    {
        return Err("Choose a .typ document".into());
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn local_path(uri: &FileUri) -> Result<PathBuf, String> {
    tauri::Url::parse(&uri.uri)
        .map_err(|e| e.to_string())?
        .to_file_path()
        .map_err(|_| "Unsupported document URI".into())
}

fn read_original(app: &AppHandle, uri: &FileUri) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        app.android_fs()
            .read_to_string(uri)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        std::fs::read_to_string(local_path(uri)?).map_err(|e| e.to_string())
    }
}

fn write_original(app: &AppHandle, uri: &FileUri, content: &str) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        app.android_fs().write(uri, content.as_bytes()).map_err(|e| {
            format!("Cannot save to the original file: {e}. Try opening it with Open file to grant write access.")
        })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        std::fs::write(local_path(uri)?, content).map_err(|e| e.to_string())
    }
}

fn notify_changed(app: &AppHandle, name: &str) {
    let _ = app.emit(
        "workspace:files-changed",
        serde_json::json!({
            "changes": [{ "relPath": name, "kind": "modified", "isDir": false }]
        }),
    );
}

/// Called on foreground/reload, and before saving. A changed original becomes
/// the new observed version, while the frontend keeps a dirty buffer intact.
fn refresh_session(app: &AppHandle, session: &mut DocumentSession) -> Result<bool, String> {
    let fresh = read_original(app, &session.uri)?;
    let changed = session.refresh_source(fresh)?;
    if changed {
        notify_changed(app, &session.name);
    }
    Ok(changed)
}

pub fn refresh(app: &AppHandle, workspace: &WorkspaceState) -> Result<(), String> {
    if let Some(session) = workspace.document.lock().as_mut() {
        refresh_session(app, session)?;
    }
    Ok(())
}

/// `true` means this was a standalone save; workspace saves use their usual IO.
pub fn save(
    app: &AppHandle,
    workspace: &WorkspaceState,
    rel: &str,
    content: &str,
    overwrite: bool,
) -> Result<bool, String> {
    let mut document = workspace.document.lock();
    let Some(session) = document.as_mut() else {
        return Ok(false);
    };
    if rel != session.name {
        return Err("Only the opened document is accessible in this session".into());
    }
    refresh_session(app, session)?;
    if session.conflicted && !overwrite {
        return Err("File changed on disk. Choose Keep mine or Reload before saving.".into());
    }
    session.write_through(content, |uri, content| write_original(app, uri, content))?;
    Ok(true)
}

#[tauri::command]
pub async fn take_open_files(state: State<'_, FileOpenState>) -> Result<Vec<String>, String> {
    Ok(std::mem::take(&mut *state.0.lock()))
}

#[tauri::command]
pub async fn pick_document(
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceState>>,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    watcher: State<'_, Arc<WatcherState>>,
) -> Result<Option<WorkspaceInfo>, String> {
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        let app = handle;
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_android_fs::AndroidFsExt;
            let fs = app.android_fs();
            // Android has no universally recognized Typst MIME type. Let the
            // user browse all files, then validate the provider's display name.
            let picked = fs
                .file_picker()
                .pick_file(None, &["*/*"], false)
                .map_err(|e| e.to_string())?;
            Ok(picked.map(|uri| uri.uri))
        }
        #[cfg(not(target_os = "android"))]
        {
            use tauri_plugin_dialog::{DialogExt, FilePath};
            app.dialog()
                .file()
                .add_filter("Typst", &["typ"])
                .blocking_pick_file()
                .map(|path| match path {
                    FilePath::Url(url) => Ok(url.to_string()),
                    FilePath::Path(path) => tauri::Url::from_file_path(path)
                        .map(|url| url.to_string())
                        .map_err(|_| "Invalid document path".to_string()),
                })
                .transpose()
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    let Some(uri) = picked else {
        return Ok(None);
    };
    // Complete the native open before returning to the webview. The picker
    // and its URI handoff must be one session transition, including on resume.
    open_document(uri, app, workspace, world, compile, watcher)
        .await
        .map(Some)
}

#[tauri::command]
pub async fn open_document(
    uri: String,
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
    tauri::async_runtime::spawn_blocking(move || {
        let url = tauri::Url::parse(&uri).map_err(|e| e.to_string())?;
        if !matches!(url.scheme(), "content" | "file") {
            return Err("Unsupported document URI".into());
        }
        let uri = FileUri::from_uri(uri);
        #[cfg(target_os = "android")]
        let name = {
            use tauri_plugin_android_fs::AndroidFsExt;
            app.android_fs()
                .get_name(&uri)
                .map_err(|e| format!("Cannot get the selected file's name: {e}"))?
        };
        #[cfg(not(target_os = "android"))]
        let name = local_path(&uri)?
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or("Invalid document name")?;
        validate_name(&name).map_err(|e| format!("{e} (selected: {name})"))?;
        let source = read_original(&app, &uri)
            .map_err(|e| format!("Cannot read the selected document: {e}"))?;
        let mut hasher = DefaultHasher::new();
        uri.uri.hash(&mut hasher);
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("documents")
            .join(format!("{:016x}", hasher.finish()));
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("Cannot create the document's compilation directory: {e}"))?;
        let id = crate::world::local_file_id(Path::new(&name)).ok_or("Invalid document name")?;
        let _gate = world.session_gate.write();
        write_mirror(&root, &name, &source)
            .map_err(|e| format!("Cannot prepare the selected document for editing: {e}"))?;
        let session = DocumentSession {
            uri,
            name: name.clone(),
            root: root.clone(),
            source,
            conflicted: false,
        };
        let tree = session.tree();
        watcher.stop();
        *workspace.document.lock() = Some(session);
        *workspace.root.write() = Some(root.clone());
        world.set_root(root.clone());
        world.set_main(id);
        *compile.document.lock() = None;
        compile.page_lookup.lock().clear();
        Ok(WorkspaceInfo {
            name: name.clone(),
            root: root.to_string_lossy().into_owned(),
            tree,
            main_file: Some(name.clone()),
            last_file: Some(name.clone()),
            open_tabs: vec![name.clone()],
            active_tab: Some(name),
            cursor: None,
            document: true,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_names_must_be_single_typst_files() {
        for name in ["notes.typ", "Hello world.TYP", "draft.v2.typ", "日本語.typ"] {
            assert!(validate_name(name).is_ok(), "{name}");
        }
        for name in [
            "",
            "../main.typ",
            "folder/main.typ",
            "folder\\main.typ",
            ".typ",
            "notes.txt",
            "C:main.typ",
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
    }

    #[test]
    fn mirror_tracks_external_changes_and_failed_provider_writes_stay_unacknowledged() {
        let root = std::env::temp_dir().join(format!(
            "typwriter-document-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let mut session = DocumentSession {
            uri: FileUri::from_uri("content://provider/42"),
            name: "notes.typ".into(),
            root: root.clone(),
            source: "original".into(),
            conflicted: false,
        };
        std::fs::write(root.join("notes.typ"), "original").unwrap();
        assert!(session.refresh_source("external edit".into()).unwrap());
        assert!(!session.refresh_source("external edit".into()).unwrap());
        assert!(session
            .write_through("my edit", |_, _| Err("permission denied".into()))
            .is_err());
        assert_eq!(session.source, "external edit");
        assert!(session.conflicted);
        assert_eq!(
            std::fs::read_to_string(root.join("notes.typ")).unwrap(),
            "external edit"
        );
        let original = root.join("original.typ");
        session
            .write_through("my edit", |_, content| {
                std::fs::write(&original, content).map_err(|e| e.to_string())
            })
            .unwrap();
        assert_eq!(std::fs::read_to_string(&original).unwrap(), "my edit");
        assert_eq!(
            std::fs::read_to_string(root.join("notes.typ")).unwrap(),
            "my edit"
        );
        assert_eq!(session.source, "my edit");
        assert!(!session.conflicted);
        std::fs::remove_dir_all(root).unwrap();
    }
}
