# typwriter-desktop

The Typst editor. Tauri 2 + SvelteKit (static adapter) + a Rust core that wraps the Typst compiler. Builds for Windows, macOS, Linux, and Android (the "desktop" name is historical — `tauri-plugin-android-fs` and a mobile entry point in `lib.rs` keep the mobile path live).

## Conventions

- camelCase for variables/functions, PascalCase for classes.
- Frontend package manager is `bun`; Rust is `cargo`.
- Validate Rust changes with `cargo check` in `src-tauri/` (full builds are slow and can OOM on Windows — see root memory).
- Do **not** run the dev server to "view" the app — it's a Tauri shell, not a browser app.
- The Typst CodeMirror parser is hand-written TypeScript in `src/lib/typst-codemirror-lang/lezer-typst/` (no `typst.grammar`, no codegen) — edit those sources directly.

## Architecture

### Rust core (`src-tauri/src/`)

- `lib.rs` — `run()` builds the Tauri app: registers the `previewimg://` URI scheme, initializes plugins, constructs shared state, spawns background font loading, and lists every `#[tauri::command]` in `invoke_handler!`.
- `world/` — `EditorWorld<R: Runtime>` implements `typst::World` + `typst_ide::IdeWorld`. Owns fonts, source files, and the lazily-fetched package index. `progress.rs` emits package-download progress events to the frontend.
- `compiler/` — `PreviewPipeline` (background worker), `compile.rs`, `render.rs`, `diff.rs`, `cache.rs`. Renders pages and serves them through the `previewimg://` protocol keyed by content fingerprint.
- `workspace/` — `WorkspaceState`, filesystem `watcher`, path helpers, recent-workspaces store.
- `commands/` — Tauri commands, grouped by domain: `app`, `editor`, `workspace`, `preview`, `click` (bidirectional source↔preview jump), `export` (PDF/PNG/SVG, with `_to_uri` variants for Android SAF), `format` (typstyle), `settings`, `logs`.

### Frontend (`src/`)

- `routes/+page.svelte` — single-page entry; the actual screens live in `lib/components/pages/`.
- `lib/components/pages/` — `home`, `workspace`, `settings`, `keymaps`, `preview-window`.
- `lib/components/editor/` — CodeMirror tab bar, editor pane, diagnostics, search, Typst toolbar.
- `lib/components/sidebar/` — Obsidian-style sidebar (file tree, preview pane, export dialog, mode switcher). Mobile variants live alongside (`.mobile.svelte`).
- `lib/components/titlebar/` — custom window chrome.
- `lib/stores/` — Svelte 5 class-singleton stores (`workspace`, `editor`, `preview`, `diagnostics`, `editor-search`, `page`, `platform`, `settings`, `updater`). All `$state`/`$derived` lives inside a class; module-level `$state` exports lose reactivity.
- `lib/ipc/` — `commands.ts` (thin wrappers around `invoke`) and `events.ts` (typed Tauri event listeners).
- `lib/services/` — orchestration on top of IPC (`workspace-file-service`, `export-service`).
- `lib/typst-codemirror-lang/` — Typst syntax highlighting for CodeMirror. The parser is **hand-written TypeScript** in `lezer-typst/` (`parser.ts`, `scanner.ts`, `markup.ts`, `math.ts`, `code.ts`, …) built on `@lezer/lr` — no `typst.grammar`, no codegen; edit the parser sources directly.
- `lib/hooks/`, `lib/utils.ts`, `lib/async.ts`, `lib/logger.ts`, `lib/preview-url.ts`, `lib/paths.ts` — shared helpers.

### Tauri config

- `src-tauri/tauri.conf.json` — windows, CSP, asset protocol scope.
- `src-tauri/capabilities/` — `default.json` (all platforms) and `desktop.json` (desktop-only, e.g. updater).
- `src-tauri/gen/android/` — generated Android project (do not hand-edit).

## bun cheatsheet

`bun install` · `bun add <pkg>` · `bun remove <pkg>` · `bun update` · `bun outdated` · `bun run <script>` · `bun run build` · `bun test`
