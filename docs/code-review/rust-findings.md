# Rust findings — `src-tauri/`

File references are relative to `apps/typwriter-desktop/src-tauri/src/`.

## Correctness

### R1. `World::today` misinterprets `offset` (bug)

`world/mod.rs` (`impl World for EditorWorld`):

```rust
fn today(&self, offset: Option<i64>) -> Option<Datetime> {
    let now = chrono::Local::now();
    let date = if let Some(days) = offset {
        now + chrono::Duration::days(days)   // ← wrong unit and wrong semantics
    } else { now };
    ...
}
```

Typst's `World::today` contract: *if `offset` is `None` use local time; if
`Some(h)` use the **UTC** date shifted by `h` hours*. A document calling
`datetime.today(offset: 1)` currently gets tomorrow's date instead of UTC+1.

Fix:

```rust
fn today(&self, offset: Option<i64>) -> Option<Datetime> {
    let date = match offset {
        None => chrono::Local::now().naive_local().date(),
        Some(hours) => {
            let secs = i32::try_from(hours).ok()?.checked_mul(3600)?;
            let tz = chrono::FixedOffset::east_opt(secs)?;
            chrono::Utc::now().with_timezone(&tz).naive_local().date()
        }
    };
    Datetime::from_ymd(date.year(), date.month() as u8, date.day() as u8)
}
```

### R2. Workspace diagnostics are std::fs-only and run on every compile

`compiler/compile.rs::collect_workspace_diagnostics`:

- `walk_typ_files` uses `std::fs::read_dir` directly. On an Android SAF
  workspace this finds nothing — cross-file diagnostics silently vanish on the
  exact platform where the rest of the codebase carefully routes through
  `WorkingTreeFs`. Reuse the SAF-aware walker (`workspace::collect_files_recursive`).
- It is called unconditionally from `compile_and_emit`, i.e. on **every**
  compile, including `Typing`-reason compiles. Each non-main `.typ` file gets a
  full `typst::compile` as its own entry point. comemo memoization softens
  repeats, but in a workspace with N files this is still N−1 extra compiles per
  keystroke tick in the worst case. Gate it on `Save | Watcher | Explicit |
  MainFile` reasons.
- Its ignore list (`.`-prefixed, `node_modules`, `target`) is a third copy of
  the list already in `watcher::IGNORED_DIRS` and `workspace::IGNORED_TREE_DIRS`.
  One shared constant.

### R3. Sync commands run on the main thread

Every `#[tauri::command]` in the codebase is a plain `fn`. In Tauri 2, sync
commands execute on the **main thread**; only `async fn` commands go to the
async runtime pool. Commands that do real work therefore block the UI:

- `read_file` — reads + base64-encodes entire images on SAF roots
- `save_file` — disk write **plus** `auto_commit_if_changed`, which re-hashes
  the entire working tree (see R4)
- `export_pdf` / `export_png` / `export_svg` and `_to_uri` variants — full
  document render
- `format_workspace_typ_files` — formats every file in the workspace
- `get_completions` / `get_tooltip` / `get_definitions` — typst-ide traversal
  over the compiled document
- all `vcs_*` commands — tree hashing / blob IO

Minimal fix: add `async` (or `#[tauri::command(async)]`) to the heavy ones.
The bodies don't need to become async-aware — Tauri just moves them off the
main thread.

### R4. VCS snapshots re-hash the whole tree on the hot path

`vcs::commit_if_changed` compares a freshly-built path→hash map of the entire
working tree against HEAD. It is invoked:

- inside the `save_file` command (main thread, see R3), and
- at the end of every successful compile in `compile_and_emit`
  (compile-worker thread — doesn't block the UI, but **does** delay the next
  queued compile).

For a workspace with large images this is a per-save/per-compile full-tree
read+hash. Options, in increasing effort:

1. Ship with `auto_snapshot_min_interval_seconds` defaulting to e.g. 30 rather
   than 0.
2. Move auto-commits to a dedicated low-priority thread with a coalescing
   queue (mirror the compile worker pattern that already exists).
3. Maintain a dirty-path set (watcher events + save calls) so the diff only
   hashes changed files; fall back to a full walk on attach.

### R5. Watcher echoes the app's own saves

`save_file` writes to disk and requests a `Save` compile. ~100 ms later the
`notify` watcher sees the same write, emits `workspace:files-changed` (causing
a frontend tree refresh) and requests a `Watcher` compile. The worker's
coalescing usually absorbs the duplicate compile, but the tree refresh and the
wakeups are pure overhead on every save — and `Save` already fires at idle-save
cadence on mobile. Keep a small `recently_self_written: Mutex<HashMap<PathBuf, Instant>>`
that `save_file` (and the structural file ops) stamp and the dispatch loop
consults.

### R6. First autocomplete can block on the network

`IdeWorld::packages` runs `fetch_package_index` inside
`OnceLock::get_or_init`. The first completion request after launch performs a
synchronous HTTP download (with whatever timeout `Downloader` uses) on the
command thread. Prefetch from a background thread at workspace open, same
single-spawn pattern as `ensure_fonts_loading`; let `packages()` return empty
until it lands.

### R7. Mojibake in a log literal

`commands/editor.rs` (`get_completions`):
`debug!("get_completions: ok ��� no completions …")` — corrupted UTF-8 in the
source. Cosmetic, but it's in every debug log.

## Error handling

### R8. `Result<_, String>` end to end

Every command, every state method, and `WorkingTreeFs` itself traffic in
`String` errors. Consequences visible in the code today:

- `EditorWorld::read_file_bytes` has to **probe** with `fs.exists(&path)` to
  reconstruct the `FileError::NotFound` vs `AccessDenied` distinction that the
  underlying `io::Error` had and the string threw away.
- The frontend can only `String(e)` whatever arrives (`toErrString` in
  `ipc/commands.ts`) — no programmatic handling, no i18n, no retry logic.

`thiserror = "2"` is already in `Cargo.toml` but only `workspace/error.rs`
uses it. Recommended shape:

```rust
#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("not found: {0}")]
    NotFound(PathBuf),
    #[error("access denied: {0}")]
    AccessDenied(PathBuf),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

// Commands: serialize a stable shape for the frontend.
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum CommandError { … }
```

Tauri commands can return any `Serialize` error — the `String` convention is
not a platform constraint.

## Duplication / structure

### R9. `vcs/mod.rs` cfg-duplication

Seven methods repeat:

```rust
#[cfg(target_os = "android")]
{ let fs = self.working_tree_fs(&root); return module::f(&root, &fs, …); }
#[cfg(not(target_os = "android"))]
{ let fs = LocalWorkingTreeFs; module::f(&root, &fs, …) }
```

`working_tree_fs_for` already returns `Box<dyn WorkingTreeFs>` and is used by
the rest of the codebase. The static-dispatch saving here is noise compared to
the file IO behind it. Every method body collapses to two lines, and the
Android-only `working_tree_fs` helper can be deleted.

### R10. `MainOverrideWorld` exists twice

`commands/editor.rs::MainOverrideWorld` and
`compiler/compile.rs::MainOverride` are the same delegating wrapper (the
former also implements `IdeWorld`). Move one canonical version into `world/`
and reuse.

### R11. Command logging boilerplate

Nearly every command follows:

```rust
let t = Instant::now();
info!("name: args…");
let result = …;
match &result {
    Ok(_) => info!("name: ok ({:.1}ms)", …),
    Err(e) => error!("name: err=\"{e}\" ({:.1}ms)", …),
}
result
```

`commands/workspace.rs` is ~600 lines of which perhaps 400 are this pattern.
One helper removes it everywhere:

```rust
pub fn logged<T>(name: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let t = Instant::now();
    let result = f();
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    match &result {
        Ok(_) => info!("{name}: ok ({ms:.1}ms)"),
        Err(e) => error!("{name}: err=\"{e}\" ({ms:.1}ms)"),
    }
    result
}
```

## Minor

- **R12.** `lib.rs` seeds the initial `EditorWorld` root with
  `std::env::current_dir()`. For a GUI app launched from a shortcut/installer
  this is arbitrary (often `C:\Windows\System32`). Nothing compiles before a
  workspace opens, so it's harmless today — but an explicit
  `Option<PathBuf>`-style "no root yet" would prevent a future foot-gun where
  `path_to_id` quietly resolves against System32.
- **R13.** `CompileReason` hand-implements `Default`; derive it with
  `#[derive(Default)]` + `#[default]` on `Explicit`.
- **R14.** `path.extension().map_or(false, |ext| ext == "typ")` →
  `is_some_and` (clippy `unnecessary_map_or`).
- **R15.** `world::path_to_id` does a byte-exact `strip_prefix`. On Windows,
  paths differing only in drive-letter case or separators won't match. All
  current callers pass paths derived from `root` itself, so it holds — worth a
  debug assertion or normalization if paths ever arrive from elsewhere.
- **R16.** Lock ordering in `PreviewPipeline::compile_and_emit` is
  `page_cache` → `disk_cache` (twice). It's consistent today; add a comment on
  the struct fields declaring the order so a future call-site doesn't invert
  it and deadlock.
- **R17.** Tests exist only in `commands/format.rs` and `vcs/restore.rs`.
  High-value, zero-infrastructure targets: `parse_page_indices`,
  `parse_pdf_standard`, `byte_to_utf16`/`utf16_to_byte` (surrogate pairs!),
  `basename`/`dirname`, `rewrite_path_prefix`, `watcher::is_ignored_path`,
  `cache::parse_key`/`zoom_to_bucket`, `compile::dedup_merge`, and the JSON
  mapping inside `fetch_package_index` (factor the parsing out of the
  download so it's testable offline).
