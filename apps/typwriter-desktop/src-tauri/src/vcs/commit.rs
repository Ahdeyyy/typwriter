// vcs/commit.rs
//
// Building a tree from the working directory and turning it into a commit.
//
// We do NOT touch the git index. Every commit is built by walking the
// workspace, writing each file as a blob and each directory as a tree
// object, then writing one root tree at the top. This keeps the logic
// straightforward and makes restore semantically simple — there's nothing
// staged-but-uncommitted to worry about.
//
// The cost: external `git status` will see all files as untracked because
// the index never updates. Users who care can run `git reset` once. For an
// internal "save snapshots automatically" feature, that's fine.

use std::{
    fs,
    path::{Path, PathBuf},
};

use gix::{
    objs::{
        tree::{Entry, EntryKind},
        Tree,
    },
    ObjectId,
};
use log::{debug, info};
use serde::{Deserialize, Serialize};

use super::repo::{open_or_init, signature_now, IGNORED_TOP_LEVEL};

/// What caused this commit. Encoded in the commit message so the timeline can
/// distinguish "user said save it" from "auto-snapshot after compile".
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommitTrigger {
    /// First commit when the repo is initialized.
    Initial,
    /// User explicitly created a restore point.
    Manual,
    /// Triggered by saving a file.
    Save,
    /// Triggered by a successful compile.
    Compile,
    /// Snapshot of working state captured before restoring (safety net).
    PreRestore,
}

impl CommitTrigger {
    fn tag(self) -> &'static str {
        match self {
            CommitTrigger::Initial => "initial",
            CommitTrigger::Manual => "manual",
            CommitTrigger::Save => "save",
            CommitTrigger::Compile => "compile",
            CommitTrigger::PreRestore => "pre-restore",
        }
    }

    /// Parse the trigger tag back out of a commit message. We embed it as
    /// `[trigger:<tag>]` in the first line; if absent (e.g. for commits made
    /// by external tools) the variant is `Manual`.
    pub fn parse_from_message(msg: &str) -> Self {
        let first_line = msg.lines().next().unwrap_or("");
        let lower = first_line.to_lowercase();
        // Order matters: `pre-restore` contains `restore` etc.
        if lower.contains("[trigger:initial]") {
            Self::Initial
        } else if lower.contains("[trigger:save]") {
            Self::Save
        } else if lower.contains("[trigger:compile]") {
            Self::Compile
        } else if lower.contains("[trigger:pre-restore]") {
            Self::PreRestore
        } else {
            Self::Manual
        }
    }
}

/// Top-level entry: build a tree from the workspace, compare its id to HEAD's
/// tree, and only commit if they differ. Returns the new commit's hex id on
/// success, or `None` when there was nothing to commit.
pub fn commit_if_changed(
    workspace_root: &Path,
    trigger: CommitTrigger,
    message: &str,
) -> Result<Option<String>, String> {
    let repo = open_or_init(workspace_root)?;

    let new_tree_id = build_tree(&repo, workspace_root, workspace_root)
        .map_err(|e| format!("vcs::commit: build_tree failed: {e}"))?;

    // Look up the parent commit and its tree id. An unborn HEAD means we're
    // about to make the very first commit — no parents, no comparison.
    let parent_id: Option<ObjectId> = repo.head_id().ok().map(|id| id.detach());

    let same_as_parent = match parent_id {
        Some(pid) => commit_tree_id(&repo, pid)
            .ok()
            .map(|tid| tid == new_tree_id)
            .unwrap_or(false),
        None => false,
    };

    if same_as_parent {
        debug!("vcs::commit: working tree matches HEAD, skipping commit");
        return Ok(None);
    }

    let parents: Vec<ObjectId> = parent_id.into_iter().collect();
    let full_message = format!("[trigger:{}] {}", trigger.tag(), message);

    // We construct a Commit object explicitly and write it with the proper
    // author/committer + time. Going through `repo.commit_as` lets us pin
    // identity without depending on user git config.
    let author = signature_now();
    let committer = author.clone();

    let commit = gix::objs::Commit {
        tree: new_tree_id,
        parents: parents.iter().copied().collect(),
        author,
        committer,
        encoding: None,
        message: full_message.into(),
        extra_headers: Vec::new(),
    };
    let commit_id = repo
        .write_object(&commit)
        .map_err(|e| format!("vcs::commit: write_object(commit) failed: {e}"))?
        .detach();

    // Update HEAD (or the branch HEAD points at) to the new commit. We use
    // a direct reference edit to avoid needing the commit/reference API
    // surface that varies between gix versions.
    update_head(&repo, commit_id, &parents)?;

    let hex = commit_id.to_hex().to_string();
    info!(
        "vcs::commit: {} {} -> {}",
        trigger.tag(),
        &hex[..hex.len().min(8)],
        message
    );
    Ok(Some(hex))
}

/// Resolve a commit's tree id. We accept anything that hands us an
/// `ObjectId` — robust against various gix `Id<'_>` types.
fn commit_tree_id(repo: &gix::Repository, commit_id: ObjectId) -> Result<ObjectId, String> {
    let object = repo
        .find_object(commit_id)
        .map_err(|e| format!("find_object(commit) failed: {e}"))?;
    let commit = object
        .try_into_commit()
        .map_err(|e| format!("not a commit: {e}"))?;
    Ok(commit.tree_id().map_err(|e| e.to_string())?.detach())
}

/// Recursively walk `dir` and build a tree object, writing blob and subtree
/// objects into the repo as we go. Returns the resulting tree's id.
///
/// `workspace_root` is the absolute root; only the root level applies the
/// `IGNORED_TOP_LEVEL` filter. Nested directories named `.typwriter` (if any)
/// would be committed — but that's intentional, only the actual workspace
/// metadata directory at the root is special.
fn build_tree(repo: &gix::Repository, workspace_root: &Path, dir: &Path) -> Result<ObjectId, String> {
    let mut entries: Vec<Entry> = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| format!("read_dir {dir:?}: {e}"))?;

    for entry in read.flatten() {
        let name = entry.file_name();
        let name_str = match name.to_str() {
            Some(s) => s.to_string(),
            None => continue, // skip non-UTF-8 names
        };

        // Top-level ignored dirs are tested by path equality against root.
        if dir == workspace_root && IGNORED_TOP_LEVEL.contains(&name_str.as_str()) {
            continue;
        }

        let path: PathBuf = entry.path();
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if file_type.is_dir() {
            let sub_id = build_tree(repo, workspace_root, &path)?;
            // gix represents tree entries via `Entry { mode, filename, oid }`
            // where mode is a packed u16. EntryKind::Tree.into() is the
            // canonical 040000 mode.
            entries.push(Entry {
                mode: EntryKind::Tree.into(),
                filename: name_str.into(),
                oid: sub_id,
            });
        } else if file_type.is_file() {
            let bytes = fs::read(&path).map_err(|e| format!("read file {path:?}: {e}"))?;
            let blob_id = repo
                .write_blob(bytes)
                .map_err(|e| format!("write_blob {path:?}: {e}"))?
                .detach();
            entries.push(Entry {
                mode: EntryKind::Blob.into(),
                filename: name_str.into(),
                oid: blob_id,
            });
        }
        // Symlinks etc. silently dropped — not relevant for our use case.
    }

    // gix requires tree entries in canonical (sorted) order; otherwise the
    // computed id won't match git's expectations and consumer tools break.
    entries.sort_by(|a, b| a.filename.cmp(&b.filename));

    let tree = Tree { entries };
    let tree_id = repo
        .write_object(&tree)
        .map_err(|e| format!("write_object(tree) failed: {e}"))?
        .detach();
    Ok(tree_id)
}

/// Move HEAD to `new_commit`. On the very first commit (no parents), HEAD is
/// typically a symbolic ref to `refs/heads/main` that doesn't exist yet —
/// we create the branch. On subsequent commits we update the branch in place.
fn update_head(
    repo: &gix::Repository,
    new_commit: ObjectId,
    parents: &[ObjectId],
) -> Result<(), String> {
    use gix::refs::transaction::{Change, LogChange, PreviousValue, RefEdit, RefLog};
    use gix::refs::Target;

    // Resolve which ref HEAD points at. For a fresh repo that's the symbolic
    // target (e.g. refs/heads/main); after the first commit it'll exist.
    let head_name: String = match repo.head_name().map_err(|e| e.to_string())? {
        Some(name) => name.as_bstr().to_string(),
        None => "refs/heads/main".to_string(),
    };

    let previous = if parents.is_empty() {
        PreviousValue::MustNotExist
    } else {
        // We don't bother asserting the exact previous value — autocommit
        // racing itself isn't a real risk in this app (single worker).
        PreviousValue::Any
    };

    let log_message = format!("commit: {new_commit}");
    let edit = RefEdit {
        change: Change::Update {
            log: LogChange {
                mode: RefLog::AndReference,
                force_create_reflog: false,
                message: log_message.into(),
            },
            expected: previous,
            new: Target::Object(new_commit),
        },
        name: head_name
            .as_str()
            .try_into()
            .map_err(|e| format!("invalid ref name {head_name:?}: {e}"))?,
        deref: false,
    };

    repo.edit_reference(edit)
        .map_err(|e| format!("edit_reference failed: {e}"))?;
    Ok(())
}
