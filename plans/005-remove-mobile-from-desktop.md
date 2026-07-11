# 005 — Remove all mobile/Android code from `apps/typwriter-desktop`

**Status:** DONE
**Written against commit:** `e4bf10d` (2026-07-09). If the cited code has moved,
re-verify with the grep commands in each phase before editing — the greps, not
the line numbers, are the source of truth.

## Why this is safe to do

The Android build of the desktop app is **legacy**. A standalone mobile app
already exists at `apps/typwriter-mobile/` and is what mobile users get (CI's
`android.yml` even labels the desktop-app APK matrix entry `legacy`). After
this plan, `typwriter-desktop` targets Windows / macOS / Linux only.

## Ground rules — read before touching anything

1. **Only edit `apps/typwriter-desktop/` and `.github/workflows/android.yml`.**
   Never touch `apps/typwriter-mobile/` or `apps/typwriter-web/`. If a file
   path you are about to edit does not start with `apps/typwriter-desktop/`
   (or is not the one workflow file named above), stop.
2. **Work on a branch.** From a clean tree:
   `git checkout -b chore/remove-mobile-from-desktop`
   Commit at the end of every phase so a bad phase can be reverted alone.
3. **The rule for every conditional you remove:** mobile branches are deleted,
   desktop branches are kept and become unconditional. Never delete the
   desktop side of an `if`.
4. **Two `isMobile`s exist. Only one dies.**
   - `platform.isMobile` from `src/lib/stores/platform.svelte.ts` = *platform*
     detection (Android/iOS). **This one is removed.**
   - `sidebar.isMobile` inside `src/lib/components/ui/sidebar/**` and the hook
     `src/lib/hooks/is-mobile.svelte.ts` = *viewport width* (narrow window ⇒
     sheet-style sidebar). This is shadcn responsive UI and applies to desktop
     windows too. **Do NOT delete or edit these.**
5. **This machine cannot run full Rust builds or `cargo test`** (Windows
   linker limits — see root memory). Verification ceiling is
   `cargo check --all-targets`. Real tests run in CI (`.github/workflows/ci.yml`).
6. Do **not** run `bun run dev` to "look at" the app — it's a Tauri shell, not
   a browser app.

## Phase 0 — Baseline (do this first, verbatim)

Run these and confirm they pass **before changing anything**, so that later
failures are known to be yours:

```bash
cd apps/typwriter-desktop && bun run check          # svelte-check, 0 errors
cd apps/typwriter-desktop && bun test               # all pass
cd apps/typwriter-desktop/src-tauri && RUST_MIN_STACK=8388608 cargo check --all-targets
```

(On this machine always `cd` inside the same command as cargo — the shell cwd
drifts between calls.)

## Phase 1 — CI: stop building the legacy Android APK

**File:** `.github/workflows/android.yml`

In the `build-android` job's `strategy.matrix.include`, delete the whole
`- name: legacy` entry (the one with `app_path: apps/typwriter-desktop`).
Keep the `- name: mobile` entry untouched.

Do **not** touch `.github/workflows/nightly.yml` — its Android job already
builds only `apps/typwriter-mobile`. Do not touch `ci.yml`.

**Verify:** `grep -n "typwriter-desktop" .github/workflows/android.yml` → no matches.

**Commit:** `ci: drop legacy Android build of the desktop app`

## Phase 2 — Frontend (`apps/typwriter-desktop/src/`)

Do the steps in this order; the tree should typecheck at the end of the phase,
not necessarily between steps.

### 2.1 Delete mobile-only files

```
src/lib/components/sidebar/filetree.mobile.svelte
src/lib/components/sidebar/preview.mobile.svelte
src/lib/components/editor/tab-bar.mobile.svelte
src/lib/hooks/mobile-keyboard.ts
```

Reminder: `src/lib/hooks/is-mobile.svelte.ts` **stays** (ground rule 4).

### 2.2 Remove the imports/uses of those files

- `src/routes/+layout.svelte` — delete the `installKeyboardAvoider` import and
  the `$effect`/`onMount` block that calls it. Also: every `platform.isDesktop`
  guard in this file becomes unconditional (delete the `if`, keep the body).
- `src/routes/+page.svelte` — `platform.isDesktop` guards become unconditional
  (e.g. `const win = Window.getCurrent();`).
- `src/lib/components/pages/workspace.svelte` — delete the `PreviewMobile`
  import and the `{#if platform.isMobile}` branch that renders it (keep the
  `{:else}`/desktop markup, un-nested). `isDesktop` guards → unconditional.
- `src/lib/components/editor/editor-pane.svelte` — delete the `TabBarMobile`
  import, the `{#if ... platform.isMobile}` block rendering it, the
  `class:mobile-editor` binding, the `.mobile-editor` style rule, and the
  `platform.isMobile ? 'pb-2' : ''` class ternary. Conditions like
  `{#if editor.tabs.length > 0 && !platform.isMobile}` lose only the
  `platform` part (`{#if editor.tabs.length > 0}`).
- `src/lib/components/sidebar/app-sidebar.svelte` — delete the
  `FileTreeMobile` import and its `{#if platform.isMobile}` branch; keep the
  desktop `FileTree`. `isDesktop` guards → unconditional.
- `src/lib/components/sidebar/filetree.svelte` and
  `filetree-controller.svelte.ts` — update the header comments that mention
  the (now deleted) mobile variant. No logic changes.

### 2.3 Remove AndroidFs / SAF usage

- `src/lib/components/pages/home.svelte` — delete the
  `import { AndroidFs } from "tauri-plugin-android-fs-api"` line, the SAF
  directory-picker function (the one calling `AndroidFs.showOpenDirPicker` +
  `persistPickerUriPermission` + `registerSafWorkspaceRoot`), and every
  `{#if platform.isMobile}` UI section (mobile workspace list, mobile create
  flow). Every `platform.isMobile ? A : B` expression collapses to `B` (the
  desktop value). Replace `platform.displayPath(x)` with just `x` and delete
  the local `displayPath` helper.
- `src/lib/components/pages/settings.svelte` — delete the `AndroidFs` import,
  the two `if (platform.isMobile)` picker branches (keep the desktop dialog
  path that follows them), the `importFontDirectoryUri` / `safTreeUriToPath`
  imports and calls, the `{#if platform.isMobile}` UI block, and replace
  `platform.displayPath(dir)` with `dir`.
- `src/lib/services/workspace-file-service.ts` — delete the `AndroidFs`
  import and the android import-service object; the
  `platform.isMobile ? androidImportService : desktopImportService` selector
  becomes just the desktop service (you can inline it and drop the selector).
- `src/lib/services/export-service.ts` — same pattern: delete the `AndroidFs`
  import, the android file-service object, and the selector; keep only the
  desktop service.

### 2.4 Prune the IPC layer

**File:** `src/lib/ipc/commands.ts` — delete these exports and their doc
comments (each is Android-only):
`MobileWorkspaceEntry`, `getMobileWorkspacesDir`, `listMobileWorkspaces`,
`safTreeUriToPath`, `registerSafWorkspaceRoot`, `importFilesFromUris`,
`exportWorkspaceToDirUri`, `exportPdfToUri`, `exportPngToDirUri`,
`exportSvgToDirUri`, `exportHtmlToUri`, `importFontDirectoryUri`.

**File:** `src/lib/types.ts` — in `FileContentResponse`, remove the
`data?: string | null` member of the `image` variant and its comment (it was
only populated for SAF roots).

**File:** `src/lib/stores/editor.svelte.ts` — the image-src resolver near the
top (comment mentions SAF) currently prefers `response.data`; simplify it to
always use `convertFileSrc(path)`. Also in this file: the
`if (!platform.isMobile)` gate around live per-keystroke preview goes away
(keep the body — desktop always live-previews), and the
`platform.isMobile ? shortDelay : longDelay` save-delay ternary collapses to
the desktop value. Update the comments that explain the mobile behavior.

### 2.5 Rewrite the platform store

Replace the **entire contents** of `src/lib/stores/platform.svelte.ts` with:

```ts
// Platform detection. Uses `@tauri-apps/plugin-os` to identify the host OS.

import { platform as tauriPlatform } from "@tauri-apps/plugin-os";
import { getVersion } from "@tauri-apps/api/app";

export type Os = "macos" | "windows" | "linux" | "unknown";

class PlatformStore {
  os = $state<Os>("unknown");
  appVersion = $state("");

  isMac = $derived(this.os === "macos");

  constructor() {
    if (typeof window === "undefined") return;

    try {
      this.os = tauriPlatform() as Os;
    } catch {
      this.os = "unknown";
    }

    getVersion()
      .then((version) => {
        this.appVersion = version;
      })
      .catch(() => {});
  }
}

export const platform = new PlatformStore();
```

This deletes `isMobile`, `isDesktop`, `formFactor`, `hasDesktopWindowControls`,
`documentsDirPrefix`, and `displayPath`. Now fix every remaining call site
(`bun run check` will list them; the fixes are mechanical):

- `platform.isMobile` in a condition → the condition is `false`: delete the
  mobile branch, keep the other.
- `platform.isDesktop` in a condition → the condition is `true`: delete the
  guard, keep the body.
- `platform.hasDesktopWindowControls` (used in
  `src/lib/components/titlebar/titlebar.svelte`) → always true: remove the
  `{#if}` wrapper, keep the window controls.
- `platform.displayPath(x)` → `x`.

Known call-site files (verify with the grep below; there may be no others):
`+layout.svelte`, `+page.svelte`, `stores/editor.svelte.ts`,
`stores/preview.svelte.ts`, `components/pages/{home,settings,workspace}.svelte`,
`components/editor/{editor-pane,text-editor-tab}.svelte`,
`components/sidebar/{app-sidebar,preview-controller.svelte.ts}`,
`components/vcs/timeline.svelte`, `components/titlebar/titlebar.svelte`.

In `text-editor-tab.svelte`: the `!platform.isMobile &&` prefix drops out of
the indentation-markers condition; the mobile-only CodeMirror extensions
spread and the mobile `paddingTop` on `.cm-scroller` are deleted.

### 2.6 Dependency + comment cleanup

- `package.json` — remove the `"tauri-plugin-android-fs-api"` dependency,
  then run `bun install` **from the repo root** (bun workspaces).
- `src/routes/layout.css` — delete the `env(safe-area-inset-*)` padding block
  (~line 733; it exists for phone notches).
- `src/lib/preview-url.ts`, `src/lib/logger.ts`,
  `src/lib/stores/settings.svelte.ts` — comment-only mentions of Android;
  reword the comments, change no logic.

### 2.7 Phase gate

```bash
cd apps/typwriter-desktop && bun run check    # 0 errors
cd apps/typwriter-desktop && bun test         # all pass
```

```bash
cd apps/typwriter-desktop/src && grep -rniE "androidfs|android-fs|saf|isMobile|displayPath|formFactor" .
```

The **only** acceptable remaining matches are:
- anything under `lib/components/ui/sidebar/` (responsive `isMobile` — ground rule 4)
- `lib/hooks/is-mobile.svelte.ts` itself
- incidental words like `fromSafePromise` / “safety” (the regex `saf` catches
  them; they are fine)

Anything else is unfinished work from this phase.

**Commit:** `feat(desktop): remove mobile UI, SAF services, and platform branches`

## Phase 3 — Rust (`apps/typwriter-desktop/src-tauri/`)

### 3.1 `src/lib.rs`

1. Delete `#[cfg_attr(mobile, tauri::mobile_entry_point)]` above `run()`.
2. The updater plugin is currently inside
   `#[cfg(not(any(target_os = "android", target_os = "ios")))] { ... }` —
   make it unconditional: `builder = builder.plugin(tauri_plugin_updater::Builder::new().build());`
   directly (and drop the now-unneeded `#[allow(unused_mut)]` / `mut` dance if
   the compiler agrees).
3. Delete `.plugin(tauri_plugin_android_fs::init())`.
4. In the `on_window_event` closure, remove the `#[cfg(desktop)]` attribute
   (it is now always true) and update the comment that says the popout is
   desktop-only because mobile lacks multi-window.
5. From the `use commands::{...}` block **and** the `invoke_handler!` list,
   remove exactly these 11 commands:
   `get_mobile_workspaces_dir`, `list_mobile_workspaces`,
   `saf_tree_uri_to_path`, `register_saf_workspace_root`,
   `import_files_from_uris`, `export_workspace_to_dir_uri`,
   `export_pdf_to_uri`, `export_png_to_dir_uri`, `export_svg_to_dir_uri`,
   `export_html_to_uri`, `import_font_directory_uri`.
6. Update the setup comment about SAF (“a folder picked via Android's Storage
   Access Framework…”).

### 3.2 `src/commands/export.rs`

Delete the four `*_to_uri` / `*_to_dir_uri` command functions and the
`use tauri_plugin_android_fs::…` import. Keep `export_pdf`, `export_png`,
`export_svg`, `export_html` untouched.

### 3.3 `src/commands/workspace.rs`

Delete: the `use tauri_plugin_android_fs::…` import, `import_files_from_uris`,
`export_workspace_to_dir_uri` **and** its private recursive copy helper,
`resolve_mobile_workspaces_root`, `get_mobile_workspaces_dir`,
`list_mobile_workspaces`, the `MobileWorkspaceEntry` struct,
`saf_tree_uri_to_path` (with its `TREE_PREFIX` const and URL-decoding
helpers), and `register_saf_workspace_root`. Keep `import_files` (the
desktop importer) and everything else.

### 3.4 `src/commands/settings.rs`

- Every `#[cfg(target_os = "android")]` item/block: delete it. Every
  `#[cfg(not(target_os = "android"))]` twin: keep the body, drop the attribute.
- Delete the whole “Android font import” section — the Android
  `import_font_directory_uri` implementation, its helpers, **and** the
  non-Android stub of the same name (the stub only existed so the command
  macro compiled on desktop; the command is gone from `lib.rs` now).
- Delete the Android font-copies-dir logic in the font-directory code
  (~line 220 `cfg` block) — keep the plain desktop path.

### 3.5 `src/commands/editor.rs`

- In `read_file`: delete `let is_saf = vcs.is_saf_root(&root);` and the whole
  `if is_saf { ... }` block (the base64 `data:` URL path). Keep the
  `fs = vcs.working_tree_fs_for(&root)` line — text reads still go through it.
- In `FileContentResponse::Image`, remove the `data: Option<String>` field and
  its doc comment; fix the remaining constructor (drop `data: None`).
- Reword doc comments that mention SAF/Android.

### 3.6 `src/vcs/`

- `fs.rs` — delete everything gated `#[cfg(target_os = "android")]`: the
  `AndroidWorkingTreeFs` struct, its impls, helpers. **Keep** the
  `WorkingTreeFs` trait and the std impl — the rest of the crate still uses
  them and they cost nothing on desktop.
- `mod.rs` — delete the `saf_roots` field (+ its init), `register_saf_root`,
  `is_saf_root`, and the Android `working_tree_fs` variant. For every
  `#[cfg(target_os = "android")]` / `#[cfg(not(target_os = "android"))]` pair
  of blocks: delete the Android block, keep the other block's body and drop
  its attribute. Remove the now-unused `tauri_plugin_android_fs` /
  `HashMap` imports if the compiler flags them.
- `commit.rs`, `store.rs`, `paths.rs` — comment-only Android/SAF mentions;
  reword, change no logic.

### 3.7 `src/world/mod.rs` and `src/workspace/mod.rs`

- `world/mod.rs` — delete the `#[cfg(any(target_os = "android", target_os = "ios"))]`
  import (~line 20) and the Android/iOS arm of the package-directories
  resolver (~line 129); keep the desktop arm, drop its `#[cfg]` attribute.
  Reword SAF comments.
- `workspace/mod.rs` — Android mentions here are comments explaining why reads
  go through `WorkingTreeFs`; the code stays (it degrades to std::fs), just
  reword the comments.
- `compiler/mod.rs` — comment-only mentions; reword.

### 3.8 Manifests, capabilities, generated project

- `Cargo.toml`:
  - Delete the `tauri-plugin-android-fs = { ... }` dependency.
  - Delete the whole `[target.'cfg(any(target_os = "android"))'.dependencies]`
    section (vendored OpenSSL — mobile-only).
  - Delete the `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`
    section and move `tauri-plugin-updater = "2"` into the main
    `[dependencies]` table.
  - In `[lib]`, change `crate-type = ["staticlib", "cdylib", "rlib"]` to
    `crate-type = ["rlib"]` — staticlib/cdylib exist only for the mobile
    toolchains. (Side benefit: this may fix the local `cargo test` linker
    failures noted in root memory.)
- `capabilities/default.json` — remove the `"android-fs:default"` permission
  entry.
- Delete the directory `src-tauri/gen/android/` entirely
  (`git rm -r apps/typwriter-desktop/src-tauri/gen/android`). Keep
  `gen/schemas/`.
- `app-icon.json` (app root) — remove the `"android_fg"` and
  `"android_fg_scale"` keys; delete the file `app-icon-mobile.png`.

### 3.9 Phase gate

```bash
cd apps/typwriter-desktop/src-tauri && RUST_MIN_STACK=8388608 cargo check --all-targets
```

Must pass with **zero errors and zero new warnings** (unused-import warnings
mean step 3.6/3.7 cleanup is incomplete).

```bash
cd apps/typwriter-desktop/src-tauri/src && grep -rniE "android|mobile|saf_|saf " .
```

Expected result: **no matches**. Then:

```bash
cd apps/typwriter-desktop && grep -rn "android" src-tauri/Cargo.toml src-tauri/capabilities package.json app-icon.json
```

Expected: no matches. (`Cargo.lock` will clean itself up on the next cargo run;
`cargo check` above already rewrote it — commit the lockfile change.)

**Commit:** `feat(desktop): remove Android/SAF backend, plugin, and build targets`

## Phase 4 — Final sweep

1. Repo-wide check (from the repo root):
   ```bash
   grep -rniE "android|\.mobile|isMobile" apps/typwriter-desktop --include="*.{rs,ts,svelte,json,toml,css}" | grep -v "ui/sidebar" | grep -v "is-mobile.svelte"
   ```
   Investigate every hit; the goal is zero.
2. Re-run the full Phase 0 baseline (svelte-check, bun test, cargo check).
3. Docs: `apps/typwriter-desktop/CLAUDE.md`, `apps/typwriter-desktop/AGENTS.md`,
   and the root `CLAUDE.md` were already rewritten for the desktop-only
   architecture (2026-07-09) — remove the “legacy mobile code is being removed,
   see plan 005” caveat lines from them, since it is now done.
4. Flip this plan's status to DONE here and in `plans/README.md`.
5. CI is the real test runner: after pushing, confirm `.github/workflows/ci.yml`
   is green (it runs the Rust tests this machine can't link).

**Commit:** `docs: desktop app is desktop-only; mark plan 005 done`

## Things you might be tempted to do — don't

- Don't remove the `WorkingTreeFs` trait / `working_tree_fs_for` indirection.
  It still routes all reads and costs nothing; collapsing it is a separate
  refactor with real regression risk.
- Don't touch `src/lib/hooks/is-mobile.svelte.ts` or anything under
  `src/lib/components/ui/sidebar/` (ground rule 4).
- Don't rename the app, crate, or package; don't renumber versions.
- Don't edit `apps/typwriter-mobile/` even to "sync" something.
- Don't try `cargo build`, `cargo test`, or `bunx tauri build` locally
  (ground rule 5).
