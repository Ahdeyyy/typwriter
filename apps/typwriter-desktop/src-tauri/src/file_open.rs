//! File-manager launches are queued until the main webview is ready.

use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
};

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct OpenRequests(Mutex<VecDeque<String>>);

/// Convert file URLs and ordinary CLI paths without interpreting paths as code.
pub fn paths_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    let mut literal = false;
    args.into_iter()
        .skip(1)
        .filter_map(|arg| {
            if !literal && arg == "--" {
                literal = true;
                return None;
            }
            if !literal && arg.starts_with('-') {
                return None;
            }
            let path = if arg.starts_with("file:") {
                url::Url::parse(&arg).ok()?.to_file_path().ok()?
            } else {
                if arg.contains("://") {
                    return None;
                }
                let path = PathBuf::from(arg);
                if path.is_absolute() {
                    path
                } else {
                    cwd.join(path)
                }
            };
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("typ"))
                .then_some(path)
        })
        .collect()
}

pub fn enqueue(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let requests = app.state::<OpenRequests>();
    {
        let mut pending = requests.0.lock();
        for path in paths {
            let path = dunce::canonicalize(&path)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            if !pending.iter().any(|p| same_path(p, &path)) {
                pending.push_back(path);
            }
        }
    }
    // The event is just a wakeup. The queue is authoritative, so startup and
    // listen/drain races cannot drop the document the OS asked us to open.
    let _ = app.emit_to("main", "app:open-files", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn same_path(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    {
        a.eq_ignore_ascii_case(b)
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

#[tauri::command]
pub fn take_open_requests(requests: State<'_, OpenRequests>) -> Vec<String> {
    requests.0.lock().drain(..).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_multiple_paths_spaces_unicode_and_file_urls() {
        let cwd = std::env::temp_dir();
        let absolute = cwd.join("hello world ü.typ");
        let url = url::Url::from_file_path(&absolute).unwrap().to_string();
        let paths = paths_from_args(
            vec![
                "typwriter".into(),
                "notes.typ".into(),
                url,
                "UPPER.TYP".into(),
            ],
            &cwd,
        );
        assert_eq!(
            paths,
            vec![cwd.join("notes.typ"), absolute, cwd.join("UPPER.TYP")]
        );
    }

    #[test]
    fn ignores_flags_non_typ_files_and_other_protocols() {
        let paths = paths_from_args(
            vec![
                "app".into(),
                "--help".into(),
                "data.pdf".into(),
                "https://example.com/x.typ".into(),
                "--".into(),
                "-notes.typ".into(),
            ],
            &std::env::temp_dir(),
        );
        assert_eq!(paths, vec![std::env::temp_dir().join("-notes.typ")]);
    }
}
