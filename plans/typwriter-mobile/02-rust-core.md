# Phase 2 — Rust core: World, compile, on-demand renderer, IPC contract

Goal: the complete Rust backend. After this phase the frontend phases (3–7) only call
commands defined here — this file is the **single source of truth for the IPC
contract**. If a later phase needs a change to a payload, update this file first.

Everything here is a fresh implementation. The desktop app's `src-tauri` is a useful
*reference* for typst API usage (especially `world/mod.rs`, `compiler/compile.rs`,
`compiler/render.rs`, `commands/editor.rs`), but do not import or path-depend on it.

## Design recap (differences from desktop)

| Desktop | Mobile |
|---|---|
| Background compile worker thread + mpsc queue, event-driven | Plain `async` Tauri command, request/response, generation counter for staleness |
| Shadow buffer updated per keystroke | No shadow; disk is truth; completions carry the live text in the request |
| Eager render of all changed pages after compile (rayon fan-out) | Lazy render in the URI handler on first request per `(fingerprint, scale)` |
| Disk PNG cache + manifest for instant restore | In-memory LRU only (v1) — mobile docs are small; revisit in phase 8 if needed |
| Lazy font search w/ wait-barrier | Embedded fonts loaded synchronously at startup |
| File watcher (notify) | None |

## Module: `world.rs` — `MobileWorld`

Implements `typst::World` + `typst_ide::IdeWorld`. Model it on the desktop
`EditorWorld` but simpler:

```rust
pub struct MobileWorld {
    /// Workspace root; `None` until a workspace is opened.
    root: RwLock<Option<PathBuf>>,
    /// Relative path of the main file within the root (e.g. "main.typ").
    main: RwLock<Option<FileId>>,
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    /// File slot cache: FileId -> (Source | Bytes). Cleared by `reset()`.
    slots: Mutex<HashMap<FileId, FileSlot>>,
    package_storage: PackageStorage,        // from typst_kit::package
    package_index: OnceLock<Vec<(PackageSpec, Option<EcoString>)>>,
    now: OnceLock<DateTime<Local>>,
}
```

Key points:

- **Fonts:** in `MobileWorld::new()`, run
  `typst_kit::fonts::FontSearcher::new().include_system_fonts(false).search()`.
  With `embed-fonts` enabled this yields the full embedded set (Libertinus, New CM,
  DejaVu…) synchronously in tens of milliseconds. No lazy loading, no wait barrier.
- **File resolution:** `FileId` paths are rooted at the workspace root (`VirtualPath`).
  `path_to_id(abs: &Path) -> Option<FileId>` strips the root prefix;
  `id_to_path(id) -> PathBuf` joins it back. Files in packages resolve through
  `package_storage.prepare_package(spec, &mut progress)` to the package cache dir
  (app-private, plain `std::fs`). Copy the structure of the desktop `EditorWorld::source`
  / `file` implementations, minus the SAF (`WorkingTreeFs`) indirection — v1 reads are
  plain `std::fs::read`. Map `PackageError` → `FileError::Package(e)`.
- **`reset()`:** clears `slots` and the `now` cell. Called at the start of **every**
  compile so edited files are re-read from disk. Small-document re-reads are cheap and
  this removes a whole class of cache-invalidation bugs. Also call
  `comemo::evict(10)` after each compile to bound typst's internal memoization memory
  (typst re-exports comemo usage internally; `typst::comemo::evict` — check the 0.14 API,
  the desktop app's compile path shows the exact call if present, otherwise skip).
- **`World::today(offset)` — do NOT copy the desktop implementation.** The desktop
  `EditorWorld::today` (world/mod.rs) has a known bug: it treats `offset` as a number
  of **days** added to the current date. Typst's `World` contract defines `offset` as
  the **UTC offset in hours** (it backs `datetime.today(offset: ..)`). Implement it
  correctly:

  ```rust
  fn today(&self, offset: Option<i64>) -> Option<Datetime> {
      let date = match offset {
          None => chrono::Local::now().fixed_offset(),
          Some(hours) => {
              let secs = i32::try_from(hours).ok()?.checked_mul(3600)?;
              chrono::Utc::now().with_timezone(&chrono::FixedOffset::east_opt(secs)?)
          }
      };
      Datetime::from_ymd(date.year(), date.month() as u8, date.day() as u8)
  }
  ```

  Cache the chosen "now" in the `now: OnceLock` per compile (reset clears it) so a
  document compiled at midnight doesn't straddle two dates.
- **`IdeWorld::packages()`** must return `&[(PackageSpec, Option<EcoString>)]` owned by
  self — store the fetched index in the `OnceLock` (`package_index`), same pattern as
  desktop. Fetch lazily with `package_storage.download_index()` on first call; on
  failure cache an empty vec (don't retry per keystroke).
- **`shadow(text)` for completions:** `with_overlay(id: FileId, text: &str, f: impl FnOnce(&Self) -> T) -> T`
  — temporarily installs `text` as the source for `id` in `slots`, runs `f`, restores.
  This serves `get_completions` without a persistent shadow concept.

State setup in `lib.rs`: build `Arc<MobileWorld>` in the `.setup()` hook, `app.manage(...)`.

## Module: `compiler.rs`

```rust
pub struct CompileState {
    /// Monotonic id; one per compile call. The frontend discards responses
    /// whose generation is older than the newest it has seen.
    pub generation: AtomicU64,
    /// Last successfully compiled document (for render + export + IDE calls).
    pub document: Mutex<Option<Arc<PagedDocument>>>,
    /// fingerprint (u128 as hex) -> page index in `document`, rebuilt per compile.
    pub page_lookup: Mutex<HashMap<String, usize>>,
}
```

`compile` command flow (async command; the body does blocking work, so wrap it in
`tauri::async_runtime::spawn_blocking` and await the handle):

1. `generation = state.generation.fetch_add(1) + 1`.
2. `world.reset()`.
3. If no main file: return `CompileResult { generation, pages: [], errors: [], warnings: [] }`.
4. `let result = typst::compile::<PagedDocument>(&*world);` — collect
   `result.warnings` always; on `Err(diags)` map to serialized errors.
5. On success: fingerprint each page with `typst::utils::hash128(&page.frame)` (same as
   desktop `diff.rs`), store doc + lookup map, build page metadata.
6. Serialize diagnostics (severity, message, hints, file path relative to root, and a
   UTF-16 line/col range — resolve via `Source::range(span)` then line/col lookup;
   copy the desktop `SerializedDiagnostic` shape, defined under IPC contract below).

Diagnostics for files *not* reachable from the main file are **not** collected (desktop
does this; mobile edits one file and compiles one root — keep it lean).

## Module: `renderer.rs` — on-demand page renderer

```rust
pub struct Renderer {
    /// (fingerprint_hex, scale_bucket) -> PNG bytes. ~32 entries / cap memory.
    cache: Mutex<LruCache<(String, u8), Vec<u8>>>,
}
```

- `scale buckets`: `1 → 1.0`, `2 → 1.5`, `3 → 2.0`, `4 → 3.0` pixels per typst point.
  The frontend asks for a bucket, never a float (URL stability = HTTP cacheability).
- `render(state: &CompileState, fp: &str, bucket: u8) -> Option<Vec<u8>>`:
  cache hit → return; miss → look up page index via `page_lookup`, clone the
  `Arc<PagedDocument>` out of the mutex (don't hold the lock while rendering), render
  with `typst_render::render(page, pixel_per_pt)`, encode PNG (`png` crate or
  `pixmap.encode_png()` from tiny-skia via typst-render's return type — desktop
  `render.rs` shows the exact encoding), insert into LRU, return.
- LRU size: 32 entries. A 2.0-bucket A4 page is ~1–2 MB PNG; 32 entries bounds worst
  case ~64 MB. Make the constant easy to change.

### `previewimg://` URI scheme

Register with `register_asynchronous_uri_scheme_protocol("previewimg", ...)` in
`lib.rs` (async variant: rendering on first request can take 50–300 ms and must not
block the protocol thread; move work to `tauri::async_runtime::spawn_blocking` and
respond via the responder).

- URL path: `/{fingerprint_hex}-{bucket}.png` (e.g. `/a3f9…d2-3.png`).
  On Android the webview requests `http://previewimg.localhost/{…}.png`.
- Response on hit: `200`, `Content-Type: image/png`,
  `Cache-Control: public, max-age=31536000, immutable`,
  `Access-Control-Allow-Origin: *`. The key encodes content hash + scale, so bytes are
  immutable forever — the webview's HTTP cache then absorbs repeat views (including
  across preview open/close) with zero IPC.
- Response on miss (fingerprint not in current doc, e.g. stale page after recompile):
  `404` with `Cache-Control: no-store`.

## Module: `workspace.rs`

Managed storage only (v1):

- Workspaces root: `app.path().document_dir()?.join("Typwriter")` — same location the
  desktop app uses for managed mobile workspaces, so existing user documents created by
  the old app remain visible. Create on first use. If `document_dir()` is unavailable,
  fall back to `app_data_dir().join("workspaces")`.
- A workspace = a direct subdirectory of that root.
- `WorkspaceState { root: RwLock<Option<PathBuf>> }` managed by Tauri; `open_workspace`
  sets it, plus `world.set_root(...)` and main-file detection:
  use the persisted per-workspace setting if present, else `main.typ` if it exists,
  else the first `*.typ` found, else none.
- Per-workspace metadata (main file, last opened file) lives in
  `<workspace>/.typwriter/mobile.json` — read/write with serde. Ignore `.typwriter` in
  the file tree.
- File tree: recursive walk, directories first then files, alphabetical,
  skipping hidden entries (`.`-prefixed). Reject path traversal: every command that
  takes a `rel_path` must canonicalize `root.join(rel_path)` and verify it is still
  under `root` (return an error string otherwise).

## UTF-16 ↔ UTF-8 offset helpers

Copy these two functions verbatim into `commands/editor.rs` (they bridge CodeMirror's
UTF-16 offsets and Typst's byte offsets — every offset crossing IPC is UTF-16):

```rust
pub(crate) fn byte_to_utf16(text: &str, byte_offset: usize) -> usize {
    let clamped = byte_offset.min(text.len());
    text[..clamped].encode_utf16().count()
}

pub(crate) fn utf16_to_byte(text: &str, utf16_offset: usize) -> usize {
    let mut utf16_count = 0usize;
    for (byte_idx, ch) in text.char_indices() {
        if utf16_count >= utf16_offset { return byte_idx; }
        utf16_count += ch.len_utf16();
    }
    text.len()
}
```

## IPC contract (complete)

All commands return `Result<T, String>`; errors are human-readable strings the frontend
toasts. All paths in payloads are **relative to the workspace root** with `/`
separators, except workspace dirs which are absolute. TypeScript mirror types live in
`src/lib/ipc/types.ts`.

### Workspace

| Command | Args | Returns |
|---|---|---|
| `list_workspaces` | — | `WorkspaceMeta[]` = `{ name: string, path: string, lastOpenedMs: number \| null }[]` |
| `create_workspace` | `name: string` | `WorkspaceMeta` — creates dir + a starter `main.typ` (`= Hello, Typst!\n`), sets it as main |
| `delete_workspace` | `name: string` | `null` — recursive delete; frontend confirms first |
| `open_workspace` | `name: string` | `WorkspaceInfo` = `{ name, root: string, tree: FileNode, mainFile: string \| null, lastFile: string \| null }` |
| `get_file_tree` | — | `FileNode` = `{ name, relPath, isDir, children: FileNode[] }` (root node) |
| `set_main_file` | `relPath: string` | `null` — persists to `.typwriter/mobile.json` |
| `set_last_file` | `relPath: string \| null` | `null` |

### File operations

| Command | Args | Returns |
|---|---|---|
| `create_file` | `relPath: string` | `FileNode` (new tree root) — creates parents as needed, errors if exists |
| `create_folder` | `relPath: string` | `FileNode` |
| `rename_entry` | `relPath: string, newName: string` | `FileNode` — same parent, new name; works for files and dirs |
| `move_entry` | `relPath: string, newParentRel: string` | `FileNode` |
| `delete_entry` | `relPath: string` | `FileNode` — file or recursive dir |

(Returning the refreshed tree from every mutation keeps the frontend trivially
consistent — no client-side tree surgery.)

### Editor

| Command | Args | Returns |
|---|---|---|
| `read_file` | `relPath: string` | `FileContent` (tagged union below) |
| `save_file` | `relPath: string, content: string` | `null` — writes atomically (write temp file in same dir, then rename) |
| `get_completions` | `relPath: string, text: string, cursor: number /* UTF-16 */, explicit: boolean` | `CompletionsResponse` |

```ts
type FileContent =
  | { type: "text"; content: string }
  | { type: "image"; mime: string; data: string /* data: URL, base64 */ }
  | { type: "unsupported" };
```

`read_file`: text extensions = `typ, txt, md, json, toml, yaml, yml, csv, bib, xml`;
image extensions = `png, jpg, jpeg, gif, webp, svg, bmp, avif` — images are returned as
`data:` URLs **always** (no asset protocol in this app; mobile images are small and this
is SAF-proof for phase 8).

`get_completions` implementation: resolve `FileId` for `relPath`; run
`world.with_overlay(id, &text, |w| { ... })`; inside, build `Source::new(id, text)`,
convert `cursor` UTF-16 → byte, call
`typst_ide::autocomplete(w, doc.as_deref(), &source, byte_cursor, explicit)` where `doc`
is `CompileState::document`'s current value. Map to:

```ts
interface CompletionsResponse {
  from: number; // UTF-16 offset where the completion replaces text
  completions: { kind: string; label: string; apply: string | null; detail: string | null }[];
}
```

`kind` is `format!("{:?}", c.kind)` (frontend maps it to an icon). Convert `from` back
byte → UTF-16 **against `text`** (the overlay text, not the disk text). Cap the list at
**48 items** server-side (mobile strip can't use 300 anyway; trim after sorting by
typst-ide's given order, which is already relevance-ordered).

### Compile + preview

| Command | Args | Returns |
|---|---|---|
| `compile` | — | `CompileResult` |
| `export_pdf_bytes_to_uri` | (phase 7, see `07-…md`) | |

```ts
interface CompileResult {
  generation: number;
  /// Present (possibly empty) on success; null when compile produced no document.
  pages: PageMeta[] | null;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  compileMs: number;
}
interface PageMeta {
  /// `${fingerprintHex}` — combine with scale bucket to form the image URL:
  /// previewimg://localhost/{fingerprint}-{bucket}.png
  fingerprint: string;
  widthPt: number;   // page.frame.width().to_pt()
  heightPt: number;
}
interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  hints: string[];
  filePath: string | null; // workspace-relative, null for package/internal spans
  range: { startLine: number; startCol: number; endLine: number; endCol: number } | null; // 0-based, UTF-16 cols
}
```

There are **no compile/preview events** in v1 — the request/response result carries
everything, and page images flow over HTTP. This is the main simplification vs.
desktop's six event channels. (Phase 8 adds one optional event for package download
progress.)

### Settings

| Command | Args | Returns |
|---|---|---|
| `get_settings` | — | `AppSettings` |
| `set_settings` | `settings: AppSettings` | `null` |

```ts
interface AppSettings {
  editorFontSize: number;      // default 15
  showLineNumbers: boolean;    // default false
  autosaveMs: number;          // default 600
  previewScaleBucket: 1 | 2 | 3 | 4; // default: 3 (2.0x) when devicePixelRatio >= 2 else 2
}
```

Persist via `tauri-plugin-store` (`settings.json` in app data) — the Rust side can be a
thin wrapper or the frontend can use the store plugin directly; **choose the frontend
store plugin** (fewer commands), in which case `get_settings`/`set_settings` commands
are dropped and `settings.svelte.ts` owns persistence. Note this decision in code.

## `lib.rs` assembly

```rust
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("previewimg", |ctx, request, responder| {
            // parse "/{fp}-{bucket}.png"; spawn_blocking(render); responder.respond(...)
        })
        .plugin(/* …as phase 1… */)
        .setup(|app| {
            let world = Arc::new(MobileWorld::new()?);
            app.manage(world);
            app.manage(Arc::new(CompileState::default()));
            app.manage(Arc::new(Renderer::new()));
            app.manage(Arc::new(WorkspaceState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_workspaces, create_workspace, delete_workspace, open_workspace,
            get_file_tree, set_main_file, set_last_file,
            create_file, create_folder, rename_entry, move_entry, delete_entry,
            read_file, save_file, get_completions,
            compile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Logging: every command logs name + key args at `info!`, with elapsed ms — copy the
desktop style (`info!("save_file: ok ({:.1}ms)", …)`). It has repeatedly been the only
way to debug on-device issues.

## `lib/ipc/commands.ts` (frontend half of the contract)

One exported function per command, typed, wrapping `invoke` in
`ResultAsync.fromPromise`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type { CompileResult /* … */ } from "./types";

const call = <T>(cmd: string, args?: Record<string, unknown>) =>
  ResultAsync.fromPromise(invoke<T>(cmd, args), (e) => String(e));

export const compile = () => call<CompileResult>("compile");
export const saveFile = (relPath: string, content: string) =>
  call<null>("save_file", { relPath, content });
// … one per command
```

## Unit tests (`cargo test` — no Tauri runtime needed)

Write these alongside the code in this phase; they are cheap and catch the bugs that
are hardest to debug on-device:

- `byte_to_utf16` / `utf16_to_byte`: round-trip on ASCII, on text containing `é`
  (2-byte UTF-8, 1 UTF-16 unit), and on text containing an emoji (4-byte UTF-8,
  **2 UTF-16 units** — surrogate pair); out-of-range offsets clamp instead of
  panicking.
- Path-traversal guard: a helper `resolve_in_root(root, rel) -> Result<PathBuf, _>`
  rejects `../escape.typ`, absolute paths, and `a/../../escape.typ`; accepts normal
  nested paths. Test against a `tempdir`. Every file-op command routes through it.
- `previewimg` URL parsing: `"/{fp}-{bucket}.png"` → `(fp, bucket)`; reject missing
  bucket, non-numeric bucket, unknown bucket values.
- `today` date math: extract the offset→date logic into a pure helper taking
  `DateTime<Utc>` and test `offset: Some(0)` vs `Some(10)` around a UTC midnight
  boundary (the dates must differ).

## Acceptance criteria

1. `cargo check` and `cargo test` pass in `src-tauri/`.
2. Temporary debug screen (replace the phase-1 placeholder) proves the loop on desktop
   dev **and** Android: create workspace → `open_workspace` → `save_file("main.typ",
   "= Hi\nSome *text*.")` → `compile` returns 1 page + zero errors →
   `<img src="http://previewimg.localhost/{fp}-3.png">` (use the scheme-appropriate
   URL: `previewimg://localhost/...` except on Windows/Android) renders the page.
3. `compile` with a syntax error returns a `Diagnostic` with correct relative
   `filePath` and a sane 0-based range.
4. `get_completions` with `text="#te"`, cursor 3, explicit=false returns items
   including `text` (the stdlib function).
5. A second `compile` with unchanged content returns the **same fingerprints**
   (hash stability), and the page `<img>` reloads from HTTP cache (no re-render log).
6. Requesting a stale fingerprint returns 404.
