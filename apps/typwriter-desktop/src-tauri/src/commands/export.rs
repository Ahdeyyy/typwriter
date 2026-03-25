// commands/export.rs
//
// Tauri commands for exporting the compiled document to different formats.
// All export commands operate on the most recently compiled `Document` stored
// inside `PreviewPipeline`.

use std::{sync::Arc, time::Instant};

use log::{error, info};
use tauri::State;

use crate::compiler::{PdfExportConfig, PngExportConfig, PreviewPipeline, SvgExportConfig};

#[tauri::command]
pub fn export_pdf(
    config: PdfExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!(
        "export_pdf: path={:?} title={:?} author={:?}",
        config.path, config.title, config.author
    );
    let result = pipeline.export_pdf(config);
    match &result {
        Ok(_) => info!(
            "export_pdf: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "export_pdf: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command]
pub fn export_png(
    config: PngExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!(
        "export_png: dir={:?} scale={:?} prefix={:?}",
        config.dir, config.scale, config.prefix
    );
    let result = pipeline.export_png(config);
    match &result {
        Ok(_) => info!(
            "export_png: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "export_png: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

#[tauri::command]
pub fn export_svg(
    config: SvgExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!(
        "export_svg: dir={:?} prefix={:?}",
        config.dir, config.prefix
    );
    let result = pipeline.export_svg(config);
    match &result {
        Ok(_) => info!(
            "export_svg: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "export_svg: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}
