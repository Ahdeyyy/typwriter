use crate::compiler::TypstCompiler;
use crate::manager::ProjectManager;
use std::path::PathBuf;
use tokio::sync::RwLock;

// The new main state struct for your application.
pub struct AppState {
    pub project: RwLock<ProjectManager>,
    pub compiler: RwLock<TypstCompiler>,
    pub render_scale: f32, // Simple state can remain here
}

// Constructor for the main AppState
impl AppState {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        let project_manager = ProjectManager::new(root.clone());

        let typst_compiler = TypstCompiler::new(root, font_dir);

        Self {
            project: RwLock::new(project_manager),
            compiler: RwLock::new(typst_compiler),
            render_scale: 1.0,
        }
    }
}
