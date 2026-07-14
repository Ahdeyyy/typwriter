use std::{
    fs,
    path::{Path, PathBuf},
};

pub struct WorkingEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub is_file: bool,
}

pub trait WorkingTreeFs {
    fn read_dir(&self, dir: &Path) -> Result<Vec<WorkingEntry>, String>;
    fn read_file(&self, path: &Path) -> Result<Vec<u8>, String>;
    fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String>;
    fn create_dir_all(&self, path: &Path) -> Result<(), String>;
    fn remove_file(&self, path: &Path) -> Result<(), String>;
    fn remove_dir(&self, path: &Path) -> Result<(), String>;
    fn exists(&self, path: &Path) -> bool;

    /// Recursively delete a directory and everything beneath it. The default
    /// walks the tree with the other primitives; [`LocalWorkingTreeFs`]
    /// overrides it with `std::fs::remove_dir_all`.
    fn remove_dir_all(&self, path: &Path) -> Result<(), String> {
        for entry in self.read_dir(path)? {
            if entry.is_dir {
                self.remove_dir_all(&entry.path)?;
            } else {
                self.remove_file(&entry.path)?;
            }
        }
        self.remove_dir(path)
    }

    /// Move/rename a file or directory. The default copies then deletes;
    /// [`LocalWorkingTreeFs`] overrides it with the atomic `std::fs::rename`.
    fn rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        self.copy_tree(from, to)?;
        self.remove_tree(from)
    }

    /// Recursively copy a file or directory. A successful `read_dir` means
    /// `from` is a directory; otherwise it is treated as a file. Backs the
    /// default [`rename`](Self::rename).
    fn copy_tree(&self, from: &Path, to: &Path) -> Result<(), String> {
        match self.read_dir(from) {
            Ok(entries) => {
                self.create_dir_all(to)?;
                for entry in entries {
                    self.copy_tree(&entry.path, &to.join(&entry.name))?;
                }
                Ok(())
            }
            Err(_) => {
                let bytes = self.read_file(from)?;
                self.write_file(to, &bytes)
            }
        }
    }

    /// Recursively delete a file or directory. Companion to
    /// [`copy_tree`](Self::copy_tree) for the default [`rename`](Self::rename).
    fn remove_tree(&self, path: &Path) -> Result<(), String> {
        match self.read_dir(path) {
            Ok(_) => self.remove_dir_all(path),
            Err(_) => self.remove_file(path),
        }
    }
}

pub struct LocalWorkingTreeFs;

impl WorkingTreeFs for LocalWorkingTreeFs {
    fn read_dir(&self, dir: &Path) -> Result<Vec<WorkingEntry>, String> {
        let read = fs::read_dir(dir).map_err(|e| format!("read_dir {dir:?}: {e}"))?;
        let mut entries = Vec::new();
        for entry in read.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str().map(String::from) else {
                continue;
            };
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            entries.push(WorkingEntry {
                name,
                path: entry.path(),
                is_dir: file_type.is_dir(),
                is_file: file_type.is_file(),
            });
        }
        Ok(entries)
    }

    fn read_file(&self, path: &Path) -> Result<Vec<u8>, String> {
        fs::read(path).map_err(|e| format!("read {path:?}: {e}"))
    }

    fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        fs::write(path, bytes).map_err(|e| format!("write {path:?}: {e}"))
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        fs::create_dir_all(path).map_err(|e| format!("mkdir {path:?}: {e}"))
    }

    fn remove_file(&self, path: &Path) -> Result<(), String> {
        fs::remove_file(path).map_err(|e| format!("remove_file {path:?}: {e}"))
    }

    fn remove_dir(&self, path: &Path) -> Result<(), String> {
        fs::remove_dir(path).map_err(|e| format!("remove_dir {path:?}: {e}"))
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), String> {
        fs::remove_dir_all(path).map_err(|e| format!("remove_dir_all {path:?}: {e}"))
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        fs::rename(from, to).map_err(|e| format!("rename {from:?} -> {to:?}: {e}"))
    }
}
