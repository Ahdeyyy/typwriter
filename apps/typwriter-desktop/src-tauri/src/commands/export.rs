// commands/export.rs
//
// Tauri commands for exporting the compiled document to different formats.
// All export commands operate on the most recently compiled `Document` stored
// inside `PreviewPipeline`.

use std::{sync::Arc, time::Instant};

use log::{error, info};
use tauri::{AppHandle, State};
use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

use crate::compiler::{
    HtmlExportConfig, PdfExportConfig, PngExportConfig, PreviewPipeline, SvgExportConfig,
};

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

/// Android: export the compiled document to a PDF URI obtained from
/// `AndroidFs.showSaveFilePicker`. PDF generation is identical to `export_pdf`;
/// only the destination differs (content:// URI written via android-fs instead
/// of std::fs::write, which cannot handle SAF URIs).
#[tauri::command]
pub fn export_pdf_to_uri(
    file_uri: FileUri,
    config: PdfExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
    app: AppHandle,
) -> Result<(), String> {
    let t = Instant::now();
    info!(
        "export_pdf_to_uri: uri={:?} title={:?} author={:?}",
        file_uri.uri, config.title, config.author
    );
    let bytes = pipeline.export_pdf_bytes(config).map_err(|e| {
        error!("export_pdf_to_uri: pdf generation failed err=\"{e}\"");
        e
    })?;
    app.android_fs().write(&file_uri, &bytes).map_err(|e| {
        error!("export_pdf_to_uri: android_fs write failed err=\"{e}\"");
        e.to_string()
    })?;
    info!(
        "export_pdf_to_uri: ok - {} bytes ({:.1}ms)",
        bytes.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
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

#[tauri::command]
pub fn export_html(
    config: HtmlExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
) -> Result<(), String> {
    let t = Instant::now();
    info!("export_html: path={:?} pretty={:?}", config.path, config.pretty);
    let result = pipeline.export_html(config);
    match &result {
        Ok(_) => info!(
            "export_html: ok ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
        Err(e) => error!(
            "export_html: err=\"{e}\" ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        ),
    }
    result
}

/// Android: export the compiled document to an HTML URI obtained from
/// `AndroidFs.showSaveFilePicker`. HTML generation is identical to
/// `export_html`; only the destination differs (content:// URI written via
/// android-fs instead of std::fs::write).
#[tauri::command]
pub fn export_html_to_uri(
    file_uri: FileUri,
    config: HtmlExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
    app: AppHandle,
) -> Result<(), String> {
    let t = Instant::now();
    info!("export_html_to_uri: uri={:?} pretty={:?}", file_uri.uri, config.pretty);
    let bytes = pipeline
        .export_html_bytes(config.pretty.unwrap_or(false))
        .map_err(|e| {
            error!("export_html_to_uri: html generation failed err=\"{e}\"");
            e
        })?;
    app.android_fs().write(&file_uri, &bytes).map_err(|e| {
        error!("export_html_to_uri: android_fs write failed err=\"{e}\"");
        e.to_string()
    })?;
    info!(
        "export_html_to_uri: ok - {} bytes ({:.1}ms)",
        bytes.len(),
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

/// Android: export PNG pages into a directory URI obtained from
/// `AndroidFs.showOpenDirPicker`. Each page is written through android-fs.
/// `config.dir` is ignored — the directory comes from `dir_uri`.
#[tauri::command]
pub fn export_png_to_dir_uri(
    dir_uri: FileUri,
    config: PngExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
    app: AppHandle,
) -> Result<(), String> {
    let t = Instant::now();
    info!(
        "export_png_to_dir_uri: uri={:?} scale={:?} prefix={:?}",
        dir_uri.uri, config.scale, config.prefix
    );

    let pages = pipeline.export_png_pages(config).map_err(|e| {
        error!("export_png_to_dir_uri: render failed err=\"{e}\"");
        e
    })?;
    let count = pages.len();

    let api = app.android_fs();
    for (filename, bytes) in pages {
        let file_uri = api
            .create_new_file(&dir_uri, &filename, Some("image/png"))
            .map_err(|e| {
                error!(
                    "export_png_to_dir_uri: create_new_file failed name={filename:?} err=\"{e}\""
                );
                e.to_string()
            })?;
        api.write(&file_uri, &bytes).map_err(|e| {
            error!("export_png_to_dir_uri: write failed name={filename:?} err=\"{e}\"");
            e.to_string()
        })?;
    }

    info!(
        "export_png_to_dir_uri: ok - {count} page(s) ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

/// Android: export SVG pages into a directory URI obtained from
/// `AndroidFs.showOpenDirPicker`. Each page is written through android-fs.
/// `config.dir` is ignored — the directory comes from `dir_uri`.
#[tauri::command]
pub fn export_svg_to_dir_uri(
    dir_uri: FileUri,
    config: SvgExportConfig,
    pipeline: State<'_, Arc<PreviewPipeline>>,
    app: AppHandle,
) -> Result<(), String> {
    let t = Instant::now();
    info!(
        "export_svg_to_dir_uri: uri={:?} prefix={:?}",
        dir_uri.uri, config.prefix
    );

    let pages = pipeline.export_svg_pages(config).map_err(|e| {
        error!("export_svg_to_dir_uri: render failed err=\"{e}\"");
        e
    })?;
    let count = pages.len();

    let api = app.android_fs();
    for (filename, bytes) in pages {
        let file_uri = api
            .create_new_file(&dir_uri, &filename, Some("image/svg+xml"))
            .map_err(|e| {
                error!(
                    "export_svg_to_dir_uri: create_new_file failed name={filename:?} err=\"{e}\""
                );
                e.to_string()
            })?;
        api.write(&file_uri, &bytes).map_err(|e| {
            error!("export_svg_to_dir_uri: write failed name={filename:?} err=\"{e}\"");
            e.to_string()
        })?;
    }

    info!(
        "export_svg_to_dir_uri: ok - {count} page(s) ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}
