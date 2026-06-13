# 00 — Implementation walkthrough: from desktop app to mobile app

This is the end-to-end "how to build it" guide. It walks through turning the
desktop Tauri 2 + SvelteKit app into the mobile app in six phases, each of
which ends with something that runs. The other docs in this folder are the
deep references; this one is the spine that ties them together.

The three product requirements that shape everything:

1. **Minimal editor, optimized for touch** — single window, one view at a
   time (editor ⇄ preview toggle), bottom tab bar, no hover affordances.
2. **No per-keystroke preview** — the preview compiles when the editor goes
   *idle*, when focus leaves the editor, and when the preview pane is
   *opened* — never on every keystroke.
3. **SAF for external file access** — Android scoped storage means no broad
   storage permission; user-picked folders are reachable only through the
   Storage Access Framework.

All file paths below are relative to `apps/typwriter-desktop/`.

---

## Phase 0 — Make the crate mobile-capable

Tauri 2 runs the same Rust crate on desktop and mobile, but mobile loads it
as a *library* from a generated native project rather than via `main.rs`.

**1. Library crate types** — `src-tauri/Cargo.toml`:

```toml
[lib]
crate-type = ["staticlib", "cdylib", "rlib"]
```

**2. Mobile entry point** — `src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { /* the one and only app builder */ }
```

Desktop still enters through `main.rs` → `run()`. There is exactly one
`run()`; platform differences live in `cfg` blocks and runtime checks, never
in separate binaries (see [01-architecture.md](./01-architecture.md) for the
cfg-gating conventions).

**3. Generate the Android project** — `bun tauri android init` creates
`src-tauri/gen/android/`. It is committed; only `AndroidManifest.xml` and the
signing config are hand-maintained (see
[05-android-build-release.md](./05-android-build-release.md)).

**4. Android-only build fixes** — `src-tauri/Cargo.toml`:

```toml
# Cross-compilation can't find a system OpenSSL for typst-kit's
# transitive consumers; vendor it on Android.
[target.'cfg(target_os = "android")'.dependencies]
openssl = { version = "*", features = ["vendored"] }
```

and the updater plugin (auto-update doesn't exist on mobile) is target-gated
out with `cfg(not(any(target_os = "android", target_os = "ios")))`.

**5. Add the SAF plugin** — `tauri-plugin-android-fs` (pinned `=28.1.0`) goes
in the unconditional `[dependencies]`; the crate no-ops off Android, so it
can be registered unconditionally in the builder.

**Checkpoint:** `bun tauri android dev` boots the unmodified desktop UI on a
device/emulator. It will be unusable (desktop layout, broken file access) —
that's what the next phases fix.

---

## Phase 1 — Platform detection

Everything mobile branches off one store:
[`src/lib/stores/platform.svelte.ts`](../../apps/typwriter-desktop/src/lib/stores/platform.svelte.ts)

```ts
import { platform as tauriPlatform } from "@tauri-apps/plugin-os";

class PlatformStore {
  os = $state<Os>("unknown");
  isMobile = $derived(this.os === "android" || this.os === "ios");
  isDesktop = $derived(!this.isMobile);
  hasDesktopWindowControls = $derived(this.isDesktop);
  // displayPath(path): strips the <Documents>/ prefix on mobile so users
  // see "Typwriter/Thesis", not /storage/emulated/0/Android/data/…
}
export const platform = new PlatformStore();
```

Two branching conventions, chosen by how different the platforms are:

- **Behavior differs** → `if (platform.isMobile)` inline (e.g. suppressing
  the typing-preview path, capping the idle-save delay).
- **Interaction model differs** → a sibling `*.mobile.svelte` component next
  to the desktop one, sharing logic through a `*-controller.svelte.ts` runes
  module so neither view duplicates state (see
  [04-ui-patterns.md](./04-ui-patterns.md)).

---

## Phase 2 — The storage layer: SAF behind one abstraction

This is the largest piece of real systems work. Android scoped storage means
the app can `std::fs` only its own directories; any folder the *user* picks
is reachable solely through SAF (Binder calls to a `DocumentsProvider`).
Full detail in [02-storage-and-saf.md](./02-storage-and-saf.md); the
implementation order is:

### 2a. Two classes of workspace

- **App-managed** (default): `<Documents>/Typwriter/` in app-private
  external storage, resolved via Tauri's `path().document_dir()`. Plain
  `std::fs` works; no permissions needed. Commands: `create_workspace`,
  `list_mobile_workspaces`, `get_mobile_workspaces_dir`.
- **SAF workspaces**: any folder the user picks with the android-fs
  directory picker. The app receives a **tree URI**, not a path.

### 2b. The `WorkingTreeFs` trait

Every byte of workspace IO goes through one trait —
[`src-tauri/src/vcs/fs.rs`](../../apps/typwriter-desktop/src-tauri/src/vcs/fs.rs):

```rust
pub trait WorkingTreeFs {
    fn read_dir(&self, dir: &Path) -> Result<Vec<WorkingEntry>, String>;
    fn read_file(&self, path: &Path) -> Result<Vec<u8>, String>;
    fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String>;
    fn create_dir_all(&self, path: &Path) -> Result<(), String>;
    fn remove_file(&self, path: &Path) -> Result<(), String>;
    fn remove_dir(&self, path: &Path) -> Result<(), String>;
    fn exists(&self, path: &Path) -> bool;
    // Default impls built on the primitives, because SAF has no atomic
    // rename across a document tree:
    fn rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        self.copy_tree(from, to)?;
        self.remove_tree(from)
    }
    // … remove_dir_all / copy_tree / remove_tree defaults
}
```

Two implementations: `LocalWorkingTreeFs` (std::fs, overrides `rename` with
the atomic `std::fs::rename`) and `AndroidWorkingTreeFs` (android-fs plugin,
`#[cfg(target_os = "android")]`).

`VcsState` owns a registry mapping workspace root → SAF `FileUri`, and is the
factory: `vcs.working_tree_fs_for(&root)` returns the Android accessor when
the root is registered, the local one otherwise. `VcsState` is constructed
**first** in the setup hook precisely so every other subsystem (compiler,
file tree, file ops, version history) can resolve the right accessor.

Consumers to convert — this list doubles as the "did I miss a path?" audit:

| Consumer | Where |
|----------|-------|
| Compiler reads (`World::source`/`World::file`) | `world/mod.rs::read_file_bytes` |
| Editor open/save | `commands/editor.rs::read_file` / `save_file` |
| File tree | `workspace/mod.rs::get_file_tree` |
| Create/delete/rename/move/import | `workspace/mod.rs` |
| Version history | `vcs/*` |

### 2c. The registration flow (frontend → backend)

From [`home.svelte`](../../apps/typwriter-desktop/src/lib/components/pages/home.svelte):

```ts
async function pickMobileFolder(): Promise<string | null> {
  const uri = await AndroidFs.showOpenDirPicker({ localOnly: true });
  if (!uri) return null;
  // Persist access across app restarts:
  await AndroidFs.persistPickerUriPermission(uri);
  // Backend maps tree URI → stable pseudo-path, stores uri in the
  // VcsState saf_roots registry, returns the path:
  const result = await registerSafWorkspaceRoot(uri);
  return result.isOk() ? result.value : null;
}
```

After registration, the ordinary `open_folder(path)` proceeds and every layer
resolves the right accessor from the registry. **Never** use
`tauri-plugin-dialog` pickers on Android — they cannot grant SAF access.

### 2d. The webview can't fetch SAF files — ship bytes inline

`convertFileSrc` / the asset protocol are std::fs-backed. For images in a SAF
workspace, `read_file` detects the root and inlines the bytes
([`commands/editor.rs`](../../apps/typwriter-desktop/src-tauri/src/commands/editor.rs)):

```rust
let fs = vcs.working_tree_fs_for(&root);
if vcs.is_saf_root(&root) {
    let bytes = fs.read_file(abs)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    return Ok(FileContentResponse::Image {
        path: …, mime: mime.to_string(),
        data: Some(format!("data:{mime};base64,{encoded}")),
    });
}
// non-SAF: return path: …, data: None → frontend uses convertFileSrc(path)
```

The frontend helper `imageSrcFromResponse` prefers `data` when present.

### 2e. std::fs exemptions (deliberate)

The Typst **package cache** moves to `<Documents>/Typwriter/Packages`
(`world/mod.rs::packages_dir`, gated `any(android, ios)`) because typst-kit's
default OS dirs are blocked by scoped storage — but it stays std::fs, being
app-private. Same for settings, logs, and preview disk cache.

**Checkpoint:** open an app-managed workspace and a SAF folder; the file tree
lists, files open, edits save, images render in both.

---

## Phase 3 — Minimal mobile editor UI

The desktop layout (titlebar, resizable split panes, pop-out preview window)
is replaced wholesale on mobile by a single-window, one-view-at-a-time shell.
From [`workspace.svelte`](../../apps/typwriter-desktop/src/lib/components/pages/workspace.svelte):

```svelte
{#if platform.isMobile}
  <!-- floating sidebar trigger + editor⇄preview toggle button -->
  <Button onclick={() => {
    // Leaving the editor for the preview: flush so the rendered
    // preview reflects the latest edits and the buffer is on disk.
    if (mobileView === "editor") void editor.flushActiveTab();
    mobileView = mobileView === "editor" ? "preview" : "editor";
  }} … />

  <div class="relative h-full w-full">
    <div class="absolute inset-0" class:hidden={mobileView !== "editor"}>
      <EditorPane />
    </div>
    <div class="absolute inset-0" class:hidden={mobileView !== "preview"}>
      <PreviewMobile visible={mobileView === "preview"} />
    </div>
  </div>
{:else}
  <Resizable.PaneGroup …>…</Resizable.PaneGroup>
{/if}
```

Both views stay mounted (`hidden`, not `{#if}`) so toggling is instant and
scroll/cursor state survives. Components that needed a structurally different
mobile variant, each with a shared controller module:

```
editor/tab-bar.svelte        / tab-bar.mobile.svelte      (bottom bar — thumb reach)
sidebar/filetree.svelte      / filetree.mobile.svelte
sidebar/preview.svelte       / preview.mobile.svelte      (compact toolbar, no tooltips)
```

The mobile rules ([04-ui-patterns.md](./04-ui-patterns.md) has the full set):
44×44 px touch targets, long-press instead of right-click, confirmation for
destructive actions, no hover-only affordances, paths through
`platform.displayPath()`.

**Keyboard:** `AndroidManifest.xml` sets `windowSoftInputMode="adjustResize"`
so the layout viewport shrinks under the keyboard, and
`lib/hooks/mobile-keyboard.ts` (`installKeyboardAvoider`) scrolls focused
fields into view and publishes `--keyboard-inset` for bottom-anchored UI.
CodeMirror is deliberately exempt — it manages its own viewport, and fighting
it causes jitter.

**Checkpoint:** the app is navigable one-handed; typing doesn't hide the
caret under the keyboard; tabs are reachable at the bottom.

---

## Phase 4 — Compile cadence: idle, blur, and pane-open (never keystroke)

Desktop ships the whole buffer over IPC and queues a compile on every typing
tick. On Android this froze typing — the WebView IPC bridge serializes on the
main thread, and the compiler competes with the IME for a small CPU budget.
The mobile design inverts it: **compiles ride the save path**, and saves
happen at human-scale moments. (`save_file` in Rust requests a `Save`
compile, so "flush" below always implies "recompile + preview update".)

### 4a. Suppress the typing path

[`editor.svelte.ts`](../../apps/typwriter-desktop/src/lib/stores/editor.svelte.ts),
in `handleTabContentChange`:

```ts
if (!platform.isMobile) {
    this._scheduleTypingPreview(tab);   // desktop-only
}
this._scheduleIdleSave(tab);            // both platforms
```

### 4b. Idle → save → compile

The idle-save timer is the "editor is idle after some time" trigger. On
mobile it is capped aggressively, because Android can kill the app at any
moment and a short cap shrinks the window where edits live only in WebView
memory:

```ts
const delay = platform.isMobile
    ? Math.min(settings.autoSaveDelayMs, 600)
    : settings.autoSaveDelayMs;
this._idleSaveTimers.set(tab.id, setTimeout(() => {
    void this.flushTab(tab.id).catch(() => {});
}, delay));
```

### 4c. The full trigger matrix

| Trigger | Mechanism |
|---------|-----------|
| Editor idle (~600 ms) | idle-save timer → `flushTab` → save → `Save` compile |
| Focus leaves the editor | mobile save-on-blur handler |
| **Preview pane opened** | the toggle button calls `editor.flushActiveTab()` *before* switching views (Phase 3 snippet) — the compile runs while the view transition happens |
| Navigating away (Home/Settings) | `editor-pane.svelte` `onDestroy` → `flushAllTabs()` |

### 4d. The pane shows something immediately

Opening the preview must not show a blank screen while the compile runs:

- `PreviewMobile` and its `previewController` are a **singleton** that stays
  subscribed while hidden, so pages are already current when the pane
  becomes visible; the `visible` prop just triggers `reapplyLastScroll()`.
- On workspace open, `PreviewPipeline::restore_preview` replays the persisted
  page manifest from `.typwriter/cache/previews/` — the user sees the
  last-rendered pages instantly while fonts load and the real compile runs
  behind.
- Pages travel as `{ index, fingerprint }` events; the PNG itself is fetched
  from the `previewimg://` custom protocol
  (`http://previewimg.localhost/{key}.png` on Android) with
  `Cache-Control: immutable`, so unchanged pages cost a WebView HTTP-cache
  hit, not IPC payload.

### 4e. Hot-exit: the OS killing the app is normal

The second safety net behind the 600 ms cap
([03-editor-and-performance.md](./03-editor-and-performance.md) has details):
while typing, the unsaved-buffer map is persisted (300 ms debounce) through
`save_workspace_tabs`; on the next open, `restoreTabs` seeds dirty tabs from
it and re-seeds the Rust shadow buffer so the next compile renders the
restored text.

**Do not** "fix" the missing live preview by re-enabling the typing path on
mobile. The sanctioned long-term route is delta-based shadow updates first,
then re-evaluate a low-frequency typing compile (doc 03).

**Checkpoint:** type → pause → preview updates within ~a second; toggle to
preview mid-edit → latest text renders; force-stop the app mid-edit →
relaunch restores the dirty buffer.

---

## Phase 5 — Exports, fonts, and packages over SAF

All three follow the same shape: keep the byte-producing core
destination-agnostic, add a thin URI-typed command for Android.

- **Exports:** `PreviewPipeline::export_pdf_bytes` / `export_png_pages` /
  `export_svg_pages` produce bytes with no destination knowledge. Desktop
  commands write paths with std::fs; Android gets parallel `*_to_uri`
  commands fed by android-fs pickers: `export_pdf_to_uri`
  (`showSaveFilePicker`), `export_png_to_dir_uri` / `export_svg_to_dir_uri`
  (`showOpenDirPicker`), plus `export_workspace_to_dir_uri` as the
  backup/escape hatch for app-managed workspaces (which die with uninstall).
- **Fonts:** fontdb scans with std::fs and cannot see SAF folders, so
  `import_font_directory_uri` *copies* the picked folder into app-private
  storage and feeds that path to `set_typst_font_directories`.
- **Packages:** `@preview` downloads land in `<Documents>/Typwriter/Packages`
  (Phase 2e); progress events reach the frontend through the existing
  `TauriProgress` emitter — no mobile-specific work needed.

---

## Phase 6 — Build, test, ship

- `bun tauri android dev` for device iteration, `bun tauri android build`
  for signed AAB/APK — toolchain setup, signing, versioning, and CI in
  [05-android-build-release.md](./05-android-build-release.md).
- Run the 14-row manual matrix in
  [07-roadmap-and-testing.md](./07-roadmap-and-testing.md) across the three
  storage contexts (desktop / Android managed / Android SAF) — they differ
  in exactly the ways Phases 2 and 4 describe. The kill-test (row 9) is the
  one that validates the whole Phase 4 design.
- Updates: no in-app updater on Android; ship APKs via GitHub releases (the
  landing page links them).

---

## Pitfalls — each of these was hit for real

| Pitfall | Rule |
|---------|------|
| `std::fs` against a workspace path | Always `vcs.working_tree_fs_for(&root)`. SAF folders are invisible to std::fs and there is no storage permission to ask for. |
| `convertFileSrc` for a SAF file | Asset protocol is std::fs-backed. Check `is_saf_root`, ship `data:` URLs. |
| Per-keystroke IPC or compile on mobile | Freezes typing. Idle/blur/pane-open cadence only; gate with `platform.isMobile`. |
| `tauri-plugin-dialog` pickers on Android | Can't grant SAF access. Use android-fs pickers + `_to_uri` commands. |
| Long autosave delay on mobile | Android kills apps without warning. Cap at 600 ms *and* keep hot-exit persistence. |
| Synchronous SAF work on workspace open | Binder round-trips per file are slow — VCS attach runs on a background thread on Android. |
| Forgetting `persistPickerUriPermission` | SAF grants are per-session unless persisted; the workspace dies on restart. |
| Hand-editing `gen/android/` internals | Regenerated by Tauri upgrades. Only the manifest + signing config are yours. |

For the iOS half of "mobile", see [06-ios-port.md](./06-ios-port.md) — the
architecture above was built so that only the SAF-equivalent (security-scoped
bookmarks) and the picker/share plumbing are new work.
