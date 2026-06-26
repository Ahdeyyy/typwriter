# Phase 7 — PDF export, diagnostics drawer, settings

Goal: round out v1 into a shippable app: get a PDF out of the device, see what's wrong
with the document, and tweak the handful of settings that matter.

Depends on: phases 2–6.

## 7.1 PDF export

### Rust — `commands/export.rs`

Two commands (add to the `02-rust-core.md` contract):

| Command | Args | Returns |
|---|---|---|
| `export_pdf_to_uri` | — | `string` (display name of the created file) |
| `export_pdf_to_cache_file` | — | `string` (absolute path of a temp PDF, for sharing) |

Shared core `pdf_bytes(state: &CompileState) -> Result<Vec<u8>, String>`:
take `state.document` (error `"Nothing compiled yet — open the preview first"` when
`None`), run `typst_pdf::pdf(&doc, &PdfOptions::default())` (defaults: auto ident, no
timestamp, PDF 1.7, `tagged: true`). Join diagnostic messages with `"; "` on error.
Reference: desktop `PreviewPipeline::export_pdf_bytes`, minus the standards/timestamp
config — mobile v1 has no export options UI.

`export_pdf_to_uri` (Android): use `tauri-plugin-android-fs`'s save-file dialog
(`show_save_file_dialog` with MIME `application/pdf`, suggested name
`{main_file_stem}.pdf`), write the bytes to the returned URI via the plugin's writer.
This is the same flow the desktop app's `export_pdf_to_uri` command uses — mirror its
plugin calls. On non-Android (dev loop), fall back to `tauri-plugin-dialog`'s save
dialog + `std::fs::write`.

`export_pdf_to_cache_file`: write bytes to `app_cache_dir()/export/{stem}.pdf` and
return the path — the frontend hands it to a share intent. Sharing requires a
FileProvider; if `tauri-plugin-android-fs` exposes a share/send helper in v28, use it,
**otherwise skip the Share button entirely in v1** (the save dialog flow is the
must-have; don't burn time on FileProvider plumbing).

### Frontend

Overflow menu → "Export PDF": if `compileStore.stale || !compileStore.pages.length`,
flush + compile first; if errors exist, confirm ("Document has N errors — export
anyway?" — typst still produced the last good document; note it's the *last successful*
compile that exports). Then `export_pdf_to_uri`; toast success with the file name.

## 7.2 Diagnostics drawer — `components/diagnostics/diagnostics-drawer.svelte`

A shadcn `Drawer` (bottom sheet, ~60vh) shown when `app.overlay === "diagnostics"`,
opened from: the overflow menu, the error chip in the preview top strip, and an
error-count `Badge` that appears in the editor top bar when `compileStore.errors.length > 0`.

Content: list grouped errors-then-warnings; each row =
severity icon (`XCircle` destructive / `Warning` amber) + message (wrap, `font-mono`
small) + hints (muted, indented) + `file:line` suffix when `range` present.

Tap a row → close drawer; if `diag.filePath` differs from the open file,
`editor.loadFile(diag.filePath)`; then move the cursor: convert
`{startLine, startCol}` (0-based, UTF-16 cols) to a CM offset
(`view.state.doc.line(startLine + 1).from + startCol`, clamped to the line end and doc
length), dispatch `{ selection, scrollIntoView: true }`, focus.

Staleness: diagnostics describe the **last compiled** text, which trails the live
buffer by up to one autosave. Show a thin "based on last compile" muted footer line
when `compileStore.stale` — don't try to live-recompile from the drawer.

## 7.3 Settings — `components/screens/settings-overlay.svelte` + `stores/settings.svelte.ts`

Overlay (full-screen sheet from the right, `app.overlay === "settings"`, reachable from
home and the editor overflow menu).

`SettingsStore`: `$state` fields per `AppSettings` (defaults from `02-rust-core.md`),
loaded on startup from `tauri-plugin-store` (`settings.json`, frontend-owned — per the
phase 2 decision there are no Rust settings commands), `save()` debounced 300 ms after
any change.

Settings list (keep it to exactly these in v1):

| Setting | Control |
|---|---|
| Theme | three buttons: Light / Dark / System → `mode-watcher` `setMode` |
| Editor font size | stepper 12–22, live-applies via the phase 4 compartment |
| Line numbers | switch |
| Autosave delay | segmented: 300 ms / 600 ms / 1 s |
| Preview sharpness | segmented: Battery (1.5×) / Balanced (2×) / Crisp (3×) → buckets 2/3/4 |

Plus an About row (app version via `getVersion()` from `@tauri-apps/api/app`, link to
GitHub repo via opener… note: opener plugin isn't installed — use `<a target="_blank">`
which Tauri routes externally, or add `tauri-plugin-opener` here with its capability).

## 7.4 Loose ends checklist (do these now, they're cheap)

- Error toasts everywhere a `ResultAsync` is currently `.mapErr(console.error)`-only.
- `Suspense`-style skeletons: home list, file tree, editor load.
- App icon: proper foreground/background adaptive icon via `bun tauri icon`.
- Disable text selection on all chrome (buttons/bars) — already in base CSS, verify.
- A `README.md` in `apps/typwriter-mobile/` describing the dev loop (`bun tauri android
  dev`), the manifest `adjustResize` note from phase 1, and the IPC contract pointer to
  `plans/typwriter-mobile/02-rust-core.md`.

## Acceptance criteria

1. Export PDF on-device lands a valid PDF in the user-chosen location (opens in a PDF
   reader); export with a stale/errored document behaves per spec.
2. Introduce an error in an imported file (`#import "other.typ"` with a bad symbol):
   the badge appears, the drawer lists it with the right file, tapping it opens
   `other.typ` at the right line.
3. Every setting takes effect immediately and survives an app restart.
4. Theme switch (incl. System) restyles app chrome, editor, and preview consistently.
5. `bun run check` + `cargo check` clean.
