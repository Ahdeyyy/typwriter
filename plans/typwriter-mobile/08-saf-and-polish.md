# Phase 8 — SAF external folders, package progress, performance polish

Post-v1 work. Everything here is optional for a first release; do not start it until
phases 1–7 all pass their acceptance criteria on a physical device.

## 8.1 SAF external folders (open a folder outside the app's storage)

Background (hard-won knowledge from the desktop app — read before designing):

- The Android manifest declares only `INTERNET`. There is **no** broad storage
  permission, and adding `MANAGE_EXTERNAL_STORAGE` is a Play Store rejection risk.
  A folder the user picks via the system folder picker (Storage Access Framework)
  resolves to a `content://` tree URI; `std::fs` **cannot** read those paths.
- All reads/writes to a SAF root must go through `tauri-plugin-android-fs`.
- SAF has no atomic rename and no cross-tree move; move = copy-then-delete.
- The desktop app solved this with a `WorkingTreeFs` trait (std::fs impl + android-fs
  impl) and a registry mapping workspace root → SAF tree URI. Mirror that design,
  implemented fresh in this codebase:

Plan:

1. Define `trait WorkspaceFs { read(rel) -> Vec<u8>; write(rel, bytes); list(rel) -> Vec<Entry>;
   create_dir(rel); rename(rel, new_name); remove(rel); move_entry(rel, new_parent); }`
   with `LocalFs` (std::fs) and `SafFs` (android-fs, holding the tree URI) impls.
   `SafFs::rename`/`move_entry` use copy-then-delete.
2. `WorkspaceState` gains `fs: Box<dyn WorkspaceFs + Send + Sync>`, chosen at
   `open_workspace` time. Every command from `02-rust-core.md` that touches files
   switches from direct `std::fs` to `state.fs` — **this is why phase 2 should keep all
   file IO inside `workspace.rs`/`commands` rather than scattered**.
3. `MobileWorld::source`/`file` route workspace-local reads through the same `fs`
   (package files stay on `std::fs` — the package cache is app-private and always
   reachable).
4. New commands: `pick_external_folder()` (shows the SAF folder picker, persists the
   permission grant with `takePersistableUriPermission` semantics via the plugin,
   stores `name ↔ uri` in the app store) and external workspaces appear in
   `list_workspaces` with a badge field `external: bool`.
5. Home screen: "Open folder…" secondary action; external workspaces show a small
   `FolderOpen` badge.
6. Known cost: SAF IO is 5–20× slower than std::fs. Compiles re-read files each
   `reset()` — for SAF roots add an mtime-keyed source cache (the plugin exposes
   document metadata) before shipping this.

## 8.2 Typst package download progress

First use of `@preview/...` packages triggers a download mid-compile with no feedback.

- Implement `typst_kit::download::Progress` on a small struct holding an `AppHandle`;
  emit `package:download` events `{ package: string, downloaded: number, total: number | null }`
  (mirror the desktop `world/progress.rs`).
- Frontend: tiny indeterminate progress toast ("Downloading @preview/cetz…") driven by
  the event; dismiss on compile completion.
- This is the **only** Tauri event in the app — note it in `02-rust-core.md`'s contract
  when implemented.

## 8.3 Performance & polish backlog

In rough priority order; measure before and after each (Android Studio profiler +
`adb logcat` timing logs already emitted by commands):

1. **Cold start**: target < 1.5 s to interactive home screen. Check: font search time
   (embedded-only should be ~50 ms), store plugin init, and whether `MobileWorld::new`
   can move off the setup hook's critical path (lazy `OnceLock<MobileWorld>` built on
   first workspace open).
2. **Compile latency UX**: show compile ms in the preview status chip (data already in
   `CompileResult.compileMs`); investigate `comemo` cache retention across compiles
   (don't `reset()` sources that didn't change: compare mtimes instead of
   unconditionally clearing slots).
3. **Renderer memory**: instrument LRU hit rate; consider dropping the 1.0 bucket
   renders once a sharper bucket exists for the same fingerprint.
4. **Disk render cache** (only if reopen-to-preview feels slow in practice): persist
   PNGs under `app_cache_dir()/previews/{fp}-{bucket}.png` with an LRU sweep, checked
   before rendering. The desktop `disk_cache.rs` + manifest restore is the reference
   design.
5. **Find in file**: minimal find bar (case-insensitive, next/prev) using
   `@codemirror/search`'s programmatic API with a custom Svelte panel (desktop pattern:
   suppress the built-in panel, drive `SearchQuery` yourself).
6. **Typstyle formatting**: `typstyle-core` dependency + `format_current_file` command +
   toolbar button. Cursor maintenance across format is the hard part — desktop solved
   it Rust-side (`commands/format.rs`); port that algorithm, or v1: keep cursor at the
   same line number.
7. **Tap-to-source** in preview (see `06-preview.md` stretch section).
8. **Tablet layout**: at ≥ 768px width, show the preview side-by-side with the editor
   (the overlay becomes a pane). Defer until someone asks.

## 8.4 Migration & coexistence notes

- The new app's identifier `com.ahdey.typwriter.mobile` installs alongside the old
  Tauri "desktop" Android build. Managed workspaces live in the same
  `Documents/Typwriter/` directory, so documents created in the old app appear in the
  new one automatically (and vice versa). `.typwriter/mobile.json` is new-app-only
  metadata; the old app ignores unknown files. The old app's `.typwriter/history/`
  (VCS) and `cache/` directories must be ignored by the new app's tree walker (already
  specified: `.typwriter` is always hidden).
- When the mobile app reaches parity for mobile use-cases, remove the Android target
  and `.mobile.svelte` code paths from `apps/typwriter-desktop` — tracked as separate
  future work, **not** part of this plan.
