use base64::engine::general_purpose;
use base64::Engine;
use typst::foundations::Datetime;
use typst::layout::{Frame, PagedDocument, Point, Position};
use typst::{pdf, World};
use typst_ide::{
    autocomplete, jump_from_click, jump_from_cursor, tooltip, Completion, Jump, Tooltip,
};

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::vec;
use typst::diag::{Severity, SourceDiagnostic};
use typst::{compile, layout::Page, WorldExt};
use typst_pdf::{PdfOptions, PdfStandards, Timestamp};
use typst_render::render;

use crate::utils::{byte_position_to_char_position, char_to_byte_position};
use crate::world::Typstworld;
use chrono::{Datelike, Timelike};

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
#[serde(tag = "type")]
pub enum DocumentClickResponseType {
    FileJump(FileJump), // move the editor cursor to the given byte position in the given file
    PositionJump(PositionJump), // scroll the preview to the given page and point
    UrlJump(String),    // open the given URL in the default browser
    NoJump,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Range<T> {
    pub start: T,
    pub end: T,
}

#[derive(Serialize, Clone, Debug)]
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
}

#[derive(Serialize, Clone, Debug)]
pub struct CompletionResponse {
    /// character position at which the completion is apply
    pub char_position: usize,
    pub completions: Vec<Completion>,
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

pub struct WorkSpace {
    root: PathBuf,
    entries: Vec<PathBuf>,         // files and directories in the workspace
    current_file: Option<PathBuf>, // currently open file
    // active_files: Vec<PathBuf>,    // files currently open in the editor
    // compilation_cache: HashMap<PathBuf, Vec<Page>>, // cache of compiled files
    // diagnostics_cache: HashMap<PathBuf, Vec<TypstSourceDiagnostic>>, // cache of diagnostics
    typst_world: Typstworld,
    compilation_cache: Option<PagedDocument>, // cache for the compiled file
    render_scale: f32,                        // scale factor used for rendering
}

impl WorkSpace {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        let entries: Vec<PathBuf> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|res| res.ok().map(|e| e.path()))
            .collect();

        let mut typst_world = Typstworld::new(root.clone(), font_dir);

        // Load all files in the workspace into the Typst world

        for entry in &entries {
            if entry.is_file() {
                if let Some(name) = entry.file_name().and_then(|n| n.to_str()) {
                    if let Ok(data) = std::fs::read(entry) {
                        let data = typst::foundations::Bytes::new(data);
                        typst_world.add_file(name, entry.clone(), data);
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
            compilation_cache: None,

            render_scale: 1.0, // default scale factor
        }
    }

    pub fn move_document_to_cursor(
        &self,
        doc: &PagedDocument,
        source_text: String,
        cursor: usize,
    ) -> Option<Position> {
        let id = self.typst_world.main();
        let source = self.typst_world.source(id).ok()?;
        let pos = jump_from_cursor(doc, &source, cursor);

        pos.get(0).cloned()
    }

    pub fn get_page_from_cache(&self, page_number: usize) -> Option<&Page> {
        if let Some(ref doc) = self.compilation_cache {
            if page_number < doc.pages.len() {
                return Some(&doc.pages[page_number]);
            }
        }
        None
    }

    pub fn set_active_file(&mut self, path: PathBuf) {
        if path.exists() && path.is_file() {
            self.current_file = Some(path.clone());
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

    // export the file to a given path

    pub fn export_file(
        &mut self,
        source_path: &PathBuf,
        source: String,
        export_path: &PathBuf,
        format: ExportFormat,
    ) -> Result<(), ()> {
        let name = source_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("main.typ");
        self.typst_world.reset();
        self.typst_world.set_main_source(name, source);
        let result = compile::<PagedDocument>(&self.typst_world);
        dbg!("=== EXPORT_FILE CALLED ===");
        dbg!(export_path);
        dbg!(format.clone());

        if let Ok(doc) = result.output {
            match format {
                ExportFormat::Pdf => {
                    dbg!("=== EXPORT_PDF CALLED ===");
                    dbg!(export_path);
                    dbg!(format.clone());

                    export_pdf(&doc, export_path)?;
                }
            }
        } else {
            dbg!("=== EXPORT_FILE FAILED ===");

            eprintln!("Failed to compile document: {:?}", result.output);
            return Err(());
        }

        Ok(())
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
                let diagnostic_span = warning.clone().span;
                dbg!(diagnostic_span.clone());
                dbg!(warning.clone());
                let diagnostic_range = self.typst_world.range(diagnostic_span).unwrap_or_default();
                let world_source = self
                    .typst_world
                    .source(diagnostic_span.id().unwrap_or(self.typst_world.main()));

                let diagnostic_position = match world_source {
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
                    Err(_) => DiagnosticPosition {
                        line: 0,
                        column: 0,
                        end_line: 0,
                        end_column: 0,
                    },
                };
                let hints =
                    SourceDiagnostic::with_hints(warning.clone(), warning.clone().hints).hints;

                let diagnostic = TypstSourceDiagnostic {
                    hints: hints.iter().map(|s| s.to_string()).collect(),
                    location: diagnostic_position,
                    severity: match warning.severity {
                        Severity::Error => TypstSeverity::Error,
                        Severity::Warning => TypstSeverity::Warning,
                    },
                    message: warning.message.to_string(),
                };

                warnings.push(diagnostic);
            }

            match warned.output {
                Ok(doc) => {
                    self.compilation_cache = Some(doc.clone());
                    let pages = doc.pages;

                    return Ok((pages, warnings));
                }
                Err(err) => {
                    let mut errors: Vec<TypstSourceDiagnostic> = vec![];
                    for e in err {
                        let diagnostic_range =
                            self.typst_world.range(e.clone().span).unwrap_or_default();

                        let world_source = self
                            .typst_world
                            .source(e.clone().span.id().unwrap_or(self.typst_world.main()));

                        let diagnostic_position = match world_source {
                            Ok(source) => {
                                let line = source.byte_to_line(diagnostic_range.start).unwrap_or(0);
                                let column =
                                    source.byte_to_column(diagnostic_range.start).unwrap_or(0);
                                let end_line =
                                    source.byte_to_line(diagnostic_range.end).unwrap_or(0);
                                let end_column =
                                    source.byte_to_column(diagnostic_range.end).unwrap_or(0);
                                DiagnosticPosition {
                                    line: line + 1,
                                    column: column + 1,
                                    end_line: end_line + 1,
                                    end_column: end_column + 1,
                                }
                            }
                            Err(_) => DiagnosticPosition {
                                line: 0,
                                column: 0,
                                end_line: 0,
                                end_column: 0,
                            },
                        };
                        dbg!(diagnostic_range.clone());
                        dbg!(diagnostic_position.clone());

                        let hints = SourceDiagnostic::with_hints(e.clone(), e.clone().hints).hints;

                        let diagnostic = TypstSourceDiagnostic {
                            hints: hints.iter().map(|s| s.to_string()).collect(),
                            location: diagnostic_position,
                            severity: match e.clone().severity {
                                Severity::Error => TypstSeverity::Error,
                                Severity::Warning => TypstSeverity::Warning,
                            },
                            message: e.clone().message.to_string(),
                        };
                        // dbg!(diagnostic.clone());
                        errors.push(diagnostic);
                    }
                    let mut all_diagnostics = warnings.clone();

                    all_diagnostics.extend(errors);

                    return Err(all_diagnostics);
                }
            }
        } else {
            dbg!("{} file not found", path.display());
            Err(vec![])
        }
    }

    pub fn render_current_pages(&mut self, pages: Vec<Page>, scale: f32) -> Vec<RenderResponse> {
        self.render_scale = scale; // Store the scale for coordinate transformations
        println!("=== Render Debug ===");
        println!("Render scale (pixels per point): {:.2}", scale);

        let mut rendered_pages = Vec::new();
        for (i, page) in pages.iter().enumerate() {
            let frame_size = page.frame.size();
            println!(
                "Page {}: Frame size: {:.1} x {:.1} pt",
                i,
                frame_size.x.to_pt(),
                frame_size.y.to_pt()
            );

            let bmp = render(&page, scale);
            println!(
                "Page {}: Rendered size: {} x {} px",
                i,
                bmp.width(),
                bmp.height()
            );

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

    pub fn refresh(&mut self) {
        self.entries = std::fs::read_dir(&self.root)
            .unwrap()
            .map(|res| res.unwrap().path())
            .collect();
    }

    pub fn get_compilation_cache(&self) -> Option<&PagedDocument> {
        self.compilation_cache.as_ref()
    }

    pub fn get_render_scale(&self) -> f32 {
        self.render_scale
    }

    // currently only handles clicks that result in a jump to a file or position
    // returns the byte position
    // TODO: handle the other cases

    pub fn document_click(
        &self,
        source_text: String,
        doc: &PagedDocument,
        frame: &Frame,
        click: &Point,
    ) -> DocumentClickResponseType {
        let pos = jump_from_click(&self.typst_world, doc, frame, *click);

        match pos {
            // move the editor cursor to the given byte position in the given file
            Some(Jump::File(file_id, position)) => {
                if let Some(file_path) = self.typst_world.get_file_path(file_id) {
                    DocumentClickResponseType::FileJump(FileJump {
                        file: file_path,
                        position: byte_position_to_char_position(&source_text, position),
                    })
                } else {
                    DocumentClickResponseType::NoJump
                }
            }
            // scroll the preview to the given page and point
            Some(Jump::Position(position)) => {
                println!(
                    "Jump to page: {} at point: ({}, {})",
                    position.page,
                    position.point.x.to_pt(),
                    position.point.y.to_pt()
                );

                DocumentClickResponseType::PositionJump(PositionJump {
                    page: position.page.into(),
                    x: position.point.x.to_pt(),
                    y: position.point.y.to_pt(),
                })
            }
            // open the given URL in the default browser
            Some(Jump::Url(url)) => {
                println!("Jump to URL: {}", url.as_str());

                DocumentClickResponseType::NoJump
            }

            None => {
                println!("No jump target found at the clicked position.");
                DocumentClickResponseType::NoJump
            }
        }
    }

    pub fn get_completion(
        &self,
        source_text: String,
        doc: &PagedDocument,
        cursor: usize,
        explicit: bool,
    ) -> Option<CompletionResponse> {
        let id = self.typst_world.main();
        let source = self.typst_world.source(id).ok()?;
        let completions = autocomplete(&self.typst_world, Some(doc), &source, cursor, explicit);
        if let Some((position, completions)) = completions {
            Some(CompletionResponse {
                completions,
                char_position: byte_position_to_char_position(&source_text, position),
            })
        } else {
            None
        }
    }

    pub fn tooltip_info(
        &self,
        source_text: String,
        char_position: usize,
    ) -> Option<TooltipResponse> {
        let id = self.typst_world.main();
        let source = self.typst_world.source(id).ok()?;
        let cursor = char_to_byte_position(&source_text, char_position);
        let document = self.get_compilation_cache();
        let side = typst_syntax::Side::Before;
        let info = tooltip(&self.typst_world, document, &source, cursor, side);
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
    // pub fn set_active_file(&mut self, path: PathBuf) {
    //     if self.active_files.contains(&path) {
    //         self.current_file = Some(path);
    //     }
    // }
}

fn export_pdf(document: &PagedDocument, export_path: &PathBuf) -> Result<(), ()> {
    eprintln!("=== EXPORT_PDF CALLED ===");
    eprintln!("Export path: {:?}", export_path);
    eprintln!(
        "Export path (absolute): {:?}",
        std::fs::canonicalize(export_path.parent().unwrap_or(export_path))
    );

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

    eprintln!("Generating PDF buffer...");

    let buffer = typst_pdf::pdf(document, &options).map_err(|e| {
        e.iter().for_each(|err| {
            println!(
                "Failed to generate PDF: {} - {}",
                err.message.to_string(),
                err.hints.join(", ")
            )
        });
        ()
    })?;

    eprintln!("Buffer size: {} bytes", buffer.len());
    eprintln!("Writing to disk...");

    std::fs::write(export_path, buffer).map_err(|e| {
        println!("Failed to write PDF to file: {}", e);
        ()
    })?;
    eprintln!("PDF written successfully!");
    eprintln!("Verifying file exists: {}", export_path.exists());

    Ok(())
}

/// Convert [`chrono::DateTime`] to [`Datetime`]
fn convert_datetime<Tz: chrono::TimeZone>(date_time: chrono::DateTime<Tz>) -> Option<Datetime> {
    Datetime::from_ymd_hms(
        date_time.year(),
        date_time.month().try_into().ok()?,
        date_time.day().try_into().ok()?,
        date_time.hour().try_into().ok()?,
        date_time.minute().try_into().ok()?,
        date_time.second().try_into().ok()?,
    )
}
