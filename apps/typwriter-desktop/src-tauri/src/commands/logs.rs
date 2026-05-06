use tauri::{AppHandle, Manager};

const LOG_FILE_NAME: &str = "typwriter-desktop.log";

#[tauri::command]
pub fn get_log_file_path(app: AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    Ok(log_dir.join(LOG_FILE_NAME).display().to_string())
}
