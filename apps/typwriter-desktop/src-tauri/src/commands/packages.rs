// Surfacing the Typst Universe package index.
//
// The index is already fetched and cached for autocomplete
// (`EditorWorld::packages`); this exposes the same data to the frontend so it
// can be browsed and imported rather than only completed against. Nothing here
// downloads anything the editor was not already going to download.

use std::{collections::HashMap, sync::Arc, time::Instant};

use log::info;
use serde::Serialize;
use tauri::State;
use typst_ide::IdeWorld;

use crate::world::EditorWorld;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageEntry {
    /// Registry namespace — `preview` for everything on Universe today.
    pub namespace: String,
    pub name: String,
    /// Newest version, as `major.minor.patch`.
    pub version: String,
    /// Every version the registry lists, newest first.
    pub versions: Vec<String>,
    pub description: Option<String>,
}

/// List the packages in the registry index, one entry per package.
///
/// The raw index carries one row per *version*; a browser wants one row per
/// package with the newest version selected, so versions are folded together
/// here rather than in the UI.
///
/// Returns an empty list when the index could not be fetched (offline, first
/// run). That is deliberately not an error: the browser shows an empty state,
/// and the editor keeps working.
#[tauri::command(async)]
pub fn list_packages(world: State<'_, Arc<EditorWorld>>) -> Vec<PackageEntry> {
    let t = Instant::now();

    // One bucket per (namespace, name), collecting every version seen.
    let mut buckets: HashMap<(String, String), Vec<(typst::syntax::package::PackageVersion, Option<String>)>> =
        HashMap::new();

    for (spec, description) in world.packages() {
        buckets
            .entry((spec.namespace.to_string(), spec.name.to_string()))
            .or_default()
            .push((spec.version, description.as_ref().map(|d| d.to_string())));
    }

    let mut entries: Vec<PackageEntry> = buckets
        .into_iter()
        .map(|((namespace, name), mut versions)| {
            // Newest first, so `versions[0]` is the one to import by default.
            versions.sort_by(|a, b| b.0.cmp(&a.0));
            // Take the description from the newest version that has one: older
            // entries are sometimes missing it, and a blank row is worse than a
            // slightly stale summary.
            let description = versions.iter().find_map(|(_, d)| d.clone());
            PackageEntry {
                namespace,
                name,
                version: versions[0].0.to_string(),
                versions: versions.iter().map(|(v, _)| v.to_string()).collect(),
                description,
            }
        })
        .collect();

    entries.sort_by(|a, b| a.name.cmp(&b.name));

    info!(
        "list_packages: {} packages ({:.1}ms)",
        entries.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    entries
}
