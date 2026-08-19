# typwriter-mobile

The standalone Android Typst editor. Tauri 2 + SvelteKit (static adapter, SPA fallback) + a Rust core wrapping the Typst compiler. It shares the Typwriter *design system* with `apps/typwriter-desktop` (CSS tokens, Tailwind 4, shadcn-svelte, hugeicons) but **no code** — treat it as an independent app.

Android is the only shipping target. `bun tauri dev` opens a desktop window purely as a fast dev loop; nothing may depend on desktop-only behaviour.

See `README.md` for the dev loop, the `adjustResize` manifest note, and the app-icon ordering rule (`tauri icon` must run *after* `android init`, or the APK ships the default Tauri icon).

## Conventions

- camelCase for variables/functions, PascalCase for classes. `bun` for the frontend, `cargo` for Rust.
- Validate Rust with `cargo check` in `src-tauri/` (`RUST_MIN_STACK=8388608` on Windows). Full builds are slow and can OOM.
- Every Svelte store is a class with a singleton export — module-level `$state` exports lose reactivity.
- `src/lib/ipc/commands.ts` is the **only** place `invoke` is called; `types.ts` mirrors the Rust contract.

## Hard constraints

These are the ones that cost real debugging time. Violating any of them breaks the app on device while looking fine in the desktop dev window.

- **Every Tauri command is `async`.** Sync commands and `tauri-plugin-android-fs` calls run on the main thread and stall the whole app. Fonts load in a background task; setup must never block.
- **No live-typing preview.** Per-keystroke compile froze the app on device. Compiles are driven by idle-save, blur, and view toggles — disk is the source of truth, not the in-memory buffer.
- **Keyboard avoidance uses `--app-height` from `visualViewport`**, not `svh`/`dvh`. Anchor the shell to the layout viewport; never translate by `vv.offsetTop`. Caret re-scroll lives in a CodeMirror `ResizeObserver` plugin.
- **Never scroll to the caret during a range selection or an active touch gesture.** It's a feedback loop that drags the cursor away from the user's finger. See `src/lib/editor/caret-visibility.ts`.
- **Modal body locks must always be released.** A stranded `pointer-events: none` on `<body>` kills every tap in the app. All locking goes through `src/lib/body-lock.ts`.
- **Storage is split.** `std::fs` only reaches the app's managed directory; SAF-picked external folders and the app-wide fonts folder go through `tauri-plugin-android-fs`. There are no runtime storage permissions to request.
- **External changes reload a clean buffer, flag a dirty one.** Never silently discard unsaved text: autosave makes "dirty" a few seconds wide, and losing what the user typed inside it is worse than showing a stale file with a warning. Reloads dispatch a *minimal* change (`lib/editor/minimal-change.ts`) — a whole-document swap collapses the caret to the top of the file.
- **Rename/move/delete return `{tree, from, to}`.** Tabs, the active buffer, the Rust main `FileId`, and persisted metadata are all keyed by path and must be remapped together.
- **Completions are ranked client-side.** `typst-ide` never filters by prefix, so rank *then* truncate — otherwise `#im` suggests `align, alt, arguments…` and never `image`.

## Architecture

### Rust core (`src-tauri/src/`)

- `lib.rs` — `run()` builds the app, registers the `previewimg://` scheme, and lists every command in `invoke_handler!`.
- `world.rs` — the `typst::World` + `typst_ide::IdeWorld` implementation.
- `compiler.rs` / `renderer.rs` — compile and lazy on-demand page rendering, served over `previewimg://` keyed by content fingerprint.
- `workspace.rs` — **all file IO funnels through here**, so an alternative storage backend (SAF-picked external folders) swaps in at one seam. Also owns path-traversal guards and the rename/move path remapping.
- `fonts.rs` — embedded + system fonts, plus the SAF app-wide fonts folder (`pick_fonts_dir` / `clear_fonts_dir`).
- `watcher.rs` — external-change detection for the open workspace. **Polling, not inotify**: shared storage is a FUSE mount and writes reaching the lower filesystem another way (MTP, `adb push`, MediaProvider) can land without raising an event, and missing a change silently is the one failure this cannot have. A poll cannot pair the halves of a move, so an external rename arrives as a removal plus a creation. Every command that writes claims its paths on `WatcherState::self_writes` — by *state*, not a time window — or autosave polls back as an external change.
- `commands/` — `app`, `workspace`, `editor`, `compile`, `cursor`, `click`, `export`, `format`.

### Frontend (`src/`)

- `lib/components/screens/` — `home`, `editor`, `tab-switcher`, `quick-switcher`, `settings-overlay`.
- `lib/components/` — `file-tree/` (left sheet), `preview/` (full-screen overlay), `toolbar/` (two-mode editor toolbar + completion strip), `diagnostics/`, `editor/`, `sidebar/`, `ui/`.
- `lib/stores/` — `app`, `workspace`, `editor`, `compile`, `settings`. Settings persistence is frontend-owned via `tauri-plugin-store`; there are no Rust settings commands.
- `lib/editor/` — CodeMirror setup (`create-editor.ts`), the touch completion strip (`completion-controller.svelte.ts`, `completion-logic.ts`), keyboard/caret handling (`keyboard-visibility.svelte.ts`, `caret-visibility.ts`, `scroll-pin.ts`), and `typst-lang/`.
- `lib/editor/typst-lang/lezer-typst/` — the Typst parser: **hand-written TypeScript** built on `@lezer/common`, no `typst.grammar` and no codegen. It is currently a byte-identical copy of the desktop app's `src/lib/typst-codemirror-lang/lezer-typst/` and must stay that way — every parser fix lands in both.
- `lib/ipc/`, `lib/paths.ts`, `lib/body-lock.ts`, `lib/preview-url.ts`, `lib/actions/`, `lib/hooks/` — shared helpers.

### Build config

- `vite.config.ts` — dev server on port 1430 (desktop uses 1420). The `resolve.dedupe` list is load-bearing: two copies of `@lezer/common` collide `NodeProp` ids and highlighting silently renders as plain text. The root `package.json` `overrides` block pins the versions; check that pin before writing any CodeMirror workaround, since it caps both apps.
