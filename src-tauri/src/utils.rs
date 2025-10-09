use chrono::{Datelike, Timelike};
use std::path::PathBuf;
use typst::foundations::Datetime;

pub fn pixel_to_point(x: f64, scale: f32) -> f64 {
    // Convert image pixels back to document points
    // Since we render at scale factor, we need to divide by scale to get document coordinates
    x / scale as f64
}

pub fn byte_position_to_char_position(text: &str, byte_position: usize) -> usize {
    text.char_indices()
        .take_while(|(byte_idx, _)| *byte_idx < byte_position)
        .count()
}

pub fn char_to_byte_position(text: &str, char_position: usize) -> usize {
    text.char_indices()
        .nth(char_position)
        .map_or(text.len(), |(byte_idx, _)| byte_idx)
}

/// Returns all files in the workspace directory.
/// This includes all files in the root directory and its subdirectories.
pub fn get_all_files_in_path(root: &PathBuf) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if root.is_dir() {
        for entry in std::fs::read_dir(root).unwrap() {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    files.extend(get_all_files_in_path(&path));
                } else {
                    files.push(path);
                }
            }
        }
    } else if root.is_file() {
        files.push(root.clone());
    }
    files
}
/// Convert [`chrono::DateTime`] to [`Datetime`]
/// gotten from typst cli source code
pub fn convert_datetime<Tz: chrono::TimeZone>(date_time: chrono::DateTime<Tz>) -> Option<Datetime> {
    Datetime::from_ymd_hms(
        date_time.year(),
        date_time.month().try_into().ok()?,
        date_time.day().try_into().ok()?,
        date_time.hour().try_into().ok()?,
        date_time.minute().try_into().ok()?,
        date_time.second().try_into().ok()?,
    )
}
