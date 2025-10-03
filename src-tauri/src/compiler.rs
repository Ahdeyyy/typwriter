use std::{f32::consts::E, path::PathBuf};

use base64::engine::general_purpose;
use base64::Engine;
use typst::{
    diag::{FileResult, Severity},
    foundations::Bytes,
    layout::{Page, PagedDocument},
    WorldExt,
};
use typst_ide::{
    autocomplete, jump_from_click, jump_from_cursor, tooltip, Completion, Jump, Tooltip,
};
use typst_render::render;
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

#[derive(Serialize, Clone, Debug)]
pub struct RenderResponse {
    image: String,
    width: u32,
    height: u32,
}

#[derive(Serialize, Clone, Debug)]
pub enum ExportFormat {
    Pdf,
    Svg,
    Png,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum DocumentClickResponse {
    FileJump(FileJump), // move the editor cursor to the given byte position in the given file
    PositionJump(PositionJump), // scroll the preview to the given page and point
    UrlJump(String),    // open the given URL in the default browser
    NoJump,
}

pub struct TypstCompiler {
    world: Typstworld,
    compilation_cache: Option<PagedDocument>,
}

#[derive(Serialize, Debug, Deserialize)]
pub enum FileExportError {
    UnsupportedFormat,
    Failed,
}

#[derive(Serialize, Clone, Debug)]
struct PreviewPosition {
    page: usize,
    x: f64,
    y: f64,
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
                self.clear_cache();
            }
        }

        (pages, warnings)
    }

    /// Returns the hover information of the location in the document
    pub async fn tooltip_hover_information() -> Result<()> {}

    /// Returns the page and location of the preview / rendered images
    /// from the cursor position in the text
    pub async fn get_preview_page_from_cursor(
        self,
        doc: &PagedDocument,
        cursor: usize,
    ) -> Result<PreviewPosition> {
        let id = self.world.main();
        let source = self.world.source(id).ok()?;
        let pos = jump_from_cursor(doc, &source, cursor)
            .get(0)
            .unwrap_or_default();

        let x = position.point.x.to_pt() * scale as f64;
        let y = position.point.y.to_pt() * scale as f64;
        let pos = PreviewPosition {
            page: position.page.into(),
            x,
            y,
        };
        pos
    }

    /// Exports the file to a supported format (Pdf, SVG, PNG)
    /// TODO: SVG, PNG
    /// TODO: Add better error support
    pub async fn export_file(
        &mut self,
        source_path: &PathBuf,
        source: String,
        export_path: &PathBuf,
        format: Option<ExportFormat>,
    ) -> Result<(), FileExportError> {
        let format = match format {
            Some(format) => format,
            None => ExportFormat::Pdf,
        };
        let _ = self.compile_file(source_path, source);
        match self.get_cache() {
            Some(doc) => {
                // use match statement when implementing the other formats
                if format == ExportFormat::Pdf {
                    export_pdf(&doc, export_path)
                } else {
                    Err(FileExportError::UnsupportedFormat)
                }
            }
            None => Err(FileExportError::Failed),
        }
    }

    /// Returns appropriate response for a click in the document
    /// it either returns a file jump, position jump, url or no jump
    pub async fn handle_preview_page_click(
        self,
        source_text: String,
        doc: &PagedDocument,
        frame: &Frame,
        click: Point,
    ) -> DocumentClickResponse {
        let pos = jump_from_click(&self.typst_world, doc, frame, click);
        match pos {
            // move the editor cursor to the given byte position in the given file
            Some(Jump::File(file_id, position)) => {
                if let Some(file_path) = self.typst_world.get_file_path(file_id) {
                    DocumentClickResponse::FileJump(FileJump {
                        file: file_path,
                        position: byte_position_to_char_position(&source_text, position),
                    })
                } else {
                    DocumentClickResponse::NoJump
                }
            }
            // scroll the preview to the given page and point
            Some(Jump::Position(position)) => {
                // println!(
                //     "Jump to page: {} at point: ({}, {})",
                //     position.page,
                //     position.point.x.to_pt(),
                //     position.point.y.to_pt()
                // );

                DocumentClickResponse::PositionJump(PositionJump {
                    page: position.page.into(),
                    x: position.point.x.to_pt(),
                    y: position.point.y.to_pt(),
                })
            }
            // open the given URL in the default browser
            Some(Jump::Url(url)) => {
                // println!("Jump to URL: {}", url.as_str());

                DocumentClickResponse::UrlJump(url)
            }

            None => {
                // println!("No jump target found at the clicked position.");
                DocumentClickResponse::NoJump
            }
        }
    }

    // Returns the completions of the file
    pub async fn get_completions() -> Result<()> {}
}

/// Returns the rendered images of the file
pub async fn render_file(pages: Vec<Page>, scale: f32) -> Vec<RenderResponse> {
    let mut rendered_pages = Vec::new();
    pages.iter().enumerate().for_each(|idx, page| {
        let frame_size = page.frame.size();
        let bmp = render(&page, scale);
        if let Ok(image) = bmp.encode_png() {
            let image_base64 = general_purpose::STANDARD.encode(image);

            rendered_pages.push(RenderResponse {
                image: image_base64,
                width: bmp.width(),
                height: bmp.height(),
            });
        }
    });

    rendered_pages
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

#[derive(Serialize, Debug, Deserialize)]
struct GenErrorStruct {
    message: String,
    hints: String,
}

#[derive(Serialize, Debug, Deserialize)]
enum PdfExportError {
    /// error generating the pdf
    GenError(Vec<GenErrorStruct>),
    /// error writing the pdf to file
    WriteError,
}

fn export_pdf(document: &PagedDocument, export_path: &PathBuf) -> Result<(), PdfExportError> {
    let local_datetime = chrono::Local::now();

    let timestamp = Timestamp::new_local(
        utils::convert_datetime(local_datetime).ok_or(())?,
        local_datetime.offset().local_minus_utc() / 60,
    );

    let standards = PdfStandards::default();

    let options = PdfOptions {
        ident: typst::foundations::Smart::Auto,
        timestamp,
        page_ranges: None,
        standards,
    };

    let mut gen_errors = Vec::new();
    let buffer = typst_pdf::pdf(document, &options);
    match buffer {
        Ok(buffer) => match std::fs::write(export_path, buffer) {
            Ok(_) => Ok(()),
            Err(_) => Err(PdfExportError::WriteError),
        },
        Err(e) => {
            e.iter().for_each(|e| {
                gen_errors.push(GenErrorStruct {
                    message: e.to_string(),
                    hints: e.hints.join(", "),
                });
            });
            Err(gen_errors)
        }
    }

    Ok(())
}
