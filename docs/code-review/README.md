# Typwriter Code Review — June 2026

A full audit of `apps/typwriter-desktop` (Rust core + Svelte frontend), with a
prioritized guide for improving the codebase.

- [rust-findings.md](./rust-findings.md) — backend findings, file-by-file
- [svelte-findings.md](./svelte-findings.md) — frontend findings
- This file — summary and the improvement roadmap

## Overall assessment

The codebase is in good shape. The layering is clean and consistently applied
(`commands/` → `WorkspaceState` / `PreviewPipeline` / `EditorWorld` / `VcsState`),
comments explain *why* rather than *what*, the SAF abstraction (`WorkingTreeFs`)
is a genuinely good design that lets one code path serve desktop `std::fs` and
Android scoped storage, and the preview pipeline (content-fingerprint cache
keys, `previewimg://` protocol, disk-cache manifest restore, stale-request
aborts) is thoughtfully engineered. The frontend store discipline
(class-singleton `$state`, `neverthrow` at the IPC boundary) is consistent.

The biggest gaps are **test coverage** (only `format.rs` and `vcs/restore.rs`
have tests; zero frontend tests), **stringly-typed errors** end to end, a small
number of **correctness bugs** (notably `World::today` mis-reading typst's
`offset` contract), and a few **hot-path performance hazards** that matter most
on mobile (whole-document IPC per keystroke, whole-workspace re-compilation for
diagnostics, whole-tree hashing for auto-snapshots).

## Top findings (the short list)

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | Bug | Rust | `World::today` treats `offset` as **days**; typst defines it as a UTC offset in **hours** ([world/mod.rs:468](../../apps/typwriter-desktop/src-tauri/src/world/mod.rs)) |
| 2 | Bug | Rust | `collect_workspace_diagnostics` walks the tree with raw `std::fs` — silently returns nothing for Android SAF workspaces, and fully recompiles **every** non-main `.typ` file on **every** compile cycle ([compiler/compile.rs](../../apps/typwriter-desktop/src-tauri/src/compiler/compile.rs)) |
| 3 | Bug | Both | Text/image extension allowlists are duplicated and **drifted** between Rust `read_file` and the TS editor store — `.log` / `.cfg` open fine via the backend but the frontend renders "Binary format" |
| 4 | Perf | Both | Typing path ships the **entire document** over IPC every 8 ms throttle tick, persists all unsaved buffers as JSON every 300 ms, and triggers a whole-workspace snapshot hash after each successful compile |
| 5 | Perf | Rust | All `#[tauri::command]`s are **sync**, so they run on the main thread — exports, base64 image reads, workspace formatting, and the save-path VCS hash all block the UI |
| 6 | Arch | Rust | `Result<_, String>` everywhere; `WorkingTreeFs` collapses `io::ErrorKind` into strings, forcing the `exists()` probe hack in `EditorWorld::read_file_bytes` |
| 7 | Arch | Rust | `vcs/mod.rs` repeats the same `#[cfg(target_os = "android")]` / desktop block in 7 methods even though `working_tree_fs_for` (a `Box<dyn WorkingTreeFs>`) already abstracts it |
| 8 | Quality | Both | ~Zero automated tests outside `format.rs`/`vcs/restore.rs`; CI builds (android/nightly/publish) but nothing gates PRs on `cargo check`/clippy/lint/tests |

## Improvement roadmap

Ordered so each phase pays for the next. Estimated sizes are relative.

### Phase 1 — Correctness (small, do first)

1. **Fix `World::today`** — interpret `offset` as hours from UTC:
   use `chrono::Utc::now().with_timezone(&FixedOffset::east_opt(hours * 3600)?)`
   when `offset` is `Some`, local time otherwise.
2. **Single source of truth for file-type detection.** Delete `TEXT_EXTS` /
   `IMAGE_EXTS` from `editor.svelte.ts` and let the backend's
   `FileContentResponse` drive `viewMode`. Open the tab in a "loading" state,
   then set `text` / `image` / `unsupported` from the response type.
3. **Route `collect_workspace_diagnostics` through `WorkingTreeFs`** so SAF
   workspaces get cross-file diagnostics too (reuse the walker in
   `workspace/mod.rs` instead of the private `walk_typ_files`).
4. Clean the mojibake log literal in `get_completions`
   (`"ok ��� no completions"`).

### Phase 2 — Hot-path performance (medium)

5. **Gate workspace-wide diagnostics.** Run them on `Save` / `Watcher` /
   `Explicit` only — not on `Typing`. Per-keystroke compiles should compile the
   main file only. (This alone removes N−1 full compiles per keystroke in
   multi-file workspaces.)
6. **Move heavy commands off the main thread.** Mark `read_file`, `save_file`,
   all `export_*`, `format_workspace_typ_files`, `get_completions`,
   `vcs_*` as `async fn` (or `#[tauri::command(async)]`) so Tauri runs them on
   the async pool.
7. **Take the VCS snapshot off the save/compile critical path.** Today
   `commit_if_changed` re-hashes the whole working tree inside `save_file` and
   inside the compile worker. Either (a) spawn it onto a dedicated thread with
   a coalescing queue, or (b) maintain a dirty-path set fed by the watcher +
   save calls so the diff-vs-HEAD walk only touches changed files. Also
   consider a non-zero default for `auto_snapshot_min_interval_seconds`.
8. **Shrink the typing IPC payload.** Send CodeMirror change deltas
   (`from`, `to`, `insert`) to a new `apply_file_edit` command that patches the
   shadow string, instead of the full document per tick. Keep the full-content
   path as the fallback/resync mechanism.
9. **Suppress watcher echo for self-writes.** `save_file` triggers a `Save`
   compile, then the watcher sees the same write ~100 ms later and triggers a
   `Watcher` compile. Track recently-self-written paths (path + generation
   counter, cleared after the debounce window) and skip them in the dispatch
   loop.
10. **Prefetch the package index.** `fetch_package_index` currently runs inside
    `OnceLock::get_or_init` on the first autocomplete — a network timeout away
    from a frozen completion popup. Kick it off on a background thread at
    workspace open (same pattern as `ensure_fonts_loading`).
11. **Debounce tab persistence harder while typing.** `schedulePersistTabs`
    serializes every dirty buffer to the store JSON each 300 ms. Either raise
    the debounce while a typing-preview timer is active, or persist unsaved
    buffers only on idle-save/blur/visibility-change (the hot-exit window that
    actually matters).

### Phase 3 — Error model (medium)

12. **Introduce typed errors.** `thiserror` is already a dependency. Define
    `WorkspaceError`, `VcsError`, `CompileError` enums with `#[from]`
    conversions, implement `Serialize` (Tauri supports returning serializable
    errors), and return them from commands. Give `WorkingTreeFs` a real error
    type carrying `io::ErrorKind` so `EditorWorld::read_file_bytes` can map
    `NotFound`/`AccessDenied` directly instead of probing with `exists()`.
13. On the TS side, type the IPC error channel (`invoke` rejection payload) and
    replace `toErrString` with a mapper that produces user-facing messages.

### Phase 4 — Deduplication & structure (medium)

14. **Collapse the `cfg` duplication in `vcs/mod.rs`** — every method body
    becomes `let fs = self.working_tree_fs_for(&root); module::fn(&root, fs.as_ref(), …)`.
    The dynamic dispatch cost is irrelevant next to the file I/O it fronts.
15. **De-duplicate `MainOverrideWorld`** (`commands/editor.rs`) and
    `MainOverride` (`compiler/compile.rs`) into one type in `world/`.
16. **Extract a command-logging helper.** Every command repeats
    `Instant::now()` + `match &result { Ok → info!, Err → error! }` (~8 lines ×
    ~50 commands). A small generic wrapper
    (`fn logged<T>(name: &str, args: fmt::Arguments, f: impl FnOnce() -> Result<T, String>)`)
    or a `log_cmd!` macro removes several hundred lines.
17. **Extract `_createTab` in `editor.svelte.ts`** — the `TabInfo` literal +
    hot-exit branch is duplicated verbatim between `_openFile` and
    `restoreTabs`.
18. **Break the `editor` ↔ `workspace` store import cycle.** It works because
    usage is deferred, but it's fragile under refactor. Either merge tab
    persistence into a third module both import, or pass callbacks at init.

### Phase 5 — Tests & CI (ongoing)

19. **Rust unit tests** for the pure helpers first — they need no Tauri
    runtime: `parse_page_indices`, `parse_pdf_standard`, `utf16_to_byte` /
    `byte_to_utf16` (including surrogate pairs), `basename` / `dirname`,
    `rewrite_path_prefix`, `watcher::is_ignored_path`, `parse_key` /
    `zoom_to_bucket`, `dedup_merge`, `fetch_package_index`'s JSON mapping
    (factor the parse out of the download).
20. **Frontend tests** with `bun test` / vitest for `paths.ts`, `filterTree`,
    `rewritePath`, `collectExpandedPaths`, and the `EditorStore` timer/version
    logic (inject fake timers).
21. **Add a PR-check workflow**: `cargo check` (with `RUST_MIN_STACK=8388608`
    on Windows runners), `cargo clippy -- -D warnings`, `cargo test`,
    `bun run lint`, `bun run check-types`, `bun test`.
22. Adopt clippy suggestions as you touch files: `#[derive(Default)]` with
    `#[default]` on `CompileReason`, `is_some_and` over `map_or(false, …)`.

### Deliberate trade-offs to keep (reviewed, fine as-is)

- `Box::leak` on font reload — bounded, human-cadence, and the `&'static`
  borrow is what makes `World::book()` implementable. `arc-swap` is the
  alternative if it ever bothers you.
- The in-memory `source_cache`/`file_cache` are unbounded but reset on root
  change; workspace-sized, not a practical leak.
- Disk preview cache already has LRU eviction + oldest-mtime preseeding.
- The `previewimg://` immutable-cache design and the `last_emitted`
  commit-once discipline in `compile_and_emit` are both correct and worth
  protecting with a comment if refactored.
