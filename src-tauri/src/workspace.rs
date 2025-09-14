use base64::engine::general_purpose;
use base64::Engine;

use crate::world;
use serde::Serialize;
use std::path::PathBuf;
use std::vec;
use typst::diag::{Severity, SourceDiagnostic};
use typst::{compile, layout::Page};
// use typst_ide::{autocomplete, jump_from_click, jump_from_cursor, IdeWorld};
use typst_render::render;

#[derive(Serialize, Clone, Debug)]
pub struct Range<T> {
    pub start: T,
    pub end: T,
}

#[derive(Serialize, Clone, Debug)]
pub enum TypstSeverity {
    Error,
    Warning,
}

#[derive(Serialize, Clone, Debug)]
pub struct TypstSourceDiagnostic {
    pub range: Range<usize>,
    pub severity: TypstSeverity,
    pub message: String,
    pub hints: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct RenderResponse {
    image: String,
    width: u32,
    height: u32,
}

pub struct WorkSpace {
    root: PathBuf,
    entries: Vec<PathBuf>,         // files and directories in the workspace
    current_file: Option<PathBuf>, // currently open file
    // active_files: Vec<PathBuf>,    // files currently open in the editor
    // compilation_cache: HashMap<PathBuf, Vec<Page>>, // cache of compiled files
    // diagnostics_cache: HashMap<PathBuf, Vec<TypstSourceDiagnostic>>, // cache of diagnostics
    typst_world: world::SimpleWorld,
}

impl WorkSpace {
    pub fn new(root: PathBuf) -> Self {
        let entries: Vec<PathBuf> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|res| res.ok().map(|e| e.path()))
            .collect();

        let mut typst_world = world::SimpleWorld::new(root.clone());

        // Load all files in the workspace into the Typst world

        for entry in &entries {
            if entry.is_file() {
                if let Some(name) = entry.file_name().and_then(|n| n.to_str()) {
                    if let Ok(data) = std::fs::read(entry) {
                        let data = typst::foundations::Bytes::new(data);
                        typst_world.add_file(name, data);
                    }
                }
            }
        }

        Self {
            root,
            entries,
            current_file: None,
            // active_files: Vec::new(),
            // compilation_cache: HashMap::new(),
            // diagnostics_cache: HashMap::new(),
            typst_world,
        }
    }

    pub fn set_active_file(&mut self, path: PathBuf) {
        if path.exists() && path.is_file() {
            self.current_file = Some(path.clone());
            // if !self.active_files.contains(&path) {
            //     self.active_files.push(path);
            // }
        }
    }

    pub fn compile_current(
        &mut self,
        source: String,
    ) -> Result<(Vec<Page>, Vec<TypstSourceDiagnostic>), Vec<TypstSourceDiagnostic>> {
        if let Some(ref path) = self.current_file.clone() {
            self.compile_file(path, source)
        } else {
            Err(vec![])
        }
    }

    // compile the file at the given path with the given source code
    // returns a tuple of the compiled pages and any diagnostics
    // if there are errors, it returns the diagnostics (fatal errors)
    // if there are only warnings, it returns the pages and the diagnostics
    // if there are no errors or warnings, it returns the pages and an empty diagnostics vector
    pub fn compile_file(
        &mut self,
        path: &PathBuf,
        source: String,
    ) -> Result<(Vec<Page>, Vec<TypstSourceDiagnostic>), Vec<TypstSourceDiagnostic>> {
        if let Some(ref path) = self.current_file {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("main.typ");
            self.typst_world.reset();
            self.typst_world.set_main_source(name, source);
            let warned = compile::<typst::layout::PagedDocument>(&self.typst_world);
            // add all the warnings to the diagnostic
            let mut warnings: Vec<TypstSourceDiagnostic> = vec![];
            for warning in warned.warnings {
                let diagnostic_with_hints =
                    SourceDiagnostic::with_hints(warning.clone(), warning.hints);
                let diagnostic_range = match diagnostic_with_hints.clone().span.range() {
                    Some(r) => Range {
                        start: r.start,
                        end: r.end,
                    },
                    None => Range { start: 0, end: 0 },
                };

                let hints = diagnostic_with_hints.hints;

                let diagnostic = TypstSourceDiagnostic {
                    hints: hints.iter().map(|s| s.to_string()).collect(),
                    range: diagnostic_range,
                    severity: match diagnostic_with_hints.severity {
                        Severity::Error => TypstSeverity::Error,
                        Severity::Warning => TypstSeverity::Warning,
                    },
                    message: diagnostic_with_hints.message.to_string(),
                };

                warnings.push(diagnostic);
            }
            // self.diagnostics_cache
            //     .insert(path.clone(), warnings.clone());

            match warned.output {
                Ok(doc) => {
                    let pages = doc.pages;

                    // self.compilation_cache.insert(path.clone(), pages.clone());
                    return Ok((pages, warnings));
                }
                Err(err) => {
                    let mut errors: Vec<TypstSourceDiagnostic> = vec![];
                    for e in err {
                        let diagnostic_with_hints =
                            SourceDiagnostic::with_hints(e.clone(), e.hints);
                        let diagnostic_range = match diagnostic_with_hints.clone().span.range() {
                            Some(r) => Range {
                                start: r.start,
                                end: r.end,
                            },
                            None => Range { start: 0, end: 0 },
                        };

                        let hints = diagnostic_with_hints.hints;

                        let diagnostic = TypstSourceDiagnostic {
                            hints: hints.iter().map(|s| s.to_string()).collect(),
                            range: diagnostic_range,
                            severity: match diagnostic_with_hints.severity {
                                Severity::Error => TypstSeverity::Error,
                                Severity::Warning => TypstSeverity::Warning,
                            },
                            message: diagnostic_with_hints.message.to_string(),
                        };
                        // dbg!(diagnostic.clone());
                        errors.push(diagnostic);
                    }
                    let mut all_diagnostics = warnings.clone();

                    all_diagnostics.extend(errors);

                    // self.diagnostics_cache
                    //     .insert(path.clone(), all_diagnostics.clone());
                    return Err(all_diagnostics);
                }
            }
        } else {
            dbg!("{} file not found", path.display());
            Err(vec![])
        }
    }

    pub fn render_current_pages(&self, pages: Vec<Page>, scale: f32) -> Vec<RenderResponse> {
        let mut rendered_pages = Vec::new();
        for page in pages {
            let bmp = render(&page, scale);
            if let Ok(image) = bmp.encode_png() {
                let image_base64 = general_purpose::STANDARD.encode(image);
                rendered_pages.push(RenderResponse {
                    image: image_base64,
                    width: bmp.width(),
                    height: bmp.height(),
                });
            }
        }
        rendered_pages
    }

    pub fn list_entries(&self) -> &Vec<PathBuf> {
        &self.entries
    }

    pub fn get_current_file(&self) -> Option<&PathBuf> {
        self.current_file.as_ref()
    }

    // pub fn get_active_files(&self) -> &Vec<PathBuf> {
    //     &self.active_files
    // }

    pub fn refresh(&mut self) {
        self.entries = std::fs::read_dir(&self.root)
            .unwrap()
            .map(|res| res.unwrap().path())
            .collect();
    }

    // pub fn jump_from_click(&self, doc: &PagedDocument, frame: &Frame, click: &Point) {
    //     let pos = jump_from_click(self.typst_world, doc, frame, click);
    //     match pos {
    //         Some(j) => {
    //             // Handle the jump position
    //             match j {
    //                 Position{page, point} => {},

    //             }
    //         }
    //         None => {}
    //     }
    // }

    // pub fn set_active_file(&mut self, path: PathBuf) {
    //     if self.active_files.contains(&path) {
    //         self.current_file = Some(path);
    //     }
    // }
}
