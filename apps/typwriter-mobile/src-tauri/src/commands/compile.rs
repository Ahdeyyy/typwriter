// The `compile` command: async request/response with a generation counter for
// staleness. The body does blocking work (typst::compile), so it runs on a
// blocking thread. Page images are NOT returned here — only metadata; PNG bytes
// flow lazily over the `previewimg://` scheme (see renderer.rs).

use std::{
    collections::HashMap,
    sync::{atomic::Ordering, Arc},
    time::Instant,
};

use log::info;
use tauri::State;
use typst_layout::PagedDocument;

use crate::{
    compiler::{serialize_diags, CompileResult, CompileState, PageMeta},
    world::MobileWorld,
};

#[tauri::command]
pub async fn compile(
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<CompileResult, String> {
    let world = world.inner().clone();
    let state = compile.inner().clone();

    tauri::async_runtime::spawn_blocking(move || run_compile(&world, &state))
        .await
        .map_err(|e| format!("compile task panicked: {e}"))
}

fn run_compile(world: &MobileWorld, state: &CompileState) -> CompileResult {
    let t = Instant::now();
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;

    // Give the background font load a chance to finish so the first compile
    // doesn't render with the embedded-only set. Bounded: a hung SAF read
    // must never freeze the pipeline, so after the timeout we compile with
    // whatever fonts are installed.
    world.wait_for_fonts(std::time::Duration::from_secs(10));

    // Re-read edited files from disk on every compile (disk is the truth).
    world.reset();

    if !world.has_main() {
        return CompileResult {
            generation,
            pages: None,
            errors: vec![],
            warnings: vec![],
            compile_ms: t.elapsed().as_secs_f64() * 1000.0,
        };
    }

    let result = typst::compile::<PagedDocument>(world);
    let warnings = serialize_diags(world, &result.warnings);

    let compile_ms = t.elapsed().as_secs_f64() * 1000.0;
    match result.output {
        Ok(doc) => {
            // Fingerprint each page and build the lookup map.
            let mut lookup: HashMap<String, usize> = HashMap::new();
            let pages: Vec<PageMeta> = doc
                .pages()
                .iter()
                .enumerate()
                .map(|(i, page)| {
                    let fp = format!("{:032x}", typst::utils::hash128(&page.frame));
                    lookup.insert(fp.clone(), i);
                    PageMeta {
                        fingerprint: fp,
                        width_pt: page.frame.width().to_pt(),
                        height_pt: page.frame.height().to_pt(),
                    }
                })
                .collect();

            *state.page_lookup.lock() = lookup;
            *state.document.lock() = Some(Arc::new(doc));

            info!(
                "compile: ok gen={generation} pages={} warnings={} ({compile_ms:.1}ms)",
                pages.len(),
                warnings.len()
            );
            CompileResult {
                generation,
                pages: Some(pages),
                errors: vec![],
                warnings,
                compile_ms,
            }
        }
        Err(errors) => {
            let errors = serialize_diags(world, &errors);
            info!(
                "compile: errors gen={generation} count={} ({compile_ms:.1}ms)",
                errors.len()
            );
            CompileResult {
                generation,
                pages: None,
                errors,
                warnings,
                compile_ms,
            }
        }
    }
}
