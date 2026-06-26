# Typwriter Mobile Implementation Guide

A standalone, end-to-end guide to how Typwriter runs on mobile today (Android,
experimental) and how to take it to a complete, shippable mobile app —
including the iOS port. Written against the codebase as of v0.8.1.

> Despite the folder name, `apps/typwriter-desktop` **is** the mobile app.
> Tauri 2's mobile entry point (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`
> in `src-tauri/src/lib.rs`) and `tauri-plugin-android-fs` keep the Android
> path live in the same crate and the same SvelteKit frontend.

## Contents

| Doc | Covers |
|-----|--------|
| [00-implementation-walkthrough.md](./00-implementation-walkthrough.md) | **Start here.** The phase-by-phase guide to implementing mobile from the desktop base: mobile entry point → platform detection → SAF storage layer → minimal touch UI → idle/blur/pane-open compile cadence → SAF exports/fonts → build & ship, with the real code for each step |
| [01-architecture.md](./01-architecture.md) | How one codebase serves desktop + mobile: entry points, cfg gating, plugin matrix, state initialization |
| [02-storage-and-saf.md](./02-storage-and-saf.md) | The storage model: app-managed workspaces vs SAF folders, `WorkingTreeFs`, images, exports, fonts, packages |
| [03-editor-and-performance.md](./03-editor-and-performance.md) | Why mobile has no live typing preview, idle-save, hot-exit restore, IPC budget, and what to improve |
| [04-ui-patterns.md](./04-ui-patterns.md) | `.mobile.svelte` variants, the platform store, keyboard avoidance, layout rules |
| [05-android-build-release.md](./05-android-build-release.md) | Building, running on device, signing, CI, and the `gen/android` caveat |
| [06-ios-port.md](./06-ios-port.md) | A concrete plan for the iOS port: what carries over, what doesn't, step-by-step |
| [07-roadmap-and-testing.md](./07-roadmap-and-testing.md) | Known gaps, mobile test checklist, and the path from "experimental" to stable |

## Status snapshot (v0.8.1)

**Working on Android:**
- Open/create workspaces in the app-managed directory (`<Documents>/Typwriter/`)
- Open external folders via the Storage Access Framework (SAF) — full
  read/write/compile, not just listing
- Editing with CodeMirror, idle-save (capped at 600 ms), save-on-blur
- Preview as a toggled view (editor ⇄ preview), compiled on save/blur/toggle
- Exports (PDF/PNG/SVG) through SAF save/dir pickers (`*_to_uri` commands)
- Font import from SAF folders (copied into app-private storage)
- Typst package downloads (cached under `<Documents>/Typwriter/Packages`)
- Version history / restore points (SAF-aware content-addressed store)
- Hot-exit: unsaved buffers survive the OS killing the WebView

**Not yet:**
- iOS (entry point exists; storage layer and plugins are Android-only)
- Live typing preview on mobile (intentional — see doc 03)
- In-app updater (desktop-only plugin; mobile updates via store/APK)
- The desktop preview pop-out window (single-window on mobile)

## The three rules of Typwriter mobile

Everything else in this guide elaborates on these:

1. **Never touch the filesystem directly for workspace files.** Always go
   through `WorkingTreeFs` (`vcs.working_tree_fs_for(&root)`). A SAF folder is
   invisible to `std::fs`, and the app holds no broad storage permission. Any
   `std::fs` call against a workspace path is a latent Android bug. (Package
   cache, app-private dirs, and log dirs are exempt — they're always
   std::fs-reachable.)

2. **Never assume the frontend can fetch a file by path.** `convertFileSrc` /
   the asset protocol are std::fs-backed; for SAF roots the backend must ship
   bytes inline (see the `data:` URL path in `read_file`). Check
   `vcs.is_saf_root(&root)` before handing the webview a path.

3. **Never put per-keystroke work on the IPC bridge or compile queue.** The
   mobile WebView bridge is slow and the CPU budget is small. Mobile compiles
   happen at save/blur/toggle cadence, not typing cadence — guard new
   features with `platform.isMobile` accordingly.
