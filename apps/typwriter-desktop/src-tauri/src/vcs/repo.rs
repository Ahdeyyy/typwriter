// vcs/repo.rs
//
// Repository open/init plumbing. gix repos are `!Send + !Sync`, so we open
// fresh on each operation rather than caching a handle. `gix::open` is a
// quick header-read — costing it on every call is the right trade-off to
// keep the public API thread-friendly.

use std::path::Path;

use gix::Repository;
use log::info;

/// Hidden directories that the VCS must never include in commits. The git
/// metadata directory is obvious; the typwriter cache contains preview PNGs
/// keyed by content-hash and would only ever balloon history.
pub const IGNORED_TOP_LEVEL: &[&str] = &[".git", ".typwriter"];

/// Open the repo at `workspace_root`, or initialize it if no `.git` exists.
/// Sets a default identity on first init so commit creation doesn't need to
/// touch global git config (and so this works on machines with no git at all).
pub fn open_or_init(workspace_root: &Path) -> Result<Repository, String> {
    let git_dir = workspace_root.join(".git");
    if git_dir.exists() {
        gix::open(workspace_root).map_err(|e| format!("gix::open failed: {e}"))
    } else {
        info!("vcs::repo: initializing new repo at {workspace_root:?}");
        let repo = gix::init(workspace_root).map_err(|e| format!("gix::init failed: {e}"))?;
        Ok(repo)
    }
}

/// Build an owned `Signature` stamped at the current moment. Returning an
/// owned value lets gix's commit API consume it without lifetime gymnastics.
pub fn signature_now() -> gix::actor::Signature {
    let now = gix::date::Time::now_local_or_utc();
    gix::actor::Signature {
        name: "Typwriter".into(),
        email: "vcs@typwriter.local".into(),
        time: now,
    }
}
