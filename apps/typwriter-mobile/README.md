# typwriter-mobile

A standalone, Android-first Typst editor built with Tauri 2 + SvelteKit. It shares the
Typwriter *design system* (CSS tokens, Tailwind 4, shadcn-svelte, phosphor icons) with
`apps/typwriter-desktop` but **no code** — it's an independent snapshot tuned for touch
and soft keyboards.

Product shape: single open document, file tree as a left sheet, full-screen preview
overlay, no per-keystroke IPC (disk is the source of truth; autosave on idle/blur/
preview-open), touch completion strip above the keyboard, and lazy on-demand page
rendering over the `previewimg://` scheme.

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
  keyboard resizes the webview and the editor toolbar docks above it. `gen/android/` is
  generated; if `adjustResize` is missing, **re-apply it after every `android init`**.
  This is the one accepted hand-touch of the generated project.

## IPC contract

The single source of truth for the Rust ⇄ frontend command contract is
[`plans/typwriter-mobile/02-rust-core.md`](../../plans/typwriter-mobile/02-rust-core.md).
TypeScript mirror types live in `src/lib/ipc/types.ts`; all `invoke` calls are wrapped
in `src/lib/ipc/commands.ts` (the only place `invoke` is called).

## Layout

See [`plans/typwriter-mobile/00-overview.md`](../../plans/typwriter-mobile/00-overview.md)
for the full repository layout and phased build plan. Build phases 1–7 implement the v1
app; phase 8 (SAF external folders, package-download progress, perf passes) is post-v1.
