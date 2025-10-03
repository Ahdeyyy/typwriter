use std::path::PathBuf;

use typst::{
    diag::{FileResult, Severity},
    foundations::Bytes,
    layout::{Page, PagedDocument},
    WorldExt,
};
use typst_syntax::{FileId, VirtualPath};

use crate::world::Typstworld;

#[derive(Serialize, Clone, Debug, Default)]
pub struct DiagnosticPosition {
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Serialize, Clone, Debug)]
pub enum TypstSeverity {
    Error,
    Warning,
}

#[derive(Serialize, Clone, Debug)]
pub struct TypstSourceDiagnostic {
    pub location: DiagnosticPosition,
    pub severity: TypstSeverity,
    pub message: String,
    pub hints: Vec<String>,
}

pub struct TypstCompiler {
    world: Typstworld,
    compilation_cache: Option<PagedDocument>,
}

impl TypstCompiler {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        let entries = get_all_files_in_path(root);
        let mut typst_world = Typstworld::new(root.clone(), font_dir);

        // load the files into typst world
        for entry in &entries {
            if let Some(name) = entry.file_name().and_then(|n| n.to_str()) {
                if let Ok(data) = std::fs::read(entry) {
                    let data = typst::foundations::Bytes::new(data);
                    typst_world.add_file(name, entry.clone(), data);
                }
            }
        }

        Self {
            world: typst_world,
            compilation_cache: None,
        }
    }

    pub fn clear_cache(&mut self) {
        self.compilation_cache = None;
    }

    pub fn get_cache(self) -> Option<PagedDocument> {
        self.compilation_cache
    }

    pub fn add_file_to_world(&mut self, path: PathBuf, source: Bytes) {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("untitled");

        self.world.add_file(name, path, source);
    }

    pub async fn compile_file(
        &mut self,
        path: &PathBuf,
        source: String,
    ) -> (Vec<Page>, Vec<TypstSourceDiagnostic>) {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("main.typ");
        let id = match self.world.get_file_id(path) {
            Some(id) => id,
            None => {
                let vpath = VirtualPath::new(name);
                FileId::new(None, vpath)
            }
        };
        self.world.update_source(id, source);
        self.world.set_main_source(name, source);

        let pages = Vec::new();
        let warned_compilation_result = typst::compile::<PagedDocument>(&self.world);
        let warnings = Vec::new();
        warned_compilation_result.warnings.iter().for_each(|w| {
            let diagnostic_range = self.world.range(w.span()).unwrap_or_default();
            let diagnostic_source = self
                .world
                .source(w.span().id().unwrap_or(self.world.main()));
            let position = diagnostic_position_from_source(diagnostic_source, diagnostic_range);

            let diagnostic = TypstSourceDiagnostic {
                hints: w.hints.iter().map(|s| s.to_string()).collect(),
                location: position,
                severity: match w.severity {
                    Severity::Error => TypstSeverity::Error,
                    Severity::Warning => TypstSeverity::Warning,
                },
                message: w.message.to_string(),
            };
            warnings.push(diagnostic);
        });

        match warned_compilation_result.output {
            Ok(doc) => {
                self.compilation_cache = Some(doc);
                pages = doc.pages;
            }
            Err(diagnostic_errors) => {
                diagnostic_errors.iter().for_each(|w| {
                    let diagnostic_range = self.world.range(w.span()).unwrap_or_default();
                    let diagnostic_source = self
                        .world
                        .source(w.span().id().unwrap_or(self.world.main()));
                    let position =
                        diagnostic_position_from_source(diagnostic_source, diagnostic_range);

                    let diagnostic = TypstSourceDiagnostic {
                        hints: w.hints.iter().map(|s| s.to_string()).collect(),
                        location: position,
                        severity: match w.severity {
                            Severity::Error => TypstSeverity::Error,
                            Severity::Warning => TypstSeverity::Warning,
                        },
                        message: w.message.to_string(),
                    };
                    warnings.push(diagnostic);
                });
            }
        }

        (pages, warnings)
    }

    /// Returns the rendered images of the file
    pub async fn render_file() -> Result<()> {}

    /// Returns the hover information of the location in the document
    pub async fn tooltip_hover_information() -> Result<()> {}

    /// Returns the page and location of the preview / rendered images
    /// from the cursor position in the text
    pub async fn get_preview_page_from_cursor() -> Result<()> {}

    /// Exports the file to a supported format (Pdf, SVG, PNG)
    /// TODO: SVG, PNG
    pub async fn export_file() -> Result<()> {}

    /// Returns appropriate response for a click in the document
    /// it either returns a file jump, position jump, url or no jump
    pub async fn handle_preview_click() -> Result<()> {}

    // Returns the completions of the file
    pub async fn get_completion() -> Result<()> {}
}

fn diagnostic_position_from_source(
    source: FileResult<Bytes>,
    diagnostic_range: Range<usize>,
) -> DiagnosticPosition {
    match source {
        Ok(source) => {
            let line = source.byte_to_line(diagnostic_range.start).unwrap_or(0);
            let column = source.byte_to_column(diagnostic_range.start).unwrap_or(0);
            let end_line = source.byte_to_line(diagnostic_range.end).unwrap_or(0);
            let end_column = source.byte_to_column(diagnostic_range.end).unwrap_or(0);
            DiagnosticPosition {
                line: line + 1,
                column: column + 1,
                end_line: end_line + 1,
                end_column: end_column + 1,
            }
        }
        Err(_) => DiagnosticPosition::default(),
    };
}
