use std::path::PathBuf;

pub struct ProjectManager {
    pub root: PathBuf,
    pub entries: Vec<PathBuf>,
    pub current_file: Option<PathBuf>,
}

impl ProjectManager {
    pub fn new(root: PathBuf) -> Self {
        let entries: Vec<PathBuf> = crate::utils::get_all_files_in_path(&root);

        Self {
            root,
            entries,
            current_file: None,
        }
    }

    pub fn add_file(&mut self, path: PathBuf) {
        self.entries.push(path);
    }

    pub fn set_active_file(&mut self, path: PathBuf) {
        if path.exists() && path.is_file() {
            self.current_file = Some(path.clone());
        }
    }
}
