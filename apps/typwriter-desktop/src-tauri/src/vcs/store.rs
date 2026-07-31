// Low-level read/write for the snapshot store. Everything goes through
// `WorkingTreeFs`. Snapshots and objects share a single trait surface and
// never touch the filesystem directly.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::commit::CommitTrigger;
use super::fs::WorkingTreeFs;
use super::paths::{
    head_file, object_path, objects_dir, snapshot_filename, snapshots_dir,
};

/// On-disk manifest. Lives at `snapshots/<ts>_<id8>.json`. The `files` map is
/// the entire workspace tree at the moment of the snapshot, flattened to
/// path → blob-hash. Flat-map (vs. nested trees) makes diff a single pass and
/// keeps a snapshot to one small JSON write — friendlier than gix's
/// many-tiny-object pattern.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct SnapshotManifest {
    /// Schema marker. Bump if the layout ever changes.
    pub version: u32,
    /// SHA-256 of the canonical payload (parent, time, trigger, message,
    /// sorted files). Stable across writes — equal manifests produce equal
    /// ids, which is what lets `commit_if_changed` short-circuit no-ops.
    pub id: String,
    /// Hex id of the parent snapshot, or `None` on the first ever snapshot.
    pub parent: Option<String>,
    /// Unix milliseconds. Stored as ms so multiple snapshots in the same
    /// second still sort deterministically by filename.
    pub created_at_ms: i64,
    pub trigger: CommitTrigger,
    pub message: String,
    /// Workspace-relative path (forward slashes) → blob hash.
    pub files: BTreeMap<String, String>,
}

/// Build the canonical byte representation that the id is computed from.
/// Keep this stable: changing it will silently break `commit_if_changed`'s
/// dedupe (every commit would look "new") on existing workspaces.
fn canonical_bytes(
    parent: Option<&str>,
    created_at_ms: i64,
    trigger: CommitTrigger,
    message: &str,
    files: &BTreeMap<String, String>,
) -> Vec<u8> {
    let mut out = String::new();
    out.push_str("v1\n");
    out.push_str("parent:");
    out.push_str(parent.unwrap_or(""));
    out.push('\n');
    out.push_str(&format!("createdAtMs:{created_at_ms}\n"));
    out.push_str(&format!("trigger:{}\n", trigger.tag()));
    out.push_str("message:");
    out.push_str(message);
    out.push('\n');
    out.push_str("files:\n");
    for (path, hash) in files {
        out.push_str(path);
        out.push('\t');
        out.push_str(hash);
        out.push('\n');
    }
    out.into_bytes()
}

pub fn build_manifest(
    parent: Option<String>,
    created_at_ms: i64,
    trigger: CommitTrigger,
    message: &str,
    files: BTreeMap<String, String>,
) -> SnapshotManifest {
    let id = hex_sha256(&canonical_bytes(
        parent.as_deref(),
        created_at_ms,
        trigger,
        message,
        &files,
    ));
    SnapshotManifest {
        version: 1,
        id,
        parent,
        created_at_ms,
        trigger,
        message: message.to_string(),
        files,
    }
}

// ─── HEAD ────────────────────────────────────────────────────────────────────

pub fn read_head(fs: &impl WorkingTreeFs, root: &Path) -> Result<Option<String>, String> {
    let path = head_file(root);
    if !fs.exists(&path) {
        return Ok(None);
    }
    let bytes = fs.read_file(&path)?;
    let s = String::from_utf8(bytes).map_err(|e| format!("HEAD invalid utf8: {e}"))?;
    let trimmed = s.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_string()))
    }
}

pub fn write_head(fs: &impl WorkingTreeFs, root: &Path, id: &str) -> Result<(), String> {
    let path = head_file(root);
    if let Some(parent) = path.parent() {
        fs.create_dir_all(parent)?;
    }
    fs.write_file(&path, id.as_bytes())
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

pub fn write_snapshot(
    fs: &impl WorkingTreeFs,
    root: &Path,
    manifest: &SnapshotManifest,
) -> Result<(), String> {
    let dir = snapshots_dir(root);
    fs.create_dir_all(&dir)?;
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("serialize snapshot {}: {e}", manifest.id))?;
    let target = dir.join(snapshot_filename(manifest.created_at_ms, &manifest.id));
    fs.write_file(&target, &bytes)
}

/// Returns `(path, manifest)` pairs for every snapshot on disk. Sorted by
/// filename, which (thanks to the timestamp prefix) is also chronological
/// order — oldest first.
pub fn read_all_snapshots(
    fs: &impl WorkingTreeFs,
    root: &Path,
) -> Result<Vec<(std::path::PathBuf, SnapshotManifest)>, String> {
    let dir = snapshots_dir(root);
    if !fs.exists(&dir) {
        return Ok(Vec::new());
    }
    let mut entries = fs.read_dir(&dir)?;
    entries.retain(|e| e.is_file && e.name.ends_with(".json"));
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let bytes = fs.read_file(&entry.path)?;
        let manifest: SnapshotManifest = serde_json::from_slice(&bytes)
            .map_err(|e| format!("parse snapshot {:?}: {e}", entry.path))?;
        out.push((entry.path, manifest));
    }
    Ok(out)
}

pub fn find_snapshot_by_id(
    fs: &impl WorkingTreeFs,
    root: &Path,
    id: &str,
) -> Result<SnapshotManifest, String> {
    for (_, manifest) in read_all_snapshots(fs, root)? {
        if manifest.id == id {
            return Ok(manifest);
        }
    }
    Err(format!("snapshot {id} not found"))
}

pub fn delete_snapshot_file(
    fs: &impl WorkingTreeFs,
    path: &Path,
) -> Result<(), String> {
    fs.remove_file(path)
}

// ─── Objects (content-addressed blobs) ───────────────────────────────────────

const ZSTD_LEVEL: i32 = 3;

/// Hash the raw bytes and write the zstd-compressed blob if it isn't already
/// in the object store. Returns the hex sha-256 of the *uncompressed* bytes.
///
/// Skipping on `exists()` is the per-snapshot dedupe: one filesystem write
/// per never-before-seen file content, regardless of how many snapshots
/// reference it.
pub fn write_blob_if_missing(
    fs: &impl WorkingTreeFs,
    root: &Path,
    bytes: &[u8],
) -> Result<String, String> {
    let hash = hex_sha256(bytes);
    let path = object_path(root, &hash);
    if fs.exists(&path) {
        return Ok(hash);
    }
    if let Some(parent) = path.parent() {
        fs.create_dir_all(parent)?;
    }
    let compressed = zstd::encode_all(bytes, ZSTD_LEVEL)
        .map_err(|e| format!("zstd compress object {hash}: {e}"))?;
    fs.write_file(&path, &compressed)?;
    Ok(hash)
}

pub fn read_blob(
    fs: &impl WorkingTreeFs,
    root: &Path,
    hash: &str,
) -> Result<Vec<u8>, String> {
    let path = object_path(root, hash);
    let compressed = fs.read_file(&path)?;
    let mut decoder = zstd::Decoder::new(&compressed[..])
        .map_err(|e| format!("zstd decoder for object {hash}: {e}"))?;
    let mut out = Vec::with_capacity(compressed.len());
    decoder
        .read_to_end(&mut out)
        .map_err(|e| format!("zstd decompress object {hash}: {e}"))?;
    Ok(out)
}

/// Delete every object file whose hash isn't in `keep`. Best-effort: failures
/// on individual files are logged but never abort the sweep, since orphans
/// only waste space — they don't break correctness.
pub fn sweep_unreferenced_objects(
    fs: &impl WorkingTreeFs,
    root: &Path,
    keep: &std::collections::HashSet<String>,
) -> Result<usize, String> {
    let dir = objects_dir(root);
    if !fs.exists(&dir) {
        return Ok(0);
    }
    let prefix_dirs = fs.read_dir(&dir)?;
    let mut removed = 0usize;
    for prefix in prefix_dirs {
        if !prefix.is_dir {
            continue;
        }
        let files = match fs.read_dir(&prefix.path) {
            Ok(f) => f,
            Err(err) => {
                log::warn!("vcs::sweep: read_dir {:?} failed: {err}", prefix.path);
                continue;
            }
        };
        for file in files {
            if !file.is_file {
                continue;
            }
            let hash = format!("{}{}", prefix.name, file.name);
            if keep.contains(&hash) {
                continue;
            }
            if let Err(err) = fs.remove_file(&file.path) {
                log::warn!("vcs::sweep: remove {:?} failed: {err}", file.path);
                continue;
            }
            removed += 1;
        }
    }
    Ok(removed)
}

// ─── Hashing ────────────────────────────────────────────────────────────────

pub fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
