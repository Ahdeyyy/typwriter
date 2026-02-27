use serde::Serialize;
use tauri::{AppHandle, Emitter};
use typst_kit::download::{DownloadState, Progress};

/// Serializable payload sent with progress and finish events.
#[derive(Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub total_bytes: Option<usize>,
    pub downloaded_bytes: usize,
    pub bytes_per_second: usize,
}

/// A [`Progress`] implementation that forwards package download events
/// to the Tauri frontend via `AppHandle::emit`.
///
/// Three events are emitted:
/// - `"package:download:start"` — payload: package label string
/// - `"package:download:progress"` — payload: [`DownloadProgressPayload`]
/// - `"package:download:finish"` — payload: [`DownloadProgressPayload`]
pub struct TauriProgress {
    app_handle: AppHandle,
    /// Human-readable package label, e.g. `"@preview/cetz:0.3.5"`.
    package_label: String,
}

impl TauriProgress {
    pub fn new(app_handle: AppHandle, package_label: impl Into<String>) -> Self {
        Self {
            app_handle,
            package_label: package_label.into(),
        }
    }
}

impl Progress for TauriProgress {
    fn print_start(&mut self) {
        let _ = self
            .app_handle
            .emit("package:download:start", &self.package_label);
    }

    fn print_progress(&mut self, state: &DownloadState) {
        let bps =
            state.bytes_per_second.iter().sum::<usize>() / state.bytes_per_second.len().max(1);
        let _ = self.app_handle.emit(
            "package:download:progress",
            DownloadProgressPayload {
                total_bytes: state.content_len,
                downloaded_bytes: state.total_downloaded,
                bytes_per_second: bps,
            },
        );
    }

    fn print_finish(&mut self, state: &DownloadState) {
        let _ = self.app_handle.emit(
            "package:download:finish",
            DownloadProgressPayload {
                total_bytes: state.content_len,
                downloaded_bytes: state.total_downloaded,
                bytes_per_second: 0,
            },
        );
    }
}
