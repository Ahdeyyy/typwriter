# typwriter-mobile

A standalone, Android-first Typst editor built with Tauri 2 + SvelteKit. It shares the
Typwriter *design system* (CSS tokens, Tailwind 4, shadcn-svelte, hugeicons) with
`apps/typwriter-desktop` but **no code** — it's an independent snapshot tuned for touch
and soft keyboards.

Product shape: single open document, file tree as a left sheet, full-screen preview
overlay, no per-keystroke IPC (disk is the source of truth; autosave on idle/blur/
preview-open), touch completion strip above the keyboard, and lazy on-demand page
rendering over the `previewimg://` scheme.

## Syncing a workspace with a folder (per workspace)

Workspaces live in the app's own storage unless the user chooses otherwise,
one workspace at a time:

- **New workspace** has a **Sync with a folder** switch (off by default);
  turning it on shows the costs and the folder it goes into (asked once, then
  reused; **Change** picks another).
- **Open folder** lists an existing folder as a workspace.
- A workspace's long-press menu offers **Sync with a folder…** (copy, check,
  then delete the app copy) or, for one that syncs, **Stop syncing** (brings it
  back into the app; the folder keeps its files).

Every one of these shows the same four-line list of costs first
(`sync-tradeoffs.svelte`): about twice the space, changes from other devices
after a few seconds, a little more battery while open, and choosing which
version to keep when two devices edit the same file. Point it at a folder
Syncthing (or similar) keeps in step and the workspace follows you across
devices. The Typst package store always stays in app storage.

Picked folders are SAF trees, so the app works on a private *mirror* under app
data (`mirrors/<id>/`) and `src-tauri/src/folders/sync.rs` keeps it in step,
keeping the cost as low as it can:

- Changes made in the app go to the folder first, then the mirror.
- A folder opened before opens instantly from its mirror and catches up in
  the background; only a first open waits for the copy (with progress).
- The open file is checked every second (one stat), the whole folder every 4 s
  (one query per directory), nothing while the app is in the background, and
  everything at once on return or with **Sync now**.
- Inbound changes go straight to the editor; the mirror runs no poll watcher.
- Saving over a version another device synced in meanwhile gets **Keep mine** /
  **Reload**. Hidden entries (`.git`, `.stfolder`, `.stversions`) are never
  copied; the mirror's `.typwriter/` never leaves the device.

Sync status stays small: synced workspaces have a sync icon on Home, a dot on
the phone header's files button, and an icon in the file-tree footer (tablets:
the tab strip) that opens the details and **Sync now**. They are there exactly
while syncing runs (opening the workspace starts it; leaving it stops it).
Toasts are kept for the first copy of a folder (before the editor is up) and
for losing or regaining the folder. They time out; while the folder can't be
reached a red cloud button stays in the header, and it (like the toast's
**Details**) opens the same details sheet.

On device, verify: the switch in New workspace, create in a new location, open an
existing folder, reopening (instant) vs first open (progress), an edit made on
another device arriving in the open file (~1 s) and elsewhere (~4 s) with clean
and dirty buffers, backgrounding (paused) and returning (caught up), moving a workspace
into a folder and back, removing a workspace, and a folder deleted or with its access revoked while
open.

## Opening individual Typst documents

Use **Open file** on the home screen to select a `.typ` document through Android's
file picker. You can also choose **Typwriter** in a file manager's **Open with**
menu. Select **Always**, when offered, to make it the default handler for that
file manager's file type. Both cold starts and opens delivered to an already
running app are queued until the editor is ready; unsaved edits must save before
switching documents.

Edits save back to the original URI. If another app grants read access only, the
editor keeps the changes unsaved and shows the provider's error; use **Open file**
to select the document with write access. External edits are checked on resume,
reload, compile, and save. Conflicting unsaved edits require **Keep mine** or
**Reload**.

A standalone session grants access to that file only. Local imports and images
need a workspace; package imports still work. Compilation uses a private mirror
under app data and never creates `.typwriter` or scans files beside the original.
Standalone sessions are not restored automatically after restarting the app.

`src-tauri/build.rs` installs the Android `VIEW` filters from
`src-tauri/android_file_associations.rs` on every Android build, including
after `android init`. There are three, all for `content://` and `file://` URIs:

1. Any MIME type (`*/*`) when the URI path ends in `.typ` (case insensitive).
2. No MIME type at all, again only for paths ending in `.typ`.
3. Any URI, including opaque ones such as `content://provider/document/42`,
   reported as `application/octet-stream`, `text/vnd.typst`, `text/x-typst` or
   `application/x-typst`.

Android cannot filter on a provider's display name, and most file managers,
Downloads and attachment viewers send opaque URIs, which only filter 3 can match.
Android has no MIME type for `.typ`, so those providers report octet-stream.
The cost is that Typwriter is also offered for other unrecognised binary files;
the app checks the provider's actual display name before reading any document
and rejects anything that isn't `.typ`. Photos, PDFs, archives and plain-text
files carry their own types and never list Typwriter — keep wildcards,
`text/*` and `text/plain` out of filter 3. Android 12+ uses suffix matching;
Android 7–11 uses legacy patterns supporting up to 32 dots across the URI path.

On a device, verify opening through the picker, **Open with** from a file manager
with the app stopped and running (including unknown/MIME-free types, dotted paths,
and uppercase extensions), **Open with** from the Downloads app and an email or
chat attachment (opaque URIs), absence from PNG/TXT/PDF choosers, a non-`.typ`
binary being rejected with a message, choosing **Always** and reopening a `.typ` file, save-back to the
original, switching between workspaces and documents, cancellation/non-`.typ`
rejection, a read-only provider,
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

## Dependency licenses

**Settings → Open-source licenses** contains a searchable, offline catalog of
third-party licenses and notices. The catalog includes only dependencies declared
directly in the mobile app's `package.json` and `src-tauri/Cargo.toml`, including
development/build dependencies and target-specific direct crates. Transitive
packages are excluded. Long notices are rendered only when expanded.

After adding, removing or upgrading a direct dependency, run from this app
directory:

```bash
bun run licenses:generate
bun run licenses:check
```

Generation requires `bun install` and internet access to upstream license texts,
and crate archives. Commit `src/lib/licenses/catalog.json` with the dependency
change. Ordinary builds verify, without the network, that the catalog holds
exactly the direct dependency set at its installed or locked versions, each with
a complete notice. Nothing else makes it stale: feature flags, comments,
transitive lockfile bumps and generator edits don't change any notice.

## Updates

Tauri's updater doesn't cover Android, so the app checks for itself:
`check_for_update` (`src-tauri/src/commands/app.rs`) reads the track's
`android.json` — `releases/latest/download/android.json` for stable,
`releases/download/nightly/android.json` for the nightly app (identifier ending
in `.nightly`) — which CI publishes next to the APK. A newer version shows a
toast at launch (at most once a day) and a Download button in Settings, which
opens the APK in the browser; Android installs it over the app, keeping its
data, because it carries the same signing key and a higher versionCode.

Secondary route: [Obtainium](https://github.com/ImranR98/Obtainium) can track
`https://github.com/Ahdeyyy/typwriter` directly. For stable, filter APKs by
`^typwriter_mobile_[0-9].*_arm64\.apk$`; for nightly, enable "Include
prereleases" and filter by `^typwriter_mobile_nightly_.*_arm64\.apk$`.

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
bun tauri android init # or: any command that creates src-tauri/gen/android
bun run icons          # tauri icon app-icon.png + the adaptive icon below
```

Running `tauri icon` before init only refreshes the desktop icons and
`src-tauri/icons/android/` — the APK still ships the default Tauri icon. CI does
this in the "Generate app icons" step of `.github/workflows/android.yml`.

**The adaptive icon is not generated from `app-icon.png`.** `tauri icon` puts the
whole rounded tile into the adaptive foreground, so launchers crop it with their
mask (circle, squircle, teardrop, …). `bun run icons` overwrites it with the
vector layers in `src-tauri/android-icon/`: a full-bleed gradient background, the
T glyph inside the 66dp safe-zone circle, and a monochrome layer for Android 13+
themed icons. If the logo changes, update those drawables too;
`src/android-icon.test.ts` checks the glyph stays inside the safe zone.

The nightly app uses `app-icon-nightly.png` and `bun run icons:nightly`, which
lays `src-tauri/android-icon-nightly/` (the same layers on a dark blue
background) over the stable adaptive icon.

## IPC contract

The single source of truth for the Rust ⇄ frontend command contract is
[`plans/typwriter-mobile/02-rust-core.md`](../../plans/typwriter-mobile/02-rust-core.md).
TypeScript mirror types live in `src/lib/ipc/types.ts`; all `invoke` calls are wrapped
in `src/lib/ipc/commands.ts` (the only place `invoke` is called).

## Layout

See [`plans/typwriter-mobile/00-overview.md`](../../plans/typwriter-mobile/00-overview.md)
for the full repository layout and phased build plan. Build phases 1–7 implement the v1
app; phase 8 (SAF external folders, package-download progress, perf passes) is post-v1.
