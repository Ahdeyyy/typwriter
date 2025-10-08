use std::path::PathBuf;

use base64::engine::general_purpose;
use base64::Engine;
use typst::{
    diag::{FileResult, Severity, SourceDiagnostic},
    foundations::Bytes,
    layout::{Frame, Page, PagedDocument, Point},
    World, WorldExt,
};
use typst_ide::{autocomplete, jump_from_click, jump_from_cursor, tooltip, Jump, Tooltip};
use typst_pdf::{PdfOptions, PdfStandards, Timestamp};

use typst_render::render;
use typst_syntax::{FileId, Source, VirtualPath};

use crate::utils::{byte_position_to_char_position, char_to_byte_position, convert_datetime};
use crate::world::Typstworld;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::ops::Range;

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

#[derive(Serialize, Clone, Debug, PartialEq)]
pub enum ExportFormat {
    Pdf,
    Svg,
    Png,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileJump {
    pub file: PathBuf,
    pub position: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct PositionJump {
    pub page: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct UrlJump {
    pub url: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum DocumentClickResponse {
    FileJump(FileJump), // move the editor cursor to the given byte position in the given file
    PositionJump(PositionJump), // scroll the preview to the given page and point
    UrlJump(UrlJump),   // open the given URL in the default browser
    NoJump,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum TooltipKind {
    Code,
    Text,
}
#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(tag = "type")]
pub struct TooltipResponse {
    pub kind: TooltipKind,
    pub text: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct CompletionResponse {
    pub char_position: usize,
    pub completions: Vec<typst_ide::Completion>,
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
pub struct PreviewPosition {
    page: usize,
    x: f64,
    y: f64,
}

impl TypstCompiler {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        let entries = crate::utils::get_all_files_in_path(&root);
        let typst_world = Typstworld::new(root.clone(), font_dir);

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

    pub fn get_cache(&self) -> Option<&PagedDocument> {
        self.compilation_cache.as_ref()
    }

    pub fn get_cached_page(&self, page_number: usize) -> Option<&Page> {
        if let Some(ref doc) = self.compilation_cache {
            if page_number < doc.pages.len() {
                return Some(&doc.pages[page_number]);
            }
        }
        None
    }

    pub fn add_file_to_world(&mut self, path: PathBuf, source: Bytes) {
        let binding = path.clone();
        let name = binding
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("untitled");

        self.world.add_file(name, path, source);
    }

    pub fn compile_file(
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

        // NOTE: might error?
        // let _ = self.world.update_source(id, source.clone());
        // self.world.reset();
        self.world.set_main_source_with_id(id, source);

        let mut pages = Vec::new();
        let start = std::time::Instant::now();
        let warned_compilation_result = typst::compile::<PagedDocument>(&self.world);
        let duration = start.elapsed();
        println!("compilation took {:?}", duration);

        let process_diagnostics = |diagnostics: &[SourceDiagnostic]| -> Vec<TypstSourceDiagnostic> {
            let start = std::time::Instant::now();
            let diags = diagnostics
                .par_iter()
                .filter_map(|diagnostic| {
                    let diagnostic_range = self.world.range(diagnostic.span).unwrap_or_default();
                    let diagnostic_source = self
                        .world
                        .source(diagnostic.span.id().unwrap_or(self.world.main()));
                    let position =
                        diagnostic_position_from_source(diagnostic_source, diagnostic_range);

                    let diagnostic = TypstSourceDiagnostic {
                        hints: diagnostic.hints.iter().map(|s| s.to_string()).collect(),
                        location: position,
                        severity: match diagnostic.severity {
                            Severity::Error => TypstSeverity::Error,
                            Severity::Warning => TypstSeverity::Warning,
                        },
                        message: diagnostic.message.to_string(),
                    };
                    Some(diagnostic)
                })
                .collect();
            let duration = start.elapsed();
            println!("diagnostics proccessing took {:?}", duration);
            diags
        };

        let mut warnings = process_diagnostics(&warned_compilation_result.warnings);
        match warned_compilation_result.output {
            Ok(doc) => {
                pages = doc.pages.clone();
                self.compilation_cache = Some(doc);
            }
            Err(diagnostic_errors) => {
                warnings.extend(process_diagnostics(&diagnostic_errors));
            }
        }

        (pages, warnings)
    }

    /// Returns the hover information of the location in the document
    pub async fn tooltip_hover_information(
        &self,
        source_text: String,
        char_position: usize,
    ) -> Option<TooltipResponse> {
        let id = self.world.main();
        let source = self.world.source(id).ok()?;
        let cursor = char_to_byte_position(&source_text, char_position);
        let document = self.compilation_cache.clone();
        let side = typst_syntax::Side::Before;
        let info = tooltip(&self.world, document.as_ref(), &source, cursor, side);
        if let Some(tool) = info {
            match tool {
                Tooltip::Text(text) => Some(TooltipResponse {
                    kind: TooltipKind::Text,
                    text: text.as_str().to_string(),
                }),
                Tooltip::Code(text) => Some(TooltipResponse {
                    kind: TooltipKind::Code,
                    text: text.as_str().to_string(),
                }),
            }
        } else {
            None
        }
    }

    /// Returns the page and location of the preview / rendered images
    /// from the cursor position in the text
    pub async fn get_preview_page_from_cursor(
        &self,
        doc: &PagedDocument,
        cursor: usize,
        scale: f32,
    ) -> Option<PreviewPosition> {
        let id = self.world.main();
        let source = self.world.source(id).ok()?;
        let positions = jump_from_cursor(doc, &source, cursor);
        let position = positions.get(0)?.clone();

        let x = position.point.x.to_pt() * scale as f64;
        let y = position.point.y.to_pt() * scale as f64;
        let pos = PreviewPosition {
            page: position.page.into(),
            x,
            y,
        };
        Some(pos)
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
                    export_pdf(&doc, export_path).map_err(|_| FileExportError::Failed)
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
        &self,
        source_text: String,
        doc: &PagedDocument,
        frame: &Frame,
        click: Point,
    ) -> DocumentClickResponse {
        let pos = jump_from_click(&self.world, doc, frame, click);
        match pos {
            // move the editor cursor to the given byte position in the given file
            Some(Jump::File(file_id, position)) => {
                if let Some(file_path) = self.world.get_file_path(file_id) {
                    DocumentClickResponse::FileJump(FileJump {
                        file: file_path,
                        position: byte_position_to_char_position(&source_text, position),
                    })
                } else {
                    dbg!("No file path found for the given file ID.");
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
                dbg!("Jump to URL: {}", url.as_str());
                DocumentClickResponse::UrlJump(UrlJump {
                    url: url.as_str().to_string(),
                })
            }

            None => {
                // println!("No jump target found at the clicked position.");
                dbg!("No jump target found at the clicked position.");
                DocumentClickResponse::NoJump
            }
        }
    }

    // Returns the completions of the file
    pub async fn get_completions(
        &self,
        source_text: String,
        doc: &PagedDocument,
        cursor: usize,
        explicit: bool,
    ) -> Option<CompletionResponse> {
        let id = self.world.main();
        let source = self.world.source(id).ok()?;
        let completions = autocomplete(&self.world, Some(doc), &source, cursor, explicit);
        if let Some((position, completions)) = completions {
            Some(CompletionResponse {
                completions,
                char_position: byte_position_to_char_position(&source_text, position),
            })
        } else {
            None
        }
    }
}

/// Returns the rendered images of the file
pub fn render_file(pages: Vec<Page>, scale: f32) -> Vec<RenderResponse> {
    let rendered_pages = pages
        .par_iter()
        .enumerate()
        .filter_map(|(_idx, page)| {
            // let frame_size = page.frame.size();
            let bmp = render(&page, scale);
            if let Ok(image) = bmp.encode_png() {
                let image_base64 = general_purpose::STANDARD.encode(image);

                Some(RenderResponse {
                    image: image_base64,
                    width: bmp.width(),
                    height: bmp.height(),
                })
            } else {
                None
            }
        })
        .collect();
    rendered_pages
}

pub fn render_page(page: &Page, scale: f32) -> RenderResponse {
    let bmp = render(page, scale);
    if let Ok(image) = bmp.encode_png() {
        let image_base64 = general_purpose::STANDARD.encode(image);
        return RenderResponse {
            image: image_base64,
            width: bmp.width(),
            height: bmp.height(),
        };
    } else {
        return RenderResponse {
            image: String::new(),
            width: 0,
            height: 0,
        };
    }
}

fn diagnostic_position_from_source(
    source: FileResult<Source>,
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
    }
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

// TODO: add error types
fn export_pdf(document: &PagedDocument, export_path: &PathBuf) -> Result<(), ()> {
    let local_datetime = chrono::Local::now();

    let timestamp = Timestamp::new_local(
        convert_datetime(local_datetime).ok_or(())?,
        local_datetime.offset().local_minus_utc() / 60,
    );

    let standards = PdfStandards::default();

    let options = PdfOptions {
        ident: typst::foundations::Smart::Auto,
        timestamp,
        page_ranges: None,
        standards,
    };

    // let mut gen_errors = Vec::new();
    let buffer = typst_pdf::pdf(document, &options);
    let _ = match buffer {
        Ok(buffer) => match std::fs::write(export_path, buffer) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        },
        Err(_) => Err(()),
    };

    Ok(())
}
