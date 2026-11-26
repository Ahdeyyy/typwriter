// App-level metadata commands (nothing workspace- or document-specific).

use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use typst_kit::downloader::{Downloader, SystemDownloader};

/// The version of the Typst compiler this build links against.
///
/// Read from the compiler itself — the same value documents see as
/// `sys.version` — rather than hardcoded on either side, so bumping the `typst`
/// dependency updates the settings sheet with no other edit.
#[tauri::command]
pub async fn get_typst_version() -> String {
    typst::utils::version().raw().to_string()
}

// Each track publishes an `android.json` next to its APK (see
// .github/scripts/release.cjs). The nightly app is the one whose identifier ends
// in `.nightly` (src-tauri/tauri.nightly.conf.json), so the track can't drift
// from the build.
const STABLE_MANIFEST: &str =
    "https://github.com/Ahdeyyy/typwriter/releases/latest/download/android.json";
const NIGHTLY_MANIFEST: &str =
    "https://github.com/Ahdeyyy/typwriter/releases/download/nightly/android.json";

#[derive(Deserialize)]
struct UpdateManifest {
    version: String,
    url: String,
    #[serde(default)]
    notes: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// The APK download. Android installs it over this app only when it is
    /// signed with the same key, so the URL needs no further verification.
    pub url: String,
    pub notes: String,
}

/// Looks for a newer build on this app's release track. `None` means up to
/// date. Installing is left to the user: the frontend opens `url` in the
/// browser, and the system installer takes it from there.
#[tauri::command]
pub async fn check_for_update<R: Runtime>(app: AppHandle<R>) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    let manifest_url = if app.config().identifier.ends_with(".nightly") {
        NIGHTLY_MANIFEST
    } else {
        STABLE_MANIFEST
    };
    let body = tauri::async_runtime::spawn_blocking(move || {
        SystemDownloader::new("typwriter-mobile").download(&(), manifest_url)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("couldn't reach the update server: {e}"))?;
    let manifest: UpdateManifest =
        serde_json::from_slice(&body).map_err(|e| format!("invalid update manifest: {e}"))?;
    newer_than(&current, manifest)
}

fn newer_than(current: &str, manifest: UpdateManifest) -> Result<Option<UpdateInfo>, String> {
    let current = Version::parse(current).map_err(|e| format!("invalid app version: {e}"))?;
    let latest = Version::parse(&manifest.version)
        .map_err(|e| format!("invalid update version {:?}: {e}", manifest.version))?;
    if !manifest.url.starts_with("https://") {
        return Err(format!("refusing a non-HTTPS update URL: {}", manifest.url));
    }
    Ok((latest > current).then(|| UpdateInfo {
        version: manifest.version,
        url: manifest.url,
        notes: manifest.notes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(version: &str) -> UpdateManifest {
        UpdateManifest {
            version: version.into(),
            url: "https://github.com/x/y/releases/download/t/app.apk".into(),
            notes: String::new(),
        }
    }

    #[test]
    fn offers_only_newer_builds_on_either_track() {
        assert!(newer_than("0.9.3", manifest("0.9.4")).unwrap().is_some());
        assert!(newer_than("0.9.4", manifest("0.9.4")).unwrap().is_none());
        assert!(newer_than("0.9.4", manifest("0.9.3")).unwrap().is_none());
        // Nightly run numbers compare numerically, not as text.
        let nightly = newer_than("0.9.4-nightly.9", manifest("0.9.4-nightly.12")).unwrap();
        assert_eq!(nightly.unwrap().version, "0.9.4-nightly.12");
        assert!(newer_than("0.9.4-nightly.12", manifest("0.9.4-nightly.9")).unwrap().is_none());
        // A nightly after a stable bump moves to the next patch.
        assert!(newer_than("0.9.4-nightly.12", manifest("0.9.5-nightly.13")).unwrap().is_some());
    }

    #[test]
    fn rejects_malformed_manifests() {
        assert!(newer_than("0.9.3", manifest("latest")).is_err());
        let mut insecure = manifest("0.9.4");
        insecure.url = "http://example.com/app.apk".into();
        assert!(newer_than("0.9.3", insecure).is_err());
    }
}
