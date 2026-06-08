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
    /// walks the tree with the other primitives so it works over SAF;
    /// [`LocalWorkingTreeFs`] overrides it with `std::fs::remove_dir_all`.
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

    /// Move/rename a file or directory. The Storage Access Framework has no
    /// atomic rename across the document tree, so the default copies then
    /// deletes; [`LocalWorkingTreeFs`] overrides it with the atomic
    /// `std::fs::rename`.
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

#[cfg(target_os = "android")]
pub struct AndroidWorkingTreeFs<R: tauri::Runtime> {
    app_handle: tauri::AppHandle<R>,
    root_path: Option<PathBuf>,
    root_uri: Option<tauri_plugin_android_fs::FileUri>,
}

#[cfg(target_os = "android")]
impl<R: tauri::Runtime> AndroidWorkingTreeFs<R> {
    pub fn new(app_handle: tauri::AppHandle<R>) -> Self {
        Self {
            app_handle,
            root_path: None,
            root_uri: None,
        }
    }

    pub fn new_with_root(
        app_handle: tauri::AppHandle<R>,
        root_path: PathBuf,
        root_uri: tauri_plugin_android_fs::FileUri,
    ) -> Self {
        Self {
            app_handle,
            root_path: Some(root_path),
            root_uri: Some(root_uri),
        }
    }

    fn api(&self) -> &tauri_plugin_android_fs::api::api_sync::AndroidFs<R> {
        use tauri_plugin_android_fs::AndroidFsExt;
        self.app_handle.android_fs()
    }

    fn uri(path: &Path) -> tauri_plugin_android_fs::FileUri {
        tauri_plugin_android_fs::FileUri::from_path(path)
    }

    fn root_relative(&self, path: &Path) -> Option<PathBuf> {
        let root = self.root_path.as_ref()?;
        path.strip_prefix(root).ok().map(PathBuf::from)
    }

    fn dir_uri(&self, path: &Path) -> Result<tauri_plugin_android_fs::FileUri, String> {
        let Some(root_uri) = self.root_uri.as_ref() else {
            return Ok(Self::uri(path));
        };
        let Some(rel) = self.root_relative(path) else {
            return Ok(Self::uri(path));
        };
        if rel.as_os_str().is_empty() {
            return Ok(root_uri.clone());
        }
        self.api()
            .resolve_dir_uri(root_uri, &rel)
            .map_err(|e| format!("android-fs resolve dir {path:?}: {e}"))
    }

    fn file_uri(&self, path: &Path) -> Result<tauri_plugin_android_fs::FileUri, String> {
        let Some(root_uri) = self.root_uri.as_ref() else {
            return Ok(Self::uri(path));
        };
        let Some(rel) = self.root_relative(path) else {
            return Ok(Self::uri(path));
        };
        self.api()
            .resolve_file_uri(root_uri, &rel)
            .map_err(|e| format!("android-fs resolve file {path:?}: {e}"))
    }
}

#[cfg(target_os = "android")]
impl<R: tauri::Runtime> WorkingTreeFs for AndroidWorkingTreeFs<R> {
    fn read_dir(&self, dir: &Path) -> Result<Vec<WorkingEntry>, String> {
        let dir_uri = self.dir_uri(dir)?;
        let read = self
            .api()
            .read_dir(&dir_uri)
            .map_err(|e| format!("android-fs read_dir {dir:?}: {e}"))?;
        let mut entries = Vec::new();
        for entry in read {
            let path = entry
                .uri()
                .to_path()
                .unwrap_or_else(|| dir.join(entry.name()));
            entries.push(WorkingEntry {
                name: entry.name().to_string(),
                path,
                is_dir: entry.is_dir(),
                is_file: entry.is_file(),
            });
        }
        Ok(entries)
    }

    fn read_file(&self, path: &Path) -> Result<Vec<u8>, String> {
        self.api()
            .read(&self.file_uri(path)?)
            .map_err(|e| format!("android-fs read {path:?}: {e}"))
    }

    fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        if !self.exists(path) {
            let parent = path
                .parent()
                .ok_or_else(|| format!("android-fs write {path:?}: path has no parent"))?;
            self.create_dir_all(parent)?;
            let name = path
                .file_name()
                .ok_or_else(|| format!("android-fs write {path:?}: path has no file name"))?;
            let file_uri = if let (Some(root_uri), Some(rel)) =
                (self.root_uri.as_ref(), self.root_relative(path))
            {
                self.api()
                    .create_new_file(root_uri, &rel, None)
                    .map_err(|e| format!("android-fs create file {path:?}: {e}"))?
            } else {
                self.api()
                    .create_new_file(&self.dir_uri(parent)?, Path::new(name), None)
                    .map_err(|e| format!("android-fs create file {path:?}: {e}"))?
            };
            return self
                .api()
                .write(&file_uri, bytes)
                .map_err(|e| format!("android-fs write {path:?}: {e}"));
        }
        self.api()
            .write(&self.file_uri(path)?, bytes)
            .map_err(|e| format!("android-fs write {path:?}: {e}"))
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        if self.exists(path) {
            return Ok(());
        }
        if let (Some(root_uri), Some(rel)) = (self.root_uri.as_ref(), self.root_relative(path)) {
            self.api()
                .create_dir_all(root_uri, &rel)
                .map_err(|e| format!("android-fs mkdir {path:?}: {e}"))?;
            return Ok(());
        }
        let mut ancestor = path;
        while !self.exists(ancestor) {
            ancestor = ancestor
                .parent()
                .ok_or_else(|| format!("android-fs mkdir {path:?}: no existing ancestor"))?;
        }
        let rel = path
            .strip_prefix(ancestor)
            .map_err(|_| format!("android-fs mkdir {path:?}: not below {ancestor:?}"))?;
        self.api()
            .create_dir_all(&self.dir_uri(ancestor)?, rel)
            .map_err(|e| format!("android-fs mkdir {path:?}: {e}"))?;
        Ok(())
    }

    fn remove_file(&self, path: &Path) -> Result<(), String> {
        self.api()
            .remove_file(&self.file_uri(path)?)
            .map_err(|e| format!("android-fs remove_file {path:?}: {e}"))
    }

    fn remove_dir(&self, path: &Path) -> Result<(), String> {
        self.api()
            .remove_dir(&self.dir_uri(path)?)
            .map_err(|e| format!("android-fs remove_dir {path:?}: {e}"))
    }

    fn exists(&self, path: &Path) -> bool {
        self.file_uri(path)
            .and_then(|uri| self.api().get_metadata(&uri).map_err(|e| e.to_string()))
            .is_ok()
            || self
                .dir_uri(path)
                .and_then(|uri| {
                    self.api()
                        .read_dir(&uri)
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                })
                .is_ok()
    }
}
