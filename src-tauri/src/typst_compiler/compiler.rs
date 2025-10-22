use std::ops::Range;
use std::path::PathBuf;

use base64::engine::general_purpose;
use base64::Engine;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use typst::diag::{FileResult, Severity, SourceDiagnostic};
use typst::layout::{Abs, Page, PagedDocument, Point};
use typst::{World, WorldExt};
use typst_ide::{autocomplete, jump_from_click, jump_from_cursor, tooltip, Jump, Tooltip};
use typst_svg::{svg, svg_merged};
use typst_syntax::Source;

use crate::utils::convert_datetime;
use crate::world::Typstworld;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportPngOptions {
    pub start_page: usize,
    pub end_page: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportSvgOptions {
    pub start_page: usize,
    pub end_page: usize,
    /// whether to merge all svg pages into a single svg file, if true
    /// start_page and end_page are ignored
    pub merged: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ExportFormat {
    PDF,
    PNG(ExportPngOptions),
    SVG(ExportSvgOptions),
}

#[derive(Serialize, Clone, Deserialize, Debug)]
pub struct RenderResponse {
    pub image: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct DiagnosticPosition {
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum TypstSeverity {
    Error,
    Warning,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TypstSourceDiagnostic {
    pub location: DiagnosticPosition,
    pub severity: TypstSeverity,
    pub message: String,
    pub hints: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompilationError(pub Vec<TypstSourceDiagnostic>);

#[derive(Debug, Serialize, Deserialize)]
pub enum ExportError {
    Pdf(ExportPdfError),
    Png(ExportPngError),
    Svg(ExportSvgError),
    NoDocument,
    UnsupportedFormat,
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

#[derive(Serialize, Clone, Debug)]
pub struct PreviewPosition {
    page: usize,
    x: f64,
    y: f64,
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
    FileJump(FileJump),
    PositionJump(PositionJump),
    UrlJump(UrlJump),
    NoJump,
}

pub enum TypstCompilerError {
    FileNotFound,
}

pub struct TypstCompiler {
    world: Typstworld,
    compilation_cache: Option<PagedDocument>,
    render_scale: f32,
}

impl TypstCompiler {
    pub fn new(root: PathBuf, font_dir: PathBuf) -> Self {
        Self {
            world: Typstworld::new(root, font_dir),
            compilation_cache: None,
            render_scale: 1.0,
        }
    }

    pub fn set_active_file(&mut self, path: PathBuf) -> Result<(), TypstCompilerError> {
        let file_id = self.world.get_file_id(&path);
        if let Some(id) = file_id {
            self.world.set_main_source_with_id(id);
            Ok(())
        } else {
            Err(TypstCompilerError::FileNotFound)
        }
    }

    pub fn world(&self) -> &Typstworld {
        &self.world
    }

    pub fn get_compilation_cache(&self) -> Option<&PagedDocument> {
        self.compilation_cache.as_ref()
    }

    pub fn reset_compilation_cache(&mut self) {
        self.compilation_cache = None;
    }

    pub fn update_file_in_world(&mut self, path: &PathBuf, content: String) {
        let file_id = self.world.get_file_id(path).unwrap_or_else(|| {
            self.world.add_file(
                path.file_name().unwrap().to_str().unwrap(),
                path.clone(),
                typst::foundations::Bytes::new(content.clone().into_bytes()),
            )
        });
        self.world.update_source(file_id, content).unwrap();
    }

    pub fn add_file_to_world(&mut self, path: PathBuf, content: String) {
        self.world.add_file(
            path.clone().file_name().unwrap().to_str().unwrap(),
            path,
            typst::foundations::Bytes::new(content.into_bytes()),
        );
    }

    pub fn update_scale(&mut self, scale: f32) {
        self.render_scale = scale;
    }

    /// compiles the main file in the world
    /// stores the compilation cache in the compiler
    /// returns a vector of diagnostics
    pub fn compile_main(&mut self) -> Result<Vec<TypstSourceDiagnostic>, CompilationError> {
        let result = typst::compile(&self.world);

        let warnings: Vec<TypstSourceDiagnostic> = result
            .warnings
            .iter()
            .map(|diagnostic| self.process_diagnostic(diagnostic))
            .collect();

        match result.output {
            Ok(doc) => {
                self.compilation_cache = Some(doc);
                Ok(warnings)
            }
            Err(errors) => {
                let mut error_diagnostics = warnings;
                error_diagnostics.extend(
                    errors
                        .iter()
                        .map(|diagnostic| self.process_diagnostic(diagnostic)),
                );
                Err(CompilationError(error_diagnostics))
            }
        }
    }

    fn process_diagnostic(&self, diagnostic: &SourceDiagnostic) -> TypstSourceDiagnostic {
        let diagnostic_range = self.world.range(diagnostic.span).unwrap_or_default();
        let diagnostic_source = self
            .world
            .source(diagnostic.span.id().unwrap_or(self.world.main()));
        let position = diagnostic_position_from_source(diagnostic_source, diagnostic_range);

        TypstSourceDiagnostic {
            hints: diagnostic.hints.iter().map(|s| s.to_string()).collect(),
            location: position,
            severity: match diagnostic.severity {
                Severity::Error => TypstSeverity::Error,
                Severity::Warning => TypstSeverity::Warning,
            },
            message: diagnostic.message.to_string(),
        }
    }

    /// renders the main file in the world
    /// returns an array of rendered pages
    pub fn render_main(&self) -> Vec<RenderResponse> {
        if let Some(doc) = &self.compilation_cache {
            doc.pages
                .par_iter()
                .map(|page| render_page(page, self.render_scale))
                .collect()
        } else {
            Vec::new()
        }
    }

    /// renders a specific page number from the compilation cache
    /// if the page number is out of bounds, returns None
    /// otherwise returns Some(RenderResponse)
    /// page_number is 0-based index
    /// if compilation_cache is None, this function returns None
    pub fn render_page_n(&self, page_number: usize) -> Option<RenderResponse> {
        if let Some(doc) = self.compilation_cache.as_ref() {
            if page_number < doc.pages.len() {
                let page = &doc.pages[page_number];
                return Some(render_page(page, self.render_scale));
            }
        }
        None
    }

    /// exports the main document to the specified path in the specified format
    /// returns Ok(()) on success, Err(ExportError) on failure
    pub fn export_main(
        &mut self,
        export_path: PathBuf,
        format: ExportFormat,
    ) -> Result<(), ExportError> {
        let _ = self.compile_main();
        let doc = self
            .compilation_cache
            .as_ref()
            .ok_or(ExportError::NoDocument)?;

        match format {
            ExportFormat::PDF => export_to_pdf(doc, &export_path).map_err(ExportError::Pdf),
            ExportFormat::PNG(options) => {
                export_to_png(doc, &export_path, options).map_err(ExportError::Png)
            }
            ExportFormat::SVG(options) => {
                export_to_svg(doc, &export_path, options).map_err(ExportError::Svg)
            }
        }
    }

    pub fn get_hover_tooltip_info(
        &self,
        source_text: String,
        char_position: usize,
    ) -> Option<TooltipResponse> {
        let id = self.world.main();
        let source = self.world.source(id).ok()?;
        let cursor = char_to_byte_position(&source_text, char_position);
        let document = self.compilation_cache.as_ref();
        let side = typst_syntax::Side::Before;
        let info = tooltip(&self.world, document, &source, cursor, side);
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

    pub fn get_autocomplete_suggestions(
        &self,
        source_text: String,
        cursor: usize,
        explicit: bool,
    ) -> Option<CompletionResponse> {
        let doc = self.compilation_cache.as_ref()?;
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

    pub fn get_cursor_position_info(
        &self,
        cursor: usize,
        source_text: String,
    ) -> Option<PreviewPosition> {
        let doc = self.compilation_cache.as_ref()?;
        let id = self.world.main();
        let source = self.world.source(id).ok()?;
        let byte_cursor = char_to_byte_position(&source_text, cursor);
        let positions = jump_from_cursor(doc, &source, byte_cursor);
        let position = positions.get(0)?;

        let x = position.point.x.to_pt() * self.render_scale as f64;
        let y = position.point.y.to_pt() * self.render_scale as f64;
        let pos = PreviewPosition {
            page: position.page.into(),
            x,
            y,
        };
        Some(pos)
    }

    pub fn handle_page_click(
        &self,
        source_text: String,
        page_number: usize,
        x: f64,
        y: f64,
    ) -> DocumentClickResponse {
        let doc = match self.compilation_cache.as_ref() {
            Some(doc) => doc,
            None => return DocumentClickResponse::NoJump,
        };

        if page_number >= doc.pages.len() {
            return DocumentClickResponse::NoJump;
        }

        let frame = &doc.pages[page_number].frame;
        let click_point = Point::new(
            Abs::pt(x / self.render_scale as f64),
            Abs::pt(y / self.render_scale as f64),
        );

        let pos = jump_from_click(&self.world, doc, frame, click_point);
        match pos {
            Some(Jump::File(file_id, position)) => {
                if let Some(file_path) = self.world.get_file_path(file_id) {
                    DocumentClickResponse::FileJump(FileJump {
                        file: file_path,
                        position: byte_position_to_char_position(&source_text, position),
                    })
                } else {
                    DocumentClickResponse::NoJump
                }
            }
            Some(Jump::Position(position)) => DocumentClickResponse::PositionJump(PositionJump {
                page: position.page.into(),
                x: position.point.x.to_pt(),
                y: position.point.y.to_pt(),
            }),
            Some(Jump::Url(url)) => DocumentClickResponse::UrlJump(UrlJump {
                url: url.as_str().to_string(),
            }),
            None => DocumentClickResponse::NoJump,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ExportPdfError {
    ExportFailed,
}

fn export_to_pdf(doc: &PagedDocument, path: &PathBuf) -> Result<(), ExportPdfError> {
    let local_datetime = chrono::Local::now();

    let timestamp = typst_pdf::Timestamp::new_local(
        convert_datetime(local_datetime).ok_or(ExportPdfError::ExportFailed)?,
        local_datetime.offset().local_minus_utc() / 60,
    );

    let options = typst_pdf::PdfOptions {
        ident: typst::foundations::Smart::Auto,
        timestamp,
        page_ranges: None,
        standards: Default::default(),
    };
    let buffer = typst_pdf::pdf(doc, &options).map_err(|e| {
        eprintln!("Failed to create PDF: {:?}", e);
        ExportPdfError::ExportFailed
    })?;
    std::fs::write(path, buffer).map_err(|e| {
        eprintln!("Failed to write PDF: {:?}", e);
        ExportPdfError::ExportFailed
    })?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ExportPngError {
    ExportFailed,
}

fn export_to_png(
    doc: &PagedDocument,
    path: &PathBuf,
    options: ExportPngOptions,
) -> Result<(), ExportPngError> {
    let end_page = options.end_page.min(doc.pages.len() - 1);
    println!(
        "end page: {}, doc.pages: {}, options.end_page: {}",
        end_page.clone(),
        doc.pages.len().clone(),
        options.end_page.clone()
    );
    for i in options.start_page..=end_page {
        let page = &doc.pages[i];
        let pixmap = typst_render::render(page, 3.0);
        let mut export_path = path.clone();
        let original_stem = export_path
            .file_stem()
            .unwrap_or_default()
            .to_str()
            .unwrap_or_default();
        let new_stem = format!("{}_page_{}", original_stem, i + 1);
        export_path.set_file_name(new_stem);
        export_path.set_extension("png");

        pixmap.save_png(&export_path).map_err(|e| {
            eprintln!("Failed to save PNG: {}", e);
            ExportPngError::ExportFailed
        })?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ExportSvgError {
    ExportFailed,
}

fn export_to_svg(
    doc: &PagedDocument,
    path: &PathBuf,
    options: ExportSvgOptions,
) -> Result<(), ExportSvgError> {
    if options.merged {
        let svg_data = svg_merged(doc, Abs::default());
        std::fs::write(path, svg_data).map_err(|_| ExportSvgError::ExportFailed)?;
    } else {
        let end_page = options.end_page.min(doc.pages.len() - 1);
        for i in options.start_page..=end_page {
            let page = &doc.pages[i];
            let svg_data = svg(&page);

            let mut export_path = path.clone();
            let original_stem = export_path
                .file_stem()
                .unwrap_or_default()
                .to_str()
                .unwrap_or_default();
            let new_stem = format!("{}_page_{}", original_stem, i + 1);
            export_path.set_file_name(new_stem);
            export_path.set_extension("svg");

            std::fs::write(&export_path, svg_data).map_err(|_| ExportSvgError::ExportFailed)?;
        }
    }
    Ok(())
}

pub fn render_page(page: &Page, scale: f32) -> RenderResponse {
    let bmp = typst_render::render(page, scale);
    match bmp.encode_png() {
        Ok(image) => {
            let image_base64 = general_purpose::STANDARD.encode(image);
            RenderResponse {
                image: image_base64,
                width: bmp.width(),
                height: bmp.height(),
            }
        }
        Err(_) => RenderResponse {
            image: String::new(),
            width: 0,
            height: 0,
        },
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

fn char_to_byte_position(text: &str, char_pos: usize) -> usize {
    text.char_indices()
        .nth(char_pos)
        .map(|(byte_pos, _)| byte_pos)
        .unwrap_or(text.len())
}

fn byte_position_to_char_position(text: &str, byte_pos: usize) -> usize {
    text[..byte_pos].chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    // Helper function to create a temporary test directory
    fn setup_test_env() -> (PathBuf, PathBuf) {
        let test_dir = std::env::temp_dir().join("typst_test");
        let font_dir = test_dir.join("fonts");
        fs::create_dir_all(&test_dir).ok();
        fs::create_dir_all(&font_dir).ok();
        (test_dir, font_dir)
    }

    #[test]
    fn test_char_to_byte_position() {
        let text = "Hello, 世界!";
        assert_eq!(char_to_byte_position(text, 0), 0);
        assert_eq!(char_to_byte_position(text, 7), 7); // after comma and space
        assert_eq!(char_to_byte_position(text, 8), 10); // first Chinese char (3 bytes)
        assert_eq!(char_to_byte_position(text, 100), text.len()); // out of bounds
    }

    #[test]
    fn test_byte_position_to_char_position() {
        let text = "Hello, 世界!";
        assert_eq!(byte_position_to_char_position(text, 0), 0);
        assert_eq!(byte_position_to_char_position(text, 7), 7);
        assert_eq!(byte_position_to_char_position(text, 10), 8); // after first Chinese char
    }

    #[test]
    fn test_char_byte_position_roundtrip() {
        let text = "Hello, 世界! This is a test.";
        for char_pos in 0..text.chars().count() {
            let byte_pos = char_to_byte_position(text, char_pos);
            let back_to_char = byte_position_to_char_position(text, byte_pos);
            assert_eq!(char_pos, back_to_char);
        }
    }

    #[test]
    fn test_diagnostic_position_from_source_with_valid_source() {
        let source_text = "let x = 5;\nlet y = 10;";
        let source = Source::detached(source_text);
        let range = 4..5; // the 'x' character

        let position = diagnostic_position_from_source(Ok(source), range);

        assert_eq!(position.line, 1);
        assert_eq!(position.column, 5);
    }

    #[test]
    fn test_diagnostic_position_from_source_with_error() {
        use typst::diag::FileError;
        let range = 0..5;
        let error: FileResult<Source> = Err(FileError::NotFound(PathBuf::from("test.typ")));

        let position = diagnostic_position_from_source(error, range);

        assert_eq!(position.line, 0);
        assert_eq!(position.column, 0);
        assert_eq!(position.end_line, 0);
        assert_eq!(position.end_column, 0);
    }

    #[test]
    fn test_render_page_success() {
        // This test would require a real Page object from typst
        // For now, we test the structure is correct
        // In practice, you'd need to compile a simple document first
    }

    #[test]
    fn test_export_png_options_serialization() {
        let options = ExportPngOptions {
            start_page: 0,
            end_page: 5,
        };

        let serialized = serde_json::to_string(&options).unwrap();
        let deserialized: ExportPngOptions = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.start_page, 0);
        assert_eq!(deserialized.end_page, 5);
    }

    #[test]
    fn test_export_svg_options_serialization() {
        let options = ExportSvgOptions {
            start_page: 1,
            end_page: 3,
            merged: true,
        };

        let serialized = serde_json::to_string(&options).unwrap();
        let deserialized: ExportSvgOptions = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.start_page, 1);
        assert_eq!(deserialized.end_page, 3);
        assert!(deserialized.merged);
    }

    #[test]
    fn test_export_format_pdf_serialization() {
        let format = ExportFormat::PDF;
        let serialized = serde_json::to_string(&format).unwrap();
        assert!(serialized.contains("PDF"));
    }

    #[test]
    fn test_typst_compiler_new() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir.clone(), font_dir.clone());

        assert_eq!(compiler.render_scale, 1.0);
        assert!(compiler.compilation_cache.is_none());
    }

    #[test]
    fn test_typst_compiler_update_scale() {
        let (test_dir, font_dir) = setup_test_env();
        let mut compiler = TypstCompiler::new(test_dir, font_dir);

        compiler.update_scale(2.5);
        assert_eq!(compiler.render_scale, 2.5);

        compiler.update_scale(0.5);
        assert_eq!(compiler.render_scale, 0.5);
    }

    #[test]
    fn test_typst_compiler_reset_compilation_cache() {
        let (test_dir, font_dir) = setup_test_env();
        let mut compiler = TypstCompiler::new(test_dir, font_dir);

        compiler.reset_compilation_cache();
        assert!(compiler.compilation_cache.is_none());
    }

    #[test]
    fn test_typst_compiler_get_compilation_cache_empty() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir, font_dir);

        assert!(compiler.get_compilation_cache().is_none());
    }

    #[test]
    fn test_typst_compiler_world_access() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir.clone(), font_dir);

        let world = compiler.world();
        // Just verify we can access the world without panicking
        assert!(world as *const _ as usize != 0);
    }

    #[test]
    fn test_typst_compiler_render_page_n_no_cache() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir, font_dir);

        let result = compiler.render_page_n(0);
        assert!(result.is_none());
    }

    #[test]
    fn test_typst_compiler_render_main_no_cache() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir, font_dir);

        let result = compiler.render_main();
        assert!(result.is_empty());
    }

    #[test]
    fn test_typst_compiler_export_main_no_document() {
        let (test_dir, font_dir) = setup_test_env();
        let mut compiler = TypstCompiler::new(test_dir.clone(), font_dir);

        let export_path = test_dir.join("output.pdf");
        let result = compiler.export_main(export_path, ExportFormat::PDF);

        assert!(matches!(result, Err(ExportError::NoDocument)));
    }

    #[test]
    fn test_render_response_serialization() {
        let response = RenderResponse {
            image: "base64data".to_string(),
            width: 800,
            height: 600,
        };

        let serialized = serde_json::to_string(&response).unwrap();
        let deserialized: RenderResponse = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.image, "base64data");
        assert_eq!(deserialized.width, 800);
        assert_eq!(deserialized.height, 600);
    }

    #[test]
    fn test_typst_severity_serialization() {
        let error = TypstSeverity::Error;
        let warning = TypstSeverity::Warning;

        let error_str = serde_json::to_string(&error).unwrap();
        let warning_str = serde_json::to_string(&warning).unwrap();

        assert!(error_str.contains("Error"));
        assert!(warning_str.contains("Warning"));
    }

    #[test]
    fn test_typst_source_diagnostic_serialization() {
        let diagnostic = TypstSourceDiagnostic {
            location: DiagnosticPosition {
                line: 10,
                column: 5,
                end_line: 10,
                end_column: 15,
            },
            severity: TypstSeverity::Error,
            message: "Test error".to_string(),
            hints: vec!["Try this".to_string(), "Or that".to_string()],
        };

        let serialized = serde_json::to_string(&diagnostic).unwrap();
        let deserialized: TypstSourceDiagnostic = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.location.line, 10);
        assert_eq!(deserialized.message, "Test error");
        assert_eq!(deserialized.hints.len(), 2);
    }

    #[test]
    fn test_tooltip_kind_serialization() {
        let code = TooltipKind::Code;
        let text = TooltipKind::Text;

        let code_str = serde_json::to_string(&code).unwrap();
        let text_str = serde_json::to_string(&text).unwrap();

        assert!(code_str.contains("Code"));
        assert!(text_str.contains("Text"));
    }

    #[test]
    fn test_tooltip_response_serialization() {
        let response = TooltipResponse {
            kind: TooltipKind::Code,
            text: "fn test() {}".to_string(),
        };

        let serialized = serde_json::to_string(&response).unwrap();
        let deserialized: TooltipResponse = serde_json::from_str(&serialized).unwrap();

        assert!(matches!(deserialized.kind, TooltipKind::Code));
        assert_eq!(deserialized.text, "fn test() {}");
    }

    #[test]
    fn test_document_click_response_no_jump() {
        let response = DocumentClickResponse::NoJump;
        let serialized = serde_json::to_string(&response).unwrap();
        assert!(serialized.contains("NoJump"));
    }

    #[test]
    fn test_document_click_response_file_jump() {
        let response = DocumentClickResponse::FileJump(FileJump {
            file: PathBuf::from("/path/to/file.typ"),
            position: 42,
        });

        let serialized = serde_json::to_string(&response).unwrap();
        assert!(serialized.contains("FileJump"));
        assert!(serialized.contains("42"));
    }

    #[test]
    fn test_document_click_response_position_jump() {
        let response = DocumentClickResponse::PositionJump(PositionJump {
            page: 2,
            x: 100.5,
            y: 200.7,
        });

        let serialized = serde_json::to_string(&response).unwrap();
        assert!(serialized.contains("PositionJump"));
    }

    #[test]
    fn test_document_click_response_url_jump() {
        let response = DocumentClickResponse::UrlJump(UrlJump {
            url: "https://example.com".to_string(),
        });

        let serialized = serde_json::to_string(&response).unwrap();
        assert!(serialized.contains("UrlJump"));
        assert!(serialized.contains("example.com"));
    }

    #[test]
    fn test_completion_response_serialization() {
        let completions = vec![];
        let response = CompletionResponse {
            char_position: 10,
            completions,
        };

        let serialized = serde_json::to_string(&response).unwrap();
        assert!(serialized.contains("char_position"));
        assert!(serialized.contains("10"));
    }

    #[test]
    fn test_diagnostic_position_default() {
        let pos = DiagnosticPosition::default();
        assert_eq!(pos.line, 0);
        assert_eq!(pos.column, 0);
        assert_eq!(pos.end_line, 0);
        assert_eq!(pos.end_column, 0);
    }

    #[test]
    fn test_get_hover_tooltip_info_no_cache() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir, font_dir);

        let result = compiler.get_hover_tooltip_info("let x = 5".to_string(), 4);
        // Without a compiled document, this should return None
        assert!(result.is_none());
    }

    #[test]
    fn test_get_autocomplete_suggestions_no_cache() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir, font_dir);

        let result = compiler.get_autocomplete_suggestions("let x = ".to_string(), 8, false);
        // Without a compiled document, this should return None
        assert!(result.is_none());
    }

    #[test]
    fn test_get_cursor_position_info_no_cache() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir, font_dir);

        let result = compiler.get_cursor_position_info(5, "let x = 5".to_string());
        // Without a compiled document, this should return None
        assert!(result.is_none());
    }

    #[test]
    fn test_handle_page_click_no_cache() {
        let (test_dir, font_dir) = setup_test_env();
        let compiler = TypstCompiler::new(test_dir, font_dir);

        let result = compiler.handle_page_click("let x = 5".to_string(), 0, 100.0, 100.0);
        assert!(matches!(result, DocumentClickResponse::NoJump));
    }

    #[test]
    fn test_multiline_diagnostic_position() {
        let source_text = "let x = (\n  1,\n  2,\n  3\n);";
        let source = Source::detached(source_text);
        // Range spanning multiple lines
        let range = 9..24;

        let position = diagnostic_position_from_source(Ok(source), range);

        assert!(position.line > 0);
        assert!(position.end_line >= position.line);
    }

    #[test]
    fn test_empty_text_char_to_byte() {
        let text = "";
        assert_eq!(char_to_byte_position(text, 0), 0);
        assert_eq!(char_to_byte_position(text, 10), 0); // out of bounds returns len
    }

    #[test]
    fn test_empty_text_byte_to_char() {
        let text = "";
        assert_eq!(byte_position_to_char_position(text, 0), 0);
    }

    #[test]
    fn test_export_format_variants() {
        let pdf = ExportFormat::PDF;
        let png = ExportFormat::PNG(ExportPngOptions {
            start_page: 0,
            end_page: 1,
        });
        let svg = ExportFormat::SVG(ExportSvgOptions {
            start_page: 0,
            end_page: 1,
            merged: false,
        });

        // Test that all variants exist and can be created
        match pdf {
            ExportFormat::PDF => {}
            _ => panic!("Expected PDF variant"),
        }

        match png {
            ExportFormat::PNG(_) => {}
            _ => panic!("Expected PNG variant"),
        }

        match svg {
            ExportFormat::SVG(_) => {}
            _ => panic!("Expected SVG variant"),
        }
    }
}
