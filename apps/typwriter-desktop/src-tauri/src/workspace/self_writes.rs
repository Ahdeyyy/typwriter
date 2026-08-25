// Records writes the editor itself made, so the filesystem watcher can tell
// them apart from changes made by an external tool.
//
// Without this, every save round-trips through the watcher: it invalidates the
// world's cache for the file we just wrote (throwing away the parse tree
// `shadow_commit` deliberately kept), emits `workspace:files-changed`, which
// makes the frontend re-walk the entire workspace and rebuild its whole
// reactive file tree, and requests a `Watcher` compile on top of the `Save`
// compile the write already scheduled. None of that is useful for a write we
// performed ourselves — saving a file cannot change the shape of the tree.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use parking_lot::Mutex;

/// How long a recorded write stays claimable.
///
/// Long enough to cover the watcher's own 100 ms debounce plus the several
/// events one save typically produces (create, data, metadata), short enough
/// that an external change to the same file moments later is still noticed.
const SELF_WRITE_TTL: Duration = Duration::from_millis(2_000);

#[derive(Default)]
pub struct SelfWriteLog {
    entries: Mutex<HashMap<PathBuf, Instant>>,
}

impl SelfWriteLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that the editor just wrote `path`.
    pub fn note(&self, path: &Path) {
        let key = normalize(path);
        let now = Instant::now();
        let mut entries = self.entries.lock();
        entries.insert(key, now);
        prune(&mut entries, now);
    }

    /// Whether `path` was written by the editor recently enough to ignore.
    ///
    /// Deliberately does *not* consume the record: one save produces several
    /// filesystem events, and consuming on the first would let the rest through
    /// and trigger exactly the refresh this exists to avoid. The TTL is what
    /// retires the record.
    pub fn is_recent(&self, path: &Path) -> bool {
        let key = normalize(path);
        let now = Instant::now();
        let mut entries = self.entries.lock();
        prune(&mut entries, now);
        entries.contains_key(&key)
    }
}

fn prune(entries: &mut HashMap<PathBuf, Instant>, now: Instant) {
    entries.retain(|_, noted| now.duration_since(*noted) < SELF_WRITE_TTL);
}

/// Put a path into a form both sides can agree on.
///
/// The watcher's paths come from `notify` while the recorded ones come from the
/// frontend, and on Windows the two can differ in case and in whether they
/// carry the `\\?\` verbatim prefix. `canonicalize` resolves both to the same
/// verbatim form. It fails for a path that no longer exists (a delete, or the
/// temp file behind an atomic save), in which case the raw path is the best key
/// available — and a mismatch there only costs an unnecessary refresh, never a
/// missed one.
fn normalize(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::{normalize, prune, SelfWriteLog, SELF_WRITE_TTL};
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    #[test]
    fn a_noted_path_is_recent() {
        let log = SelfWriteLog::new();
        let path = Path::new("main.typ");
        assert!(!log.is_recent(path));
        log.note(path);
        assert!(log.is_recent(path));
    }

    #[test]
    fn an_unrelated_path_is_not_recent() {
        // The whole point: an external tool touching a *different* file must
        // still reach the watcher.
        let log = SelfWriteLog::new();
        log.note(Path::new("main.typ"));
        assert!(!log.is_recent(Path::new("other.typ")));
    }

    #[test]
    fn repeated_checks_keep_matching() {
        // One save fans out into several filesystem events; every one of them
        // must be suppressed, not just the first.
        let log = SelfWriteLog::new();
        let path = Path::new("main.typ");
        log.note(path);
        for _ in 0..5 {
            assert!(log.is_recent(path), "record must not be consumed on first claim");
        }
    }

    #[test]
    fn records_expire_so_external_edits_are_noticed_again() {
        // Guards the failure mode that would matter most: a record that never
        // expires would make the app permanently blind to outside changes.
        let mut entries: HashMap<PathBuf, Instant> = HashMap::new();
        let now = Instant::now();
        let stale = now - SELF_WRITE_TTL - Duration::from_millis(1);
        entries.insert(PathBuf::from("old.typ"), stale);
        entries.insert(PathBuf::from("fresh.typ"), now);

        prune(&mut entries, now);

        assert!(!entries.contains_key(Path::new("old.typ")));
        assert!(entries.contains_key(Path::new("fresh.typ")));
    }

    #[test]
    fn normalize_agrees_for_a_path_that_exists() {
        // Both sides normalize the same way, so a real file recorded by the
        // save path matches the same file reported by the watcher.
        let dir = std::env::temp_dir();
        let file = dir.join("typwriter-self-write-normalize.typ");
        std::fs::write(&file, "= x\n").expect("write temp file");

        let via_relative = normalize(&file);
        let via_dotted = normalize(&dir.join(".").join("typwriter-self-write-normalize.typ"));
        assert_eq!(via_relative, via_dotted);

        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn normalize_falls_back_for_a_missing_path() {
        // A deleted file cannot be canonicalized; the raw path is still a
        // usable key and must not panic.
        let missing = Path::new("does-not-exist-anywhere-12345.typ");
        assert_eq!(normalize(missing), PathBuf::from(missing));
    }
}
