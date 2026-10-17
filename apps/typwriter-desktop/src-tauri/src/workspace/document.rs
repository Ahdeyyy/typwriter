//! Standalone documents keep their source tree in place and use app-private state.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// The paths the editor needs to open a standalone document session.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSession {
    pub path: String,
    pub root: String,
    pub main_file: String,
    pub session_key: String,
}

/// Validate before replacing an existing session. Canonical paths also deduplicate
/// relative paths and symlinks delivered by different file managers.
pub fn resolve_document(path: &Path, root: Option<&Path>) -> Result<(PathBuf, PathBuf), String> {
    let path =
        dunce::canonicalize(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("typ"))
    {
        return Err("Choose a .typ document".into());
    }
    // Check readability/UTF-8 before touching the old world or its buffers.
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let root = root.unwrap_or_else(|| path.parent().expect("an absolute file has a parent"));
    let root =
        dunce::canonicalize(root).map_err(|e| format!("Cannot open compilation root: {e}"))?;
    if !root.is_dir() || !path.starts_with(&root) {
        return Err("The compilation root must be a folder containing the document".into());
    }
    Ok((path, root))
}

/// Stable private cache identity; neighboring documents must never share state.
pub fn document_id(path: &Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(windows)]
    let path = path.to_lowercase();
    format!("{:x}", Sha256::digest(path.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighboring_documents_have_different_private_storage() {
        assert_ne!(
            document_id(Path::new("/docs/a.typ")),
            document_id(Path::new("/docs/b.typ"))
        );
        assert_eq!(document_id(Path::new("/docs/a.typ")).len(), 64);
    }

    #[test]
    fn document_roots_are_validated_without_creating_metadata() {
        let temp = std::env::temp_dir().join(format!(
            "typwriter-document-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(temp.join("chapters")).unwrap();
        let path = temp.join("chapters/main.typ");
        std::fs::write(&path, "= Hello").unwrap();
        std::fs::write(temp.join("data.txt"), "not a document").unwrap();
        std::fs::create_dir(temp.join("other")).unwrap();
        let (main, root) = resolve_document(&path, None).unwrap();
        assert_eq!(main.parent(), Some(root.as_path()));
        assert!(resolve_document(&path, Some(&temp)).is_ok());
        assert!(resolve_document(&path, Some(&temp.join("elsewhere"))).is_err());
        assert!(resolve_document(&path, Some(&temp.join("other"))).is_err());
        std::fs::write(temp.join("invalid.typ"), [0xff]).unwrap();
        assert!(resolve_document(&temp.join("invalid.typ"), None).is_err());
        assert!(resolve_document(&temp.join("data.txt"), None).is_err());
        assert!(!temp.join(".typwriter").exists());
        // Delete only the fixture directory created above.
        std::fs::remove_dir_all(temp).unwrap();
    }
}
