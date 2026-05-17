use std::path::{Path, PathBuf};

use super::error::WorkspaceError;

#[derive(Clone, Debug)]
pub struct WorkspacePath {
    abs: PathBuf,
}

impl WorkspacePath {
    pub fn resolve(root: &Path, rel_path: &str) -> Result<Self, WorkspaceError> {
        let path = PathBuf::from(rel_path);
        if path.is_absolute() {
            return Err(WorkspaceError::ExpectedRelativePath { path });
        }

        let candidate = root.join(path);
        ensure_inside_root(root, &candidate)?;
        Ok(Self { abs: candidate })
    }

    pub fn from_absolute_inside(root: &Path, abs_path: PathBuf) -> Result<Self, WorkspaceError> {
        if !abs_path.is_absolute() {
            return Err(WorkspaceError::ExpectedAbsoluteWorkspacePath { path: abs_path });
        }
        ensure_inside_root(root, &abs_path)?;
        Ok(Self { abs: abs_path })
    }

    pub fn into_path_buf(self) -> PathBuf {
        self.abs
    }
}

#[derive(Clone, Debug)]
pub struct ExternalPath {
    abs: PathBuf,
}

impl ExternalPath {
    pub fn new(path: &str) -> Result<Self, WorkspaceError> {
        let abs = PathBuf::from(path);
        if !abs.is_absolute() {
            return Err(WorkspaceError::ExpectedAbsoluteExternalPath { path: abs });
        }
        Ok(Self { abs })
    }

    pub fn as_path(&self) -> &Path {
        &self.abs
    }
}

fn ensure_inside_root(root: &Path, candidate: &Path) -> Result<(), WorkspaceError> {
    let root = root
        .canonicalize()
        .map_err(|source| WorkspaceError::WorkspaceRootResolve { source })?;
    let check_path = canonicalize_existing_ancestor(candidate)?;

    if check_path.starts_with(&root) {
        Ok(())
    } else {
        Err(WorkspaceError::PathOutsideWorkspace {
            path: candidate.to_path_buf(),
            root,
        })
    }
}

fn canonicalize_existing_ancestor(candidate: &Path) -> Result<PathBuf, WorkspaceError> {
    if candidate.exists() {
        return candidate
            .canonicalize()
            .map_err(|source| WorkspaceError::PathResolve {
                path: candidate.to_path_buf(),
                source,
            });
    }

    let mut missing = Vec::new();
    let mut ancestor = candidate;
    while !ancestor.exists() {
        let name = ancestor
            .file_name()
            .ok_or_else(|| WorkspaceError::NoExistingParent {
                path: candidate.to_path_buf(),
            })?;
        missing.push(name.to_owned());
        ancestor = ancestor
            .parent()
            .ok_or_else(|| WorkspaceError::NoExistingParent {
                path: candidate.to_path_buf(),
            })?;
    }

    let mut resolved = ancestor
        .canonicalize()
        .map_err(|source| WorkspaceError::PathResolve {
            path: ancestor.to_path_buf(),
            source,
        })?;
    for name in missing.iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}
