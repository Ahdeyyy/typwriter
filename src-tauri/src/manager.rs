use std::path::PathBuf;

pub struct ProjectManager {
    pub root: PathBuf,
    pub entries: Vec<PathBuf>,
    pub current_file: Option<PathBuf>,
}

impl ProjectManager {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        let entries: Vec<PathBuf> = get_all_files_in_workspace(&root);

        Self {
            root,
            entries,
            current_file: None,
        }
    }

    pub fn add_file(&mut self, path: PathBuf) {
        self.entries.push(path);
    }
}
