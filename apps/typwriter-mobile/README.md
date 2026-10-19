# typwriter-mobile

A standalone, Android-first Typst editor built with Tauri 2 + SvelteKit. It shares the
Typwriter *design system* (CSS tokens, Tailwind 4, shadcn-svelte, hugeicons) with
`apps/typwriter-desktop` but **no code** — it's an independent snapshot tuned for touch
and soft keyboards.

Product shape: single open document, file tree as a left sheet, full-screen preview
overlay, no per-keystroke IPC (disk is the source of truth; autosave on idle/blur/
preview-open), touch completion strip above the keyboard, and lazy on-demand page
rendering over the `previewimg://` scheme.

## Opening individual Typst documents

Use **Open file** on the home screen to select a `.typ` document through Android's
file picker. You can also choose **Typwriter** in a file manager's **Open with**
menu. Both cold starts and opens delivered to an already running app are queued
until the editor is ready; unsaved edits must save before switching documents.

Edits save back to the original URI. If another app grants read access only, the
editor keeps the changes unsaved and shows the provider's error; use **Open file**
to select the document with write access. External edits are checked on resume,
reload, compile, and save. Conflicting unsaved edits require **Keep mine** or
**Reload**.

A standalone session grants access to that file only. Local imports and images
need a workspace; package imports still work. Compilation uses a private mirror
under app data and never creates `.typwriter` or scans files beside the original.
Standalone sessions are not restored automatically after restarting the app.

The Android associations are declared in `src-tauri/tauri.conf.json` and generated
by Tauri, so they survive `android init`. They include a `*/*` fallback because
file providers report `.typ` inconsistently, including vendor-specific MIME types
and opaque content URIs with no extension in the path.
Android matches these MIME types, so Typwriter can appear for other
files too; the app validates the provider's filename and accepts only `.typ`.

On a device, verify opening through the picker, **Open with** from a file manager
with the app stopped and running, save-back to the original, switching between
workspaces and documents, cancellation/non-`.typ` rejection, a read-only provider,
and external edits with both clean and dirty buffers.

## Dev loop

```bash
bun install                 # from the repo root (workspace)
bun tauri android dev       # run on an Android emulator/device
bun tauri dev               # desktop window — convenience dev loop only
```

The desktop window exists purely for the dev loop; nothing should depend on
desktop-only behavior. Android is the only shipping target.

### Verifying changes

```bash
bun run check               # svelte-check (frontend types)
cd src-tauri && cargo check # Rust type-check (set RUST_MIN_STACK=8388608 on Windows)
bun test                    # pure-logic unit tests (completion logic)
cd src-tauri && cargo test  # Rust unit tests (offset/path-guard/preview-key/today)
```

On Windows, large crates (`typst-library`) can crash a full build with
`STATUS_STACK_BUFFER_OVERRUN`; set `RUST_MIN_STACK=8388608`. Prefer `cargo check` over
full builds — it's much faster and disk-cheaper.

## Android manifest note (`adjustResize`)

After `bun tauri android init`, verify
`src-tauri/gen/android/app/src/main/AndroidManifest.xml` contains:

- `<uses-permission android:name="android.permission.INTERNET" />` — Typst package
  downloads.
- `android:windowSoftInputMode="adjustResize"` on the main activity — so the soft
  keyboard resizes the webview and the editor toolbar docks above it. Tauri's template
  does **not** set this; `gen/android/` is generated, so it must be **re-applied after
  every `android init`**. CI does it in the "Patch AndroidManifest" step of
  `.github/workflows/android.yml`; local dev builds need the hand-edit.

## App icons (`bun tauri icon`)

The source image is `app-icon.png` at the app root. **Order matters:**
`tauri icon` writes Android launcher icons into
`src-tauri/gen/android/app/src/main/res/` only when that project already exists —
otherwise it drops them in `src-tauri/icons/android/`, a staging copy that
*nothing* consumes. Since `src-tauri/gen/` is not committed and `android init`
scaffolds the project with the default Tauri icons, regenerating them is part of
every fresh Android build:

```bash
bun tauri android init      # or: any command that creates src-tauri/gen/android
bun tauri icon app-icon.png # now lands in gen/android/.../res
```

Running `tauri icon` before init only refreshes the desktop icons and
`src-tauri/icons/android/` — the APK still ships the default Tauri icon. CI does
this in the "Generate app icons" step of `.github/workflows/android.yml`.

## IPC contract

The single source of truth for the Rust ⇄ frontend command contract is
[`plans/typwriter-mobile/02-rust-core.md`](../../plans/typwriter-mobile/02-rust-core.md).
TypeScript mirror types live in `src/lib/ipc/types.ts`; all `invoke` calls are wrapped
in `src/lib/ipc/commands.ts` (the only place `invoke` is called).

## Layout

See [`plans/typwriter-mobile/00-overview.md`](../../plans/typwriter-mobile/00-overview.md)
for the full repository layout and phased build plan. Build phases 1–7 implement the v1
app; phase 8 (SAF external folders, package-download progress, perf passes) is post-v1.
