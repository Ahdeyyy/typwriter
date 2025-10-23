use std::path::PathBuf;

use crate::typst_compiler::compiler::TypstCompiler;
use tokio::sync::RwLock;

pub struct AppState {
    pub compiler: RwLock<TypstCompiler>,
}

impl AppState {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        AppState {
            compiler: RwLock::new(TypstCompiler::new(root, font_dir)),
        }
    }
}
