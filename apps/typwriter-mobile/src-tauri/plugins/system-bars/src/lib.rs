//! Status-bar visibility, bar icon style and window insets for the Android
//! app's edge-to-edge, immersive chrome. Every command is a no-op (insets read
//! zero) off Android, so the desktop dev window keeps working.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// System-bar and display-cutout insets, in CSS px.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct Insets {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

#[cfg(target_os = "android")]
struct Handle<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
async fn run<R: Runtime, T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle<R>,
    method: &str,
    payload: serde_json::Value,
) -> Result<T, String> {
    use tauri::Manager;
    let handle = app.state::<Handle<R>>();
    handle
        .0
        .run_mobile_plugin_async(method, payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_status_bar_hidden<R: Runtime>(
    app: tauri::AppHandle<R>,
    hidden: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    run::<R, serde_json::Value>(&app, "setStatusBarHidden", serde_json::json!({ "hidden": hidden }))
        .await?;
    #[cfg(not(target_os = "android"))]
    let _ = (app, hidden);
    Ok(())
}

#[tauri::command]
async fn set_style<R: Runtime>(app: tauri::AppHandle<R>, dark: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    run::<R, serde_json::Value>(&app, "setStyle", serde_json::json!({ "dark": dark })).await?;
    #[cfg(not(target_os = "android"))]
    let _ = (app, dark);
    Ok(())
}

#[tauri::command]
async fn get_insets<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Insets, String> {
    #[cfg(target_os = "android")]
    return run(&app, "getInsets", serde_json::Value::Null).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(Insets::default())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("system-bars")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle =
                    _api.register_android_plugin("com.typwriter.systembars", "SystemBarsPlugin")?;
                _app.manage(Handle(handle));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_status_bar_hidden,
            set_style,
            get_insets
        ])
        .build()
}
