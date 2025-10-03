use crate::compiler::TypstCompiler;
use crate::manager::ProjectManager;

// The new main state struct for your application.
pub struct AppState {
    pub project: Arc<Mutex<ProjectManager>>,
    pub compiler: Arc<Mutex<TypstCompiler>>,
    pub render_scale: f32, // Simple state can remain here
}

// Constructor for the main AppState
impl AppState {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        let project_manager = ProjectManager::new(root, font_dir);

        let typst_compiler = TypstCompiler::new(root, font_dir);

        Self {
            project: Arc::new(Mutex::new(project_manager)),
            compiler: Arc::new(Mutex::new(typst_compiler)),
            render_scale: 1.0,
        }
    }
}
