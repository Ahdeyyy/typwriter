# 004 — Stop recompiling the whole workspace on every keystroke (gate workspace diagnostics)

**Status:** DONE — added a `workspace_diags: Mutex<(Vec<SerializedDiagnostic>,
Vec<SerializedDiagnostic>)>` cache to `PreviewPipeline`; `compile_and_emit` now only
recomputes cross-file diagnostics when `refreshes_workspace_diags(reason)` is true
(Save/Watcher/Explicit/MainFile) and reuses the cache on Typing/Zoom, so the emitted
set stays complete every keystroke without N recompiles. An `info!` log fires on each
refresh (makes the gating observable). The cache is cleared in `invalidate_cache()`
(called on workspace open / main-file change). The gate is an exhaustive `match` (no
wildcard) so a new `CompileReason` forces a decision; a unit test asserts all six
variants. `SerializedDiagnostic` already derived `Clone`. `cargo check --all-targets`
clean (type-checks the test module too). Local `cargo test` execution is blocked by
this Windows machine's link-time memory/PDB limits (the heavy Tauri cdylib won't link
here — see root memory); the test runs in CI on `ubuntu-22.04` via plan 001. Diff
limited to `src/compiler/mod.rs`. The
typing-latency / "no extra compiles while typing" check needs the running app and is
left for a manual smoke test.
**Written against:** commit `9baf8a5`
**Effort:** M · **Risk of change:** Medium (hot path; behavior-preserving for Save/Explicit)
**Depends on:** 001 (CI) recommended first. Independent of 002/003.

## Why

After every compile — **including the per-keystroke `Typing` compiles** — the desktop
compile worker calls `collect_workspace_diagnostics`, which walks the workspace and
**fully recompiles every non-main `.typ` file** to gather cross-file diagnostics. In a
workspace with N typ files, every keystroke triggers N compiles instead of 1. This is
the single biggest hot-path cost found by this month's code review
(`docs/code-review/README.md`, findings #2 and Phase-2 item 5) and matters most on
Android, where typing already froze badly enough that the README declares the Android
build "not recommended for real use".

## Current state

`apps/typwriter-desktop/src-tauri/src/compiler/mod.rs` — the reason enum (line 78)
and the unconditional call site (line 545):

```rust
pub enum CompileReason {
    Typing,
    Save,
    Watcher,
    Explicit,
    MainFile,
    Zoom,
}
```

```rust
fn compile_and_emit(&self, revision: u64, reason: CompileReason, request_mark: u64) {
    // ... main compile, ~line 528 ...

    // Collect diagnostics from other .typ files not reachable from the main file
    let (extra_errors, extra_warnings) = collect_workspace_diagnostics(&*self.world);
    dedup_merge(&mut errors, &mut warnings, extra_errors, extra_warnings);

    if let Err(err) = self.app_handle.emit(
        "compile:diagnostics",
        DiagnosticsPayload { errors, warnings },
    ) { ... }
```

`compiler/compile.rs:79` — `collect_workspace_diagnostics(world)` iterates
`walk_typ_files(&root)` (raw `std::fs` recursion, line 258) and runs
`typst::compile::<PagedDocument>` once per file via a `MainOverride` wrapper world.

Key constraint: the frontend's diagnostics pane treats each `compile:diagnostics`
event as the **complete** current diagnostic set (it replaces state, not merges). So
simply *skipping* collection on `Typing` would make cross-file diagnostics flicker
out on every keystroke and back on save.

Repo conventions: comments explain *why*; locks are `parking_lot`; state lives on
`PreviewPipeline` (`self`) which already holds several `Mutex` fields (see
`last_emitted` usage in the same file for the idiom).

## Design

Cache the workspace-wide ("extra") diagnostics on the pipeline and only refresh the
cache for reasons that can change other files' contents or meaning:

- **Refresh** on `Save`, `Watcher`, `Explicit`, `MainFile` (a main-file change makes
  previously-unreachable files reachable and vice versa).
- **Reuse cached** on `Typing` and `Zoom` (typing only changes the main-compile
  input, which is fully re-diagnosed by the main compile; zoom changes nothing
  textual).

Merged output therefore stays *complete* on every emit; staleness of the extras is
bounded by one save/idle cycle, which is the same staleness the rest of the app
already accepts for compile output.

## Steps

1. Add a field to `PreviewPipeline` (same struct that owns `last_emitted` in
   `compiler/mod.rs`):

   ```rust
   /// Diagnostics from .typ files not reachable from the main file. Refreshed
   /// only on Save/Watcher/Explicit/MainFile compiles — recomputing this means
   /// fully recompiling every other file, far too costly per keystroke.
   workspace_diags: Mutex<(Vec<SerializedDiagnostic>, Vec<SerializedDiagnostic>)>,
   ```

   Initialize empty where the struct is constructed.

2. In `compile_and_emit`, replace the unconditional call (line ~545):

   ```rust
   let refresh = matches!(
       reason,
       CompileReason::Save | CompileReason::Watcher | CompileReason::Explicit | CompileReason::MainFile
   );
   let (extra_errors, extra_warnings) = if refresh {
       let fresh = collect_workspace_diagnostics(&*self.world);
       *self.workspace_diags.lock() = fresh.clone();
       fresh
   } else {
       self.workspace_diags.lock().clone()
   };
   dedup_merge(&mut errors, &mut warnings, extra_errors, extra_warnings);
   ```

3. Clear the cache when the workspace root changes — find where the pipeline learns
   about a new root (search `set_root` / wherever `world.set_root` or workspace-open
   resets pipeline state; the disk-cache restore path in `disk_cache.rs` /
   `restore_preview` flows from workspace open) and reset
   `*self.workspace_diags.lock() = Default::default();` there. If no such pipeline
   hook exists, clearing on the next `MainFile`/`Explicit` compile (which workspace
   open triggers) is acceptable — verify workspace open does send a non-`Typing`
   reason before relying on it, and say which mechanism you used in the PR
   description.

4. `cargo check` in `apps/typwriter-desktop/src-tauri/`
   (Windows: `$env:RUST_MIN_STACK = "8388608"`). Expect clean.

5. Add a unit test if feasible **without** a Tauri runtime: the gating decision is
   the `matches!` expression — extract it as
   `fn refreshes_workspace_diags(reason: CompileReason) -> bool` and test all six
   variants. (The full pipeline needs an `AppHandle`; don't try to construct one.)

6. Manual verification (`bun tauri dev`), workspace with `main.typ` +
   `other.typ` where `other.typ` contains an error and is **not** imported by main:
   - Open the workspace → the diagnostics pane lists `other.typ`'s error.
   - Type continuously in `main.typ` and watch the log: per-keystroke compiles log
     `reason=Typing` and must **not** be followed by recompiles of `other.typ`
     (before this change, each typing tick logs one extra compile per non-main
     file); the `other.typ` error stays visible in the pane the whole time.
   - Fix the error in `other.typ`, save → the diagnostic clears on the save compile.
   - Sanity-check typing latency subjectively in a 5+ file workspace.

## Explicitly out of scope

- Routing `walk_typ_files` through `WorkingTreeFs` so SAF (Android folder-picker)
  workspaces get cross-file diagnostics at all — a real, separate bug
  (`docs/code-review/README.md` Phase-1 item 3). Don't fold it in here; the gating
  change is hot-path-critical and should be reviewable alone.
- Making commands async, debounce changes, VCS snapshot costs (other roadmap items).
- Any frontend change — the event payload shape is unchanged.

## Done criteria

1. `cargo check` and `cargo test` clean.
2. With log level info, typing in a 3-file workspace produces **no**
   `collect_workspace_diagnostics`-attributable compiles between saves (verify via
   the existing per-compile log lines; if collection has no log line of its own, add
   one `info!` when a refresh runs — that also makes the behavior observable
   forever).
3. The manual scenario in step 6 behaves as described, including the
   stays-visible-while-typing check.

## Maintenance note

If a new `CompileReason` variant is ever added, the `matches!` gate forces a
decision at compile time only if you keep it **exhaustive-by-listing** — consider a
`match reason { ... }` with no wildcard arm instead of `matches!` if you want the
compiler to flag new variants. The cached-extras design also assumes the frontend
replaces (not merges) diagnostics state; if the frontend ever merges, revisit.

## Escape hatches

- If `SerializedDiagnostic` doesn't implement `Clone`, derive it — but if that
  cascades into types that can't cheaply derive `Clone`, STOP and report.
- If you find the watcher *also* fires for the app's own saves (it does — known
  echo, roadmap item 9), you may see two refreshes per save. That's pre-existing;
  do not fix it here.
- If the diagnostics pane visibly flickers or drops the cross-file error while
  typing despite the cache, the frontend merge assumption above is wrong — STOP,
  capture what `compile:diagnostics` payloads were emitted, and report.
