// Exports: PDF, PNG, SVG, HTML, multi-page ZIP/folder packaging, and share cache.
// Everything runs async — Android SAF file pickers and dialogs block until the user
// responds, so their bodies hop to `spawn_blocking`.

use std::{path::Path, sync::Arc, time::Instant};

use base64::prelude::*;
use log::info;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{compiler::CompileState, renderer::render_page, world::MobileWorld};

// ─── Export Configs ──────────────────────────────────────────────────────────

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportOptions {
    pub page_range: Option<String>,
    pub standard: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub include_date: Option<bool>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PngExportOptions {
    pub page_range: Option<String>,
    pub scale: Option<f32>,
    pub package_mode: Option<String>, // "zip" | "folder"
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SvgExportOptions {
    pub page_range: Option<String>,
    pub package_mode: Option<String>, // "zip" | "folder"
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HtmlExportOptions {
    pub pretty: Option<bool>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportShareOptions {
    pub format: String, // "pdf" | "png" | "svg" | "html"
    pub page_range: Option<String>,
    pub scale: Option<f32>,
    pub standard: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub pretty: Option<bool>,
    pub package_mode: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportShareResult {
    pub file_path: String,
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn parse_page_indices(range_str: &str, total_pages: usize) -> Result<Vec<usize>, String> {
    let mut indices = Vec::new();
    for part in range_str.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let start: usize = a
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page number: '{}'", a.trim()))?;
            let end: usize = b
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page number: '{}'", b.trim()))?;
            if start == 0 || end == 0 {
                return Err("Page numbers must be 1 or greater".into());
            }
            if start > end {
                return Err(format!("Invalid range: {start}-{end}"));
            }
            if end > total_pages {
                return Err(format!(
                    "Page {end} exceeds document length ({total_pages})"
                ));
            }
            for p in start..=end {
                indices.push(p - 1);
            }
        } else {
            let p: usize = part
                .parse()
                .map_err(|_| format!("Invalid page number: '{part}'"))?;
            if p == 0 {
                return Err("Page numbers must be 1 or greater".into());
            }
            if p > total_pages {
                return Err(format!("Page {p} exceeds document length ({total_pages})"));
            }
            indices.push(p - 1);
        }
    }
    if indices.is_empty() {
        return Err("No pages specified".into());
    }
    indices.sort();
    indices.dedup();
    Ok(indices)
}

fn parse_pdf_standard(s: &str) -> Result<typst_pdf::PdfStandards, String> {
    use typst_pdf::PdfStandard;
    let mut standards = Vec::new();
    for part in s.split(['+', ',']) {
        let part = part.trim().to_lowercase();
        if part.is_empty() {
            continue;
        }
        let standard = match part.as_str() {
            "1.4" => PdfStandard::V_1_4,
            "1.5" => PdfStandard::V_1_5,
            "1.6" => PdfStandard::V_1_6,
            "1.7" => PdfStandard::V_1_7,
            "2.0" => PdfStandard::V_2_0,
            "a-1b" => PdfStandard::A_1b,
            "a-1a" => PdfStandard::A_1a,
            "a-2b" => PdfStandard::A_2b,
            "a-2u" => PdfStandard::A_2u,
            "a-2a" => PdfStandard::A_2a,
            "a-3b" => PdfStandard::A_3b,
            "a-3u" => PdfStandard::A_3u,
            "a-3a" => PdfStandard::A_3a,
            "a-4" => PdfStandard::A_4,
            "a-4f" => PdfStandard::A_4f,
            "a-4e" => PdfStandard::A_4e,
            "ua-1" => PdfStandard::Ua_1,
            other => return Err(format!("Unknown PDF standard: '{other}'")),
        };
        standards.push(standard);
    }
    if standards.is_empty() {
        return Err("No PDF standard specified".into());
    }
    typst_pdf::PdfStandards::new(&standards).map_err(|e| format!("Invalid PDF standard: {e:?}"))
}

/// Stem of the main file (e.g. "main" for "main.typ"), for the suggested name.
fn main_stem(world: &MobileWorld) -> String {
    world
        .main_id()
        .and_then(|id| {
            Path::new(id.vpath().get_without_slash())
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "document".to_string())
}

fn parse_to_page_ranges(
    range_str: &str,
    total_pages: usize,
) -> Result<Vec<typst_library::layout::PageRange>, String> {
    use std::num::NonZeroUsize;
    let mut ranges = Vec::new();
    for part in range_str.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let start: usize = a
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page number: '{}'", a.trim()))?;
            let end: usize = b
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page number: '{}'", b.trim()))?;
            if start == 0 || end == 0 {
                return Err("Page numbers must be 1 or greater".into());
            }
            if start > end {
                return Err(format!("Invalid range: {start}-{end}"));
            }
            if end > total_pages {
                return Err(format!(
                    "Page {end} exceeds document length ({total_pages})"
                ));
            }
            ranges.push(NonZeroUsize::new(start)..=NonZeroUsize::new(end));
        } else {
            let p: usize = part
                .parse()
                .map_err(|_| format!("Invalid page number: '{part}'"))?;
            if p == 0 {
                return Err("Page numbers must be 1 or greater".into());
            }
            if p > total_pages {
                return Err(format!("Page {p} exceeds document length ({total_pages})"));
            }
            ranges.push(NonZeroUsize::new(p)..=NonZeroUsize::new(p));
        }
    }
    if ranges.is_empty() {
        return Err("No pages specified".into());
    }
    Ok(ranges)
}

// ─── Rendering Core ──────────────────────────────────────────────────────────

fn render_pdf_bytes(
    state: &CompileState,
    options: &PdfExportOptions,
) -> Result<Vec<u8>, String> {
    let orig_doc = state
        .document
        .lock()
        .as_ref()
        .ok_or_else(|| "Nothing compiled yet — open the preview first".to_string())?
        .clone();

    let mut doc = (*orig_doc).clone();

    let page_ranges = if let Some(range_str) = &options.page_range {
        if !range_str.trim().is_empty() {
            let ranges = parse_to_page_ranges(range_str, doc.pages().len())?;
            Some(typst_library::layout::PageRanges::new(ranges))
        } else {
            None
        }
    } else {
        None
    };

    if let Some(title) = &options.title {
        if !title.trim().is_empty() {
            doc.info_mut().title = Some(title.trim().into());
        }
    }
    if let Some(author) = &options.author {
        if !author.trim().is_empty() {
            doc.info_mut().author = vec![author.trim().into()];
        }
    }

    let standards = match &options.standard {
        Some(s) if !s.trim().is_empty() => parse_pdf_standard(s)?,
        _ => typst_pdf::PdfStandards::default(),
    };

    let timestamp = if options.include_date.unwrap_or(false) {
        use chrono::{Datelike, Timelike};
        let now = chrono::Local::now();
        typst::foundations::Datetime::from_ymd_hms(
            now.year(),
            now.month() as u8,
            now.day() as u8,
            now.hour() as u8,
            now.minute() as u8,
            now.second() as u8,
        )
        .map(typst_pdf::Timestamp::new_utc)
    } else {
        None
    };

    let pdf_options = typst_pdf::PdfOptions {
        ident: typst::foundations::Smart::Auto,
        creator: typst::foundations::Smart::Custom(Some("Typwriter".into())),
        timestamp,
        page_ranges,
        standards,
        tagged: true,
        pretty: false,
    };

    typst_pdf::pdf(&doc, &pdf_options).map_err(|diags| {
        diags
            .iter()
            .map(|d| d.message.to_string())
            .collect::<Vec<_>>()
            .join("; ")
    })
}

fn render_png_pages(
    state: &CompileState,
    page_range: Option<&str>,
    scale: f32,
    prefix: &str,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let doc = state
        .document
        .lock()
        .as_ref()
        .ok_or_else(|| "Nothing compiled yet — open the preview first".to_string())?
        .clone();

    let total = doc.pages().len();
    if total == 0 {
        return Err("Document has no pages".into());
    }

    let indices = match page_range {
        Some(s) if !s.trim().is_empty() => parse_page_indices(s, total)?,
        _ => (0..total).collect(),
    };

    let mut pages = Vec::with_capacity(indices.len());
    for &i in &indices {
        let page = &doc.pages()[i];
        let bytes = render_page(page, scale)?;
        let name = if indices.len() == 1 && total == 1 {
            format!("{prefix}.png")
        } else {
            format!("{prefix}-{}.png", i + 1)
        };
        pages.push((name, bytes));
    }
    Ok(pages)
}

fn render_svg_pages(
    state: &CompileState,
    page_range: Option<&str>,
    prefix: &str,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let doc = state
        .document
        .lock()
        .as_ref()
        .ok_or_else(|| "Nothing compiled yet — open the preview first".to_string())?
        .clone();

    let total = doc.pages().len();
    if total == 0 {
        return Err("Document has no pages".into());
    }

    let indices = match page_range {
        Some(s) if !s.trim().is_empty() => parse_page_indices(s, total)?,
        _ => (0..total).collect(),
    };

    let svg_opts = typst_svg::SvgOptions::default();
    let mut pages = Vec::with_capacity(indices.len());
    for &i in &indices {
        let page = &doc.pages()[i];
        let svg = typst_svg::svg(page, &svg_opts);
        let name = if indices.len() == 1 && total == 1 {
            format!("{prefix}.svg")
        } else {
            format!("{prefix}-{}.svg", i + 1)
        };
        pages.push((name, svg.into_bytes()));
    }
    Ok(pages)
}

fn render_html_bytes(world: &MobileWorld, pretty: bool) -> Result<Vec<u8>, String> {
    if !world.has_main() {
        return Err("No main file set".to_string());
    }
    let _ = world.wait_for_fonts(std::time::Duration::from_secs(10));

    let warned = typst::compile::<typst_html::HtmlDocument>(world);
    let doc = warned.output.map_err(|diags| {
        diags
            .iter()
            .map(|d| d.message.to_string())
            .collect::<Vec<_>>()
            .join("; ")
    })?;

    let options = typst_html::HtmlOptions { pretty };
    let html = typst_html::html(&doc, &options).map_err(|diags| {
        diags
            .iter()
            .map(|d| d.message.to_string())
            .collect::<Vec<_>>()
            .join("; ")
    })?;
    Ok(html.into_bytes())
}

fn create_zip_archive(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let mut buf = std::io::Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(&mut buf);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (name, data) in files {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(data).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

// ─── Save Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    config: PdfExportOptions,
) -> Result<String, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let bytes = render_pdf_bytes(&compile, &config)?;
        let suggested = format!("{}.pdf", main_stem(&world));
        save_single_file(&app, &suggested, "application/pdf", &bytes, "PDF", "pdf")?;
        info!("export_pdf: ok {suggested} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(suggested)
    })
    .await
    .map_err(|e| format!("export task panicked: {e}"))?
}

#[tauri::command]
pub async fn export_png(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    config: PngExportOptions,
) -> Result<String, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let stem = main_stem(&world);
        let scale = config.scale.unwrap_or(2.0);
        let pages = render_png_pages(&compile, config.page_range.as_deref(), scale, &stem)?;

        if pages.len() == 1 {
            let (filename, bytes) = &pages[0];
            save_single_file(&app, filename, "image/png", bytes, "PNG image", "png")?;
            info!("export_png: ok single {filename} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            return Ok(filename.clone());
        }

        let package_mode = config.package_mode.as_deref().unwrap_or("zip");
        if package_mode == "folder" {
            save_files_to_folder(&app, &pages, "image/png")?;
            info!("export_png: ok folder {} pages ({:.1}ms)", pages.len(), t.elapsed().as_secs_f64() * 1000.0);
            Ok(format!("{} images to folder", pages.len()))
        } else {
            let zip_name = format!("{stem}-png.zip");
            let zip_bytes = create_zip_archive(&pages)?;
            save_single_file(&app, &zip_name, "application/zip", &zip_bytes, "ZIP archive", "zip")?;
            info!("export_png: ok zip {zip_name} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            Ok(zip_name)
        }
    })
    .await
    .map_err(|e| format!("export task panicked: {e}"))?
}

#[tauri::command]
pub async fn export_svg(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    config: SvgExportOptions,
) -> Result<String, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let stem = main_stem(&world);
        let pages = render_svg_pages(&compile, config.page_range.as_deref(), &stem)?;

        if pages.len() == 1 {
            let (filename, bytes) = &pages[0];
            save_single_file(&app, filename, "image/svg+xml", bytes, "SVG image", "svg")?;
            info!("export_svg: ok single {filename} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            return Ok(filename.clone());
        }

        let package_mode = config.package_mode.as_deref().unwrap_or("zip");
        if package_mode == "folder" {
            save_files_to_folder(&app, &pages, "image/svg+xml")?;
            info!("export_svg: ok folder {} pages ({:.1}ms)", pages.len(), t.elapsed().as_secs_f64() * 1000.0);
            Ok(format!("{} SVGs to folder", pages.len()))
        } else {
            let zip_name = format!("{stem}-svg.zip");
            let zip_bytes = create_zip_archive(&pages)?;
            save_single_file(&app, &zip_name, "application/zip", &zip_bytes, "ZIP archive", "zip")?;
            info!("export_svg: ok zip {zip_name} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
            Ok(zip_name)
        }
    })
    .await
    .map_err(|e| format!("export task panicked: {e}"))?
}

#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    config: HtmlExportOptions,
) -> Result<String, String> {
    let world = world.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let bytes = render_html_bytes(&world, config.pretty.unwrap_or(false))?;
        let suggested = format!("{}.html", main_stem(&world));
        save_single_file(&app, &suggested, "text/html", &bytes, "HTML document", "html")?;
        info!("export_html: ok {suggested} ({:.1}ms)", t.elapsed().as_secs_f64() * 1000.0);
        Ok(suggested)
    })
    .await
    .map_err(|e| format!("export task panicked: {e}"))?
}

// ─── Share Cache Command ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_for_share(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
    config: ExportShareOptions,
) -> Result<ExportShareResult, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let stem = main_stem(&world);
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("export");
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

        match config.format.as_str() {
            "png" => {
                let scale = config.scale.unwrap_or(2.0);
                let pages = render_png_pages(&compile, config.page_range.as_deref(), scale, &stem)?;
                if pages.len() == 1 {
                    let (name, bytes) = &pages[0];
                    let path = cache_dir.join(name);
                    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
                    Ok(ExportShareResult {
                        file_path: path.to_string_lossy().into_owned(),
                        file_name: name.clone(),
                        mime_type: "image/png".into(),
                        data_base64: BASE64_STANDARD.encode(bytes),
                    })
                } else {
                    let zip_name = format!("{stem}-png.zip");
                    let zip_bytes = create_zip_archive(&pages)?;
                    let path = cache_dir.join(&zip_name);
                    std::fs::write(&path, &zip_bytes).map_err(|e| e.to_string())?;
                    Ok(ExportShareResult {
                        file_path: path.to_string_lossy().into_owned(),
                        file_name: zip_name,
                        mime_type: "application/zip".into(),
                        data_base64: BASE64_STANDARD.encode(&zip_bytes),
                    })
                }
            }
            "svg" => {
                let pages = render_svg_pages(&compile, config.page_range.as_deref(), &stem)?;
                if pages.len() == 1 {
                    let (name, bytes) = &pages[0];
                    let path = cache_dir.join(name);
                    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
                    Ok(ExportShareResult {
                        file_path: path.to_string_lossy().into_owned(),
                        file_name: name.clone(),
                        mime_type: "image/svg+xml".into(),
                        data_base64: BASE64_STANDARD.encode(bytes),
                    })
                } else {
                    let zip_name = format!("{stem}-svg.zip");
                    let zip_bytes = create_zip_archive(&pages)?;
                    let path = cache_dir.join(&zip_name);
                    std::fs::write(&path, &zip_bytes).map_err(|e| e.to_string())?;
                    Ok(ExportShareResult {
                        file_path: path.to_string_lossy().into_owned(),
                        file_name: zip_name,
                        mime_type: "application/zip".into(),
                        data_base64: BASE64_STANDARD.encode(&zip_bytes),
                    })
                }
            }
            "html" => {
                let bytes = render_html_bytes(&world, config.pretty.unwrap_or(false))?;
                let file_name = format!("{stem}.html");
                let path = cache_dir.join(&file_name);
                std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
                Ok(ExportShareResult {
                    file_path: path.to_string_lossy().into_owned(),
                    file_name,
                    mime_type: "text/html".into(),
                    data_base64: BASE64_STANDARD.encode(&bytes),
                })
            }
            _ => {
                // Default to PDF
                let pdf_opts = PdfExportOptions {
                    page_range: config.page_range,
                    standard: config.standard,
                    title: config.title,
                    author: config.author,
                    include_date: None,
                };
                let bytes = render_pdf_bytes(&compile, &pdf_opts)?;
                let file_name = format!("{stem}.pdf");
                let path = cache_dir.join(&file_name);
                std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
                Ok(ExportShareResult {
                    file_path: path.to_string_lossy().into_owned(),
                    file_name,
                    mime_type: "application/pdf".into(),
                    data_base64: BASE64_STANDARD.encode(&bytes),
                })
            }
        }
    })
    .await
    .map_err(|e| format!("export task panicked: {e}"))?
}

// ─── Platform File IO Primitives ─────────────────────────────────────────────

fn save_single_file(
    app: &AppHandle,
    suggested_name: &str,
    _mime_type: &str,
    bytes: &[u8],
    _filter_name: &str,
    _filter_ext: &str,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        let api = app.android_fs();
        let uri = api
            .file_picker()
            .save_file(None, suggested_name, Some(_mime_type), false)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Export cancelled".to_string())?;
        api.write(&uri, bytes).map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let path = app
            .dialog()
            .file()
            .add_filter(_filter_name, &[_filter_ext])
            .set_file_name(suggested_name)
            .blocking_save_file()
            .ok_or_else(|| "Export cancelled".to_string())?;
        let path = path
            .into_path()
            .map_err(|e| format!("Invalid save path: {e}"))?;
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn save_files_to_folder(
    app: &AppHandle,
    files: &[(String, Vec<u8>)],
    _mime_type: &str,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        let api = app.android_fs();
        let dest = api
            .file_picker()
            .pick_dir(None, false)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Export cancelled".to_string())?;
        for (rel, bytes) in files {
            let uri = api
                .create_new_file(&dest, rel, Some(_mime_type))
                .map_err(|e| e.to_string())?;
            api.write(&uri, bytes).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let picked = app
            .dialog()
            .file()
            .blocking_pick_folder()
            .ok_or_else(|| "Export cancelled".to_string())?;
        let dest = picked
            .into_path()
            .map_err(|e| format!("Invalid folder: {e}"))?;
        for (rel, bytes) in files {
            let target = dest.join(rel);
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

// ─── Legacy / Compatibility Commands ─────────────────────────────────────────

#[tauri::command]
pub async fn export_pdf_to_uri(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<String, String> {
    export_pdf(
        app,
        world,
        compile,
        PdfExportOptions {
            page_range: None,
            standard: None,
            title: None,
            author: None,
            include_date: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn export_pdf_to_cache_file(
    app: AppHandle,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<String, String> {
    let res = export_for_share(
        app,
        world,
        compile,
        ExportShareOptions {
            format: "pdf".into(),
            page_range: None,
            scale: None,
            standard: None,
            title: None,
            author: None,
            pretty: None,
            package_mode: None,
        },
    )
    .await?;
    Ok(res.file_path)
}

#[tauri::command]
pub async fn export_workspace(name: String, app: AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || export_workspace_blocking(&app, &name))
        .await
        .map_err(|e| format!("export task panicked: {e}"))?
}

fn export_workspace_blocking(app: &AppHandle, name: &str) -> Result<usize, String> {
    let t = Instant::now();
    let src = crate::commands::workspace::root_dir(app).join(name);
    if !src.is_dir() {
        return Err(format!("Workspace \"{name}\" not found"));
    }

    let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
    collect_files(&src, &src, &mut files)?;
    if files.is_empty() {
        return Err("The workspace has no files to export".into());
    }

    #[cfg(target_os = "android")]
    let copied = {
        use tauri_plugin_android_fs::AndroidFsExt;
        let api = app.android_fs();
        let dest = api
            .file_picker()
            .pick_dir(None, false)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Export cancelled".to_string())?;
        let mut copied = 0usize;
        for (rel, abs) in &files {
            let bytes = std::fs::read(abs).map_err(|e| e.to_string())?;
            let uri = api
                .create_new_file(&dest, format!("{name}/{rel}"), None)
                .map_err(|e| e.to_string())?;
            api.write(&uri, &bytes).map_err(|e| e.to_string())?;
            copied += 1;
        }
        copied
    };

    #[cfg(not(target_os = "android"))]
    let copied = {
        use tauri_plugin_dialog::DialogExt;
        let picked = app
            .dialog()
            .file()
            .blocking_pick_folder()
            .ok_or_else(|| "Export cancelled".to_string())?;
        let dest = picked
            .into_path()
            .map_err(|e| format!("Invalid folder: {e}"))?
            .join(name);
        let mut copied = 0usize;
        for (rel, abs) in &files {
            let target = dest.join(rel);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(abs, &target).map_err(|e| e.to_string())?;
            copied += 1;
        }
        copied
    };

    info!(
        "export_workspace: {name:?} {copied} files ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );
    Ok(copied)
}

fn collect_files(
    dir: &Path,
    root: &Path,
    out: &mut Vec<(String, std::path::PathBuf)>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files(&path, root, out)?;
        } else {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, path));
        }
    }
    Ok(())
}
