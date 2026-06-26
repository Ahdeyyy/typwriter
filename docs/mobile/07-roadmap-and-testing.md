# 07 — Roadmap and testing: from "experimental" to stable

## Known gaps (Android), prioritized

### Correctness

1. **Cross-file diagnostics are empty on SAF workspaces** —
   `collect_workspace_diagnostics` walks with `std::fs`
   (code review R2). Fix: route through `WorkingTreeFs`.
2. **No watcher coverage for SAF folders** (doc 01) — external edits to a SAF
   workspace aren't detected while the app runs. Low urgency (rare scenario),
   document or poll.
3. **`.log`/`.cfg`/`.tif` files show "Binary format"** on all platforms —
   frontend/backend extension drift (code review S1). Backend should be the
   single source of truth.

### Performance (felt most on mobile)

4. **Heavy sync commands block the main thread** — make `read_file`,
   `save_file`, exports, formatting, and `vcs_*` commands `async`
   (code review R3). This is the single best UX-per-effort fix for Android.
5. **Full-tree VCS hashing per save/compile over SAF Binder IO** (R4) —
   dirty-set tracking or a higher default `min_interval_seconds`.
6. **Tab-persistence churn while typing** (S4) — persist at risk points
   (idle/blur/visibility) instead of per 300 ms burst.
7. **Delta-based shadow updates** (S3) — prerequisite for ever offering an
   opt-in low-frequency live preview on mobile.

### Features

8. **Mobile settings surface** — font re-import reminder for SAF-imported
   font folders; expose log file share.
9. **Android share-target / "Open with Typwriter"** for `.typ` files
   (intent filter + single-file open mode).
10. **iOS** — doc 06.

## Manual test matrix (run before any mobile release)

Three storage contexts, one pass each:

| # | Scenario | Desktop | Android managed | Android SAF |
|---|----------|---------|-----------------|-------------|
| 1 | Create workspace, create `.typ`, set main, compile, preview renders | ☐ | ☐ | ☐ |
| 2 | Open existing workspace → preview paints from disk cache before recompile | ☐ | ☐ | ☐ |
| 3 | Edit → idle-save fires → preview updates after save | ☐ | ☐ | ☐ |
| 4 | Insert image (`image("…")`) → compiles; open image in a tab → renders | ☐ | ☐ | ☐ (data-URL path) |
| 5 | Use a `@preview` package → downloads with progress, compiles | ☐ | ☐ | ☐ |
| 6 | Export PDF / PNG / SVG to a user-picked location | ☐ | ☐ (`_to_uri`) | ☐ (`_to_uri`) |
| 7 | File ops: create/rename/move/delete file & folder; main-file follows renames | ☐ | ☐ | ☐ |
| 8 | Version history: timeline populated, diff renders, restore file + whole workspace, tabs reload | ☐ | ☐ | ☐ |
| 9 | **Kill test:** type without saving → force-stop app → relaunch → unsaved buffer restored, tab dirty | n/a | ☐ | ☐ |
| 10 | Background/foreground cycle mid-edit → no data loss, preview consistent | n/a | ☐ | ☐ |
| 11 | Rotate device / split-screen → layout intact, keyboard inset correct | n/a | ☐ | ☐ |
| 12 | Import fonts from a picked folder → family appears in settings → renders in preview | ☐ | ☐ | ☐ |
| 13 | Workspace export (backup) to a SAF folder, re-import elsewhere | n/a | ☐ | ☐ |
| 14 | Airplane mode: app opens, compiles local docs; package fetch fails gracefully | ☐ | ☐ | ☐ |

## Automated testing strategy

In order of value-for-effort:

1. **Rust unit tests for the pure layer** (no Tauri runtime needed):
   path helpers, offset conversion, page-range parsing, cache keys, dedup
   logic — see code review R17. These cover logic shared by all platforms.
2. **`WorkingTreeFs` contract test:** one test suite written against the
   trait, run against `LocalWorkingTreeFs` on a temp dir. When the iOS
   accessor lands, the same suite runs against it. (The Android accessor can
   only run on-device, but the contract test still pins the expected
   semantics it must match.)
3. **VCS store round-trip tests** against a temp dir via the contract suite:
   commit → list → diff → restore.
4. **Frontend unit tests** (`bun test`): `paths.ts`, `filterTree`,
   `rewritePath`, EditorStore timer semantics with fake timers — including
   the mobile branches (`isMobile` idle-save cap, typing-preview
   suppression) by stubbing the platform store.
5. **CI emulator smoke test** (android.yml): boot a headless emulator,
   install the debug APK, drive one open→edit→compile→export pass via adb +
   UI Automator (or simply assert the app launches and the main activity
   survives 30 s without crashing as a first step).

## Definition of "stable" for Android

The experimental label comes off when:

- The test matrix above passes on two physical devices (one low-RAM) plus
  the emulator, on the three most recent Android majors.
- Kill-test (row 9) passes 10/10 attempts.
- No main-thread command exceeds 100 ms in normal operation (fix #4 above).
- Crash-free sessions ≥ 99.5% over a beta cycle (logcat/Play vitals or a
  privacy-respecting crash counter).
- The SAF diagnostics gap (#1) is fixed — silent feature absence on SAF is
  the kind of inconsistency that erodes trust in the storage layer.
