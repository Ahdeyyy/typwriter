use std::sync::{atomic::Ordering, Arc};

use tauri::State;

use crate::AppInit;

#[tauri::command]
pub fn is_fonts_loaded(init: State<'_, Arc<AppInit>>) -> bool {
    init.fonts_loaded.load(Ordering::Acquire)
}
