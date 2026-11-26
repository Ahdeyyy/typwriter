//! Folder workspaces: workspaces that live in any folder the user picks
//! (typically one a sync client such as Syncthing keeps in step with other
//! devices) instead of in the app's own storage.
//!
//! - [`remote`] — the folder itself: a SAF tree on Android, a plain directory
//!   in the desktop dev loop.
//! - [`sync`] — the private mirror the app works on, and how it stays in step
//!   with the folder.
//! - [`registry`] — which folders are workspaces, persisted in app data.

pub mod registry;
pub mod remote;
pub mod sync;

use tauri::AppHandle;

use remote::RemoteSpec;

/// Show the platform folder picker. On Android the choice is a SAF tree whose
/// permission is persisted, so it stays reachable after a restart. Blocks
/// until the user answers: call from `spawn_blocking`.
pub fn pick_folder(app: &AppHandle) -> Result<Option<RemoteSpec>, String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        let picker = app.android_fs().picker();
        let Some(uri) = picker.pick_dir(None, false).map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        picker
            .persist_uri_permission(&uri)
            .map_err(|e| e.to_string())?;
        Ok(Some(RemoteSpec::Tree { uri }))
    }
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|e| format!("Invalid folder: {e}"))?;
        Ok(Some(RemoteSpec::Path { path }))
    }
}

/// The folder's own name, for a newly registered workspace.
pub fn folder_name(app: &AppHandle, spec: &RemoteSpec) -> String {
    match spec {
        RemoteSpec::Path { path } => path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        RemoteSpec::Tree { uri } => {
            use tauri_plugin_android_fs::AndroidFsExt;
            app.android_fs()
                .get_name(uri)
                .ok()
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| {
                    let label = spec.display();
                    label.rsplit('/').next().unwrap_or(&label).to_string()
                })
        }
    }
}

/// Give up a SAF grant nothing registered still needs. Persisted grants are a
/// limited, per-app resource, so a removed workspace shouldn't keep one.
pub fn release_unused_grant(app: &AppHandle, spec: &RemoteSpec) {
    let Some(key) = spec.grant_key() else {
        return;
    };
    let registry = registry::read(app);
    let still_used = registry
        .folders
        .iter()
        .map(|f| &f.remote)
        .chain(registry.last_parent.iter())
        .any(|other| other.grant_key().as_deref() == Some(key.as_str()));
    if still_used {
        return;
    }
    if let RemoteSpec::Tree { uri } = spec {
        use tauri_plugin_android_fs::AndroidFsExt;
        let _ = app
            .android_fs()
            .picker()
            .release_persisted_uri_permission(uri);
    }
}
