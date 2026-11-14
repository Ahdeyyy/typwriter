use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use typst_kit::downloader::{Progress, ProgressReporter};

/// Serializable payload sent with progress and finish events.
#[derive(Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub total_bytes: Option<usize>,
    pub downloaded_bytes: usize,
    pub bytes_per_second: usize,
}

/// Computes a bytes-per-second estimate from a download [`Progress`] snapshot,
/// mirroring the moving-average that typst-kit's own `Display` impl uses.
fn bytes_per_second(progress: &Progress) -> usize {
    let len = progress.samples.len();
    let sum: usize = progress.samples.iter().sum();
    let bytes_per_period = sum.checked_div(len).or(progress.content_len).unwrap_or(0);
    let frequency: usize = Duration::from_secs(1)
        .as_nanos()
        .checked_div(progress.period.as_nanos())
        .and_then(|s| usize::try_from(s).ok())
        .unwrap_or(1);
    bytes_per_period * frequency
}

/// A [`ProgressReporter`] implementation that forwards package download events
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
    started: Option<Instant>,
}

impl TauriProgress {
    pub fn new(app_handle: AppHandle, package_label: impl Into<String>) -> Self {
        Self {
            app_handle,
            package_label: package_label.into(),
            started: None,
        }
    }
}

impl ProgressReporter for TauriProgress {
    fn start(&mut self, _progress: &Progress) {
        // Logged because a download happens *inside* a compile: without these
        // two lines a slow fetch is indistinguishable from a slow compile.
        self.started = Some(Instant::now());
        log::info!("package download: {} started", self.package_label);
        let _ = self
            .app_handle
            .emit("package:download:start", &self.package_label);
    }

    fn update(&mut self, progress: &Progress) {
        let _ = self.app_handle.emit(
            "package:download:progress",
            DownloadProgressPayload {
                total_bytes: progress.content_len,
                downloaded_bytes: progress.downloaded,
                bytes_per_second: bytes_per_second(progress),
            },
        );
    }

    fn finish(&mut self, progress: &Progress) {
        log::info!(
            "package download: {} finished, {} bytes ({:.1}ms)",
            self.package_label,
            progress.downloaded,
            self.started
                .map(|t| t.elapsed().as_secs_f64() * 1000.0)
                .unwrap_or(0.0)
        );
        let _ = self.app_handle.emit(
            "package:download:finish",
            DownloadProgressPayload {
                total_bytes: progress.content_len,
                downloaded_bytes: progress.downloaded,
                bytes_per_second: 0,
            },
        );
    }
}
