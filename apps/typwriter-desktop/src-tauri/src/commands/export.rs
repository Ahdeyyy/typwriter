// commands/export.rs
//
// Tauri commands for exporting the compiled document to different formats.
// All export commands operate on the most recently compiled `Document` stored
// inside `PreviewPipeline`.

use std::sync::Arc;

use tauri::State;

use crate::compiler::{PdfExportConfig, PngExportConfig, PreviewPipeline, SvgExportConfig};

#[tauri::command]
pub fn export_pdf(
    config: PdfExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<(), String> {
    pipeline.export_pdf(config)
}

#[tauri::command]
pub fn export_png(
    config: PngExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<(), String> {
    pipeline.export_png(config)
}

#[tauri::command]
pub fn export_svg(
    config: SvgExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<(), String> {
    pipeline.export_svg(config)
}
