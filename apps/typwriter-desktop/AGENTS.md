# typwriter-desktop

The Typst editor for desktop. Tauri 2 + SvelteKit (static adapter) + a Rust core that wraps the Typst compiler. Builds for Windows, macOS, and Linux. Mobile is a separate app (`apps/typwriter-mobile/`); do not add mobile/SAF code paths here.

## Conventions

- camelCase for variables/functions, PascalCase for classes.
- Frontend package manager is `bun`; Rust is `cargo`.
- Validate Rust changes with `cargo check` in `src-tauri/` (full builds are slow and can OOM on Windows — see root memory).
- Do **not** run the dev server to "view" the app — it's a Tauri shell, not a browser app.
- The Typst CodeMirror parser is hand-written TypeScript in `src/lib/typst-codemirror-lang/lezer-typst/` (no `typst.grammar`, no codegen) — edit those sources directly.

## Architecture

### Rust core (`src-tauri/src/`)

- `lib.rs` — `run()` builds the Tauri app: registers the `previewimg://` URI scheme, initializes plugins, constructs shared state, and lists every `#[tauri::command]` in `invoke_handler!`.
- `world/` — `EditorWorld<R: Runtime>` implements `typst::World` + `typst_ide::IdeWorld`. Owns fonts, source files, and the lazily-fetched package index. Fonts load lazily: `ensure_fonts_loading` (called on workspace open, and by the compile worker as a safety net) kicks off the background font search once; the compile worker calls `wait_until_fonts_loaded` so it never renders against the empty fallback book. `progress.rs` emits package-download progress events to the frontend.
- `compiler/` — `PreviewPipeline` (background worker), `compile.rs`, `render.rs`, `diff.rs`, `cache.rs`, `disk_cache.rs`, `snapshot_world.rs`, `page_diff.rs`. Renders pages and serves them through the `previewimg://` protocol keyed by content fingerprint. The compile worker blocks on `EditorWorld::wait_until_fonts_loaded` before its first compile (fonts load lazily). `disk_cache.rs` persists rendered PNGs **and** a `preview-manifest.json` (ordered page keys + main file) so `restore_preview` can paint a re-opened workspace's preview from disk immediately, before the recompile finishes; the pane pulls this via `sync_preview`/`emit_current_state` on mount. `page_diff.rs` answers "which *pages* changed since this restore point": it compiles the snapshot through `snapshot_world.rs` (a `World` whose project files resolve out of the VCS object store instead of disk), aligns the two fingerprint vectors with `diff::align_pages`, and rasterizes thumbnails into its own LRU. Because that is a real compile it runs on its own worker and is cancellable — the `vcs_page_diff_request` command only enqueues and hands back a request id; results arrive on the `vcs:page-diff` event. Its thumbnails ride the `previewimg://` scheme via a fallback in `lib.rs`, so a big comparison never evicts the live preview's pages. It also *keeps* both laid-out `PagedDocument`s after a comparison, which is what lets `vcs_page_diff_render_page` re-render a single page at a readable resolution for the zoom dialog without recompiling; the frontend gives them back via `vcs_page_diff_cancel` when it stops looking.
- `workspace/` — `WorkspaceState`, filesystem `watcher`, path helpers, recent-workspaces store.
- `commands/` — Tauri commands, grouped by domain: `app`, `editor`, `workspace`, `preview`, `present` (presentation mode), `click` (bidirectional source↔preview jump), `export` (PDF/PNG/SVG/HTML), `format` (typstyle), `grammar` (Harper), `settings`, `logs`, `vcs` (restore points).
- `commands/present.rs` — **presentation mode owns the window transition, not the frontend.** `set_fullscreen` alone does *not* keep the Windows taskbar down: tao calls `ITaskbarList2::MarkFullscreenWindow`, and the shell only demotes the taskbar while that window is *active*, so alt-tabbing puts it back over the projected slide. `set_always_on_top` (`WS_EX_TOPMOST`, applied with `SWP_NOACTIVATE`) is the only focus-independent lever. Tauri's `set_fullscreen(bool)` is also hard-wired to `Fullscreen::Borderless(None)` — the *current* monitor — so the window is moved onto the target display first and fullscreen is then a geometric no-op. The pre-presentation geometry is snapshotted here because tao's own restore would drop the window back onto the projector. Windows-only extras: a `SetThreadExecutionState` keep-awake thread (thread-affine, hence its own thread) and `DWMWA_EXCLUDED_FROM_PEEK`.
- `vcs/` — versioning / restore-point system: pure-Rust content-addressed store under `.typwriter/history/` in each workspace (sha2 ids, zstd blobs). `fs.rs` defines the `WorkingTreeFs` trait all workspace reads route through.
- `grammar/` — Harper-backed grammar / style checking. `typst_parser/` is our own `harper_core::parsers::Parser` for Typst, written against the pinned `typst-syntax` (not `harper-typst`) so upgrading Typst never waits on an upstream release; `maskers.rs` reduces the structured formats Typst can import (JSON/YAML/TOML/CSV/XML/BibTeX) to their prose; `format.rs` maps a path to a reader (source code gets none); `engine.rs` owns the dictionary and lint config. The lint group is built lazily on the first check.

### Frontend (`src/`)

- `routes/+page.svelte` — single-page entry; the actual screens live in `lib/components/pages/`.
- `lib/components/pages/` — `home`, `workspace`, `settings`, `onboarding`, `preview-window`, `diff-window`.
- `lib/components/editor/` — CodeMirror tab bar, editor pane, diagnostics, grammar pane, search, Typst toolbar.
- `lib/components/sidebar/` — Obsidian-style sidebar (file tree, preview pane, export dialog). Theme switching lives only in the settings pane (`lib/components/settings/mode-control.svelte`).
- `lib/components/titlebar/` — custom window chrome.
- `lib/stores/` — Svelte 5 class-singleton stores (`workspace`, `editor`, `preview`, `diagnostics`, `grammar`, `editor-search`, `page`, `platform`, `settings`, `updater`). All `$state`/`$derived` lives inside a class; module-level `$state` exports lose reactivity.
- `lib/keybindings/` — the rebindable-shortcut layer: `registry.ts` (command catalog + shipped keys), `keys.ts` (CodeMirror-style chord notation, DOM event matching, display formatting), `index.ts` (`keysFor` / `matchesCommand` / `shortcutLabel`, resolved against the user's overrides). Overrides live in `settings.keybindings`, so they persist and sync across windows like any other setting. Hard-coding a keystroke anywhere else is a bug.
- `lib/ipc/` — `commands.ts` (thin wrappers around `invoke`) and `events.ts` (typed Tauri event listeners).
- `lib/services/` — orchestration on top of IPC (`workspace-file-service`, `export-service`, `drop-import`).
- `lib/typst-codemirror-lang/` — Typst syntax highlighting for CodeMirror. The parser is **hand-written TypeScript** in `lezer-typst/` (`parser.ts`, `scanner.ts`, `markup.ts`, `math.ts`, `code.ts`, …) built on `@lezer/common` — there is no `typst.grammar` and no codegen step; edit the parser sources directly.
- `lib/hooks/`, `lib/utils.ts`, `lib/async.ts`, `lib/logger.ts`, `lib/preview-url.ts`, `lib/paths.ts` — shared helpers.

### Tauri config

- `src-tauri/tauri.conf.json` — windows, CSP, asset protocol scope. `dragDropEnabled: false` is load-bearing: it leaves HTML5 drag-and-drop to the webview, which the file tree, the tab bar, and external file/folder drops all rely on. The cost is that a drop hands us `File` objects and no paths, so external imports ship the bytes over IPC (`lib/services/drop-import` → the `import_dropped` command).
- `src-tauri/capabilities/` — `default.json` (main + preview windows) and `desktop.json` (e.g. updater).

## bun cheatsheet

`bun install` · `bun add <pkg>` · `bun remove <pkg>` · `bun update` · `bun outdated` · `bun run <script>` · `bun run build` · `bun test`
