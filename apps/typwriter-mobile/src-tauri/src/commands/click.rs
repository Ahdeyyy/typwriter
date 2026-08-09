// Preview → editor / preview: resolve a tap on a rendered page to a jump
// target. This is the click direction of the bidirectional jump; the cursor
// direction (editor → preview page) lives in `commands/cursor.rs`.
//
// `typst_ide::jump_from_click` hit-tests the page frame: a link item wins first
// (an `#outline` entry, a `@ref`, a footnote mark, a `#link` to a URL), and
// falls back to the glyph/shape under the point, which resolves to the source
// span that produced it.

use std::{num::NonZeroUsize, sync::Arc, time::Instant};

use log::info;
use serde::Serialize;
use tauri::State;
use typst::{
    introspection::PagedPosition,
    layout::{Abs, Point},
    syntax::VirtualRoot,
    World,
};

use crate::{commands::editor::byte_to_utf16, compiler::CompileState, world::MobileWorld};

/// Where a tap on the preview leads.
#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JumpTarget {
    /// Into the source: open `rel_path` and place the caret at `offset`.
    #[serde(rename_all = "camelCase")]
    File {
        /// Workspace-relative path with `/` separators.
        rel_path: String,
        /// UTF-16 offset (CodeMirror's unit), like every offset crossing IPC.
        offset: usize,
    },
    /// Out of the app: an external link.
    Url { url: String },
    /// Elsewhere in the preview: a **0-based** page plus a point on it, in
    /// typst points from the page's top-left.
    Position { page: usize, x: f64, y: f64 },
}

/// Resolve a tap at `x`/`y` typst points on the **0-based** preview `page`.
///
/// Returns `None` when there is no compiled document, the page is out of range,
/// nothing was hit, or the hit belongs to a package file (which isn't part of
/// the workspace and so can't be opened in the editor).
#[tauri::command]
pub async fn jump_from_click(
    page: usize,
    x: f64,
    y: f64,
    world: State<'_, Arc<MobileWorld>>,
    compile: State<'_, Arc<CompileState>>,
) -> Result<Option<JumpTarget>, String> {
    let world = world.inner().clone();
    let compile = compile.inner().clone();

    // The hit test walks the page frame (and resolves link destinations through
    // the introspector) — keep it off the runtime's worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let Some(doc) = compile.document.lock().clone() else {
            return Ok(None);
        };
        if page >= doc.pages().len() {
            return Ok(None);
        }
        let position = PagedPosition {
            page: NonZeroUsize::new(page + 1).expect("page + 1 is non-zero"),
            point: Point::new(Abs::pt(x), Abs::pt(y)),
        };

        let target = typst_ide::jump_from_click(&*world, &*doc, &position)
            .and_then(|jump| serialize_jump(&world, jump));
        info!(
            "jump_from_click: page={page} x={x:.1} y={y:.1} target={target:?} ({:.1}ms)",
            t.elapsed().as_secs_f64() * 1000.0
        );
        Ok(target)
    })
    .await
    .map_err(|e| format!("jump_from_click task panicked: {e}"))?
}

/// Convert a `typst_ide::Jump` into its IPC form. `None` for a source position
/// inside a package: the mobile editor only opens workspace files.
fn serialize_jump(world: &MobileWorld, jump: typst_ide::Jump) -> Option<JumpTarget> {
    match jump {
        typst_ide::Jump::File(id, offset) => {
            if matches!(id.root(), VirtualRoot::Package(_)) {
                return None;
            }
            // `get_without_slash` already yields a forward-slash relative path.
            let rel_path = id.vpath().get_without_slash().to_string();
            let offset = world
                .source(id)
                .map(|src| byte_to_utf16(src.text(), offset))
                .unwrap_or(offset);
            Some(JumpTarget::File { rel_path, offset })
        }
        typst_ide::Jump::Url(url) => Some(JumpTarget::Url {
            url: url.to_string(),
        }),
        typst_ide::Jump::Position(pos) => Some(JumpTarget::Position {
            page: pos.page.get() - 1, // 1-based → 0-based
            x: pos.point.x.to_pt(),
            y: pos.point.y.to_pt(),
        }),
    }
}
