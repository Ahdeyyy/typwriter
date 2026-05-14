use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("{path} must be workspace-relative")]
    ExpectedRelativePath { path: PathBuf },

    #[error("{path} must be an absolute external path")]
    ExpectedAbsoluteExternalPath { path: PathBuf },

    #[error("{path} must be absolute")]
    ExpectedAbsoluteWorkspacePath { path: PathBuf },

    #[error("Failed to resolve workspace root: {source}")]
    WorkspaceRootResolve {
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to resolve {path}: {source}")]
    PathResolve {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("{path} has no existing parent directory")]
    NoExistingParent { path: PathBuf },

    #[error("{path} is outside the workspace root {root}")]
    PathOutsideWorkspace { path: PathBuf, root: PathBuf },
}
