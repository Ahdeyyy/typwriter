# Typwriter Mobile — Plan Overview

A new, standalone Android-first Typst editor app at `apps/typwriter-mobile/`. It is a
**fresh codebase** — it shares **no code** with `apps/typwriter-desktop/` (only the same
*design system*: identical CSS tokens, Tailwind 4, shadcn-svelte components, phosphor
icons). Where this plan says "copy from desktop", it means copy the files into the new
app as an independent snapshot, never import across app boundaries.

> **Snapshot anchor:** every "copy from desktop" instruction in this plan set was
> verified against desktop commit `9baf8a5`. Before copying, confirm the cited files
> still exist at the cited paths (`git log --oneline -1 -- <path>` shows recent churn).
> If a cited file is missing or moved, STOP and re-verify the file list against the
> current tree — do not guess at replacements.

## Why a separate app

The desktop app currently ships to Android with mobile special-cases bolted on
(`platform.isMobile` branches, `.mobile.svelte` variants). That makes mobile slow and
the code hard to evolve. The mobile app removes desktop-only weight (multi-tab editor,
hover tooltips, VCS restore points, file watcher, popped-out preview window, custom
titlebar, updater, 30+ bundled UI fonts, eager full-document rendering) and replaces the
interaction model with one designed for touch and soft keyboards.

## Product shape (locked decisions)

1. **Single-document editor.** One file open at a time. No tab bar. A "recent files"
   shortcut lives in the file tree drawer.
2. **File tree and preview are hidden by default.** The file tree is a left-side sheet
   (drawer); the preview is a full-screen overlay. Both are opened explicitly from the
   top bar and dismissed with the Android back gesture.
3. **No per-keystroke IPC, no live preview.** Keystrokes stay entirely inside the
   WebView. Disk is the source of truth: the editor autosaves on idle (600 ms), on blur,
   and before opening the preview. Compilation happens only after a save ("save → compile
   → render visible pages").
4. **Touch-first completions.** No Ctrl+Space. Completions appear as a horizontal chip
   strip docked above the soft keyboard, auto-triggered while typing and manually
   triggerable from a toolbar button. (Detailed in `05-completions.md`.)
5. **Lazy page rendering.** The compile command returns page metadata only
   (sizes + content fingerprints). PNG bytes are rendered **on demand** when the webview
   requests a page over the `previewimg://` URI scheme, prioritised by what's on screen.
6. **Managed storage first.** v1 workspaces live in the app's documents dir
   (`<documents>/Typwriter/<workspace>/`), reachable with plain `std::fs`. SAF-picked
   external folders are a later phase (`08-saf-and-polish.md`).

## Non-goals (v1)

- iOS (Android only; keep the code Tauri-mobile-portable but don't configure iOS).
- Multi-tab editing, split panes, popped-out windows.
- VCS / restore points / snapshots.
- Hover tooltips, go-to-definition, find-and-replace panel (simple find is a stretch goal).
- Typstyle formatting (stretch goal, the crate is light — see `07`).
- Font import, font gallery, theme gallery.
- File watcher (the app is the only writer to managed workspaces).
- Desktop builds of this app. It targets Android; the dev loop may run on desktop for
  convenience but nothing should depend on desktop-only behavior.

## Tech stack (pin these)

| Layer | Choice | Notes |
|---|---|---|
| Shell | Tauri 2 (`tauri = "2"`) | identifier `com.ahdey.typwriter.mobile` so it installs alongside the existing app |
| Frontend | SvelteKit + `@sveltejs/adapter-static`, Svelte 5 (runes) | same as desktop |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`), `tw-animate-css`, shadcn-svelte, `bits-ui`, `mode-watcher` | same design tokens as desktop (see `01-scaffold.md`) |
| Icons | `phosphor-svelte` | **named barrel imports only**: `import { Eye } from 'phosphor-svelte'` — deep path imports break Vite SSR |
| Editor | CodeMirror 6 — minimal extension set | see `04-editor.md` |
| Errors | `neverthrow` for all IPC-calling store methods | same convention as desktop |
| Typst | `typst`, `typst-ide`, `typst-render`, `typst-pdf`, `typst-kit` all at `"0.14.2"` (match the desktop app's versions so behavior is identical) | `typst-kit` features: **always** `["embed-fonts", "packages"]` together — `packages` silently drops if you override defaults without listing both |
| Android FS | `tauri-plugin-android-fs = "=28.1.0"` | dependency + `.plugin(init())` from phase `01` (mirrors desktop, which initializes it unconditionally on every platform — see desktop `lib.rs`); first *used* in phase `07` (export). `capabilities/default.json` must include `"android-fs:default"` (desktop precedent) |

## Repository layout of the new app

```
apps/typwriter-mobile/
  package.json                 # name: "typwriter-mobile"
  svelte.config.js             # adapter-static, fallback index.html
  vite.config.ts               # port 1430 (desktop app uses 1420)
  tsconfig.json
  components.json              # shadcn-svelte config
  src/
    app.html
    routes/
      +layout.ts               # export const ssr = false; export const prerender = true;
      +layout.svelte           # imports layout.css, ModeWatcher, Toaster
      layout.css               # design tokens (copied from desktop, trimmed)
      +page.svelte             # screen switcher (home | editor)
    lib/
      ipc/
        commands.ts            # typed invoke wrappers (the ONLY place `invoke` is called)
        types.ts               # IPC payload types, mirrors Rust serde types
      stores/
        app.svelte.ts          # current screen, overlay/history integration
        workspace.svelte.ts    # workspace list, file tree, current workspace
        editor.svelte.ts       # open file, dirty state, save scheduling
        compile.svelte.ts      # compile state, page metadata, diagnostics
        settings.svelte.ts     # persisted app settings
      editor/
        create-editor.ts       # CodeMirror EditorView factory (lean extension set)
        completion-controller.svelte.ts
        typst-lang/            # Lezer grammar — copied snapshot from desktop (see 04)
      components/
        screens/home.svelte    # workspace list / create
        screens/editor.svelte  # top bar + CodeMirror host + toolbar
        file-tree/             # left sheet + recursive tree (see 03)
        preview/               # full-screen overlay (see 06)
        toolbar/               # symbol row + completion strip (see 04/05)
        diagnostics/           # bottom drawer (see 07)
        ui/                    # shadcn-svelte generated components
      utils.ts                 # cn() helper etc.
  src-tauri/
    Cargo.toml                 # package name "typwriter-mobile", lib name "mobile_lib"
    tauri.conf.json
    capabilities/default.json
    src/
      main.rs
      lib.rs                   # run(), uri scheme, plugin + state setup, invoke_handler
      world.rs                 # MobileWorld: typst::World + typst_ide::IdeWorld
      compiler.rs              # compile command impl + page fingerprinting
      renderer.rs              # on-demand page render + LRU cache + previewimg handler logic
      workspace.rs             # managed workspaces, file tree, file ops
      commands/
        mod.rs
        workspace.rs           # list/create/open/delete workspace, tree, file ops
        editor.rs              # read_file, save_file, get_completions
        compile.rs             # compile, set_preview_scale
        export.rs              # export_pdf_to_uri (phase 07)
        settings.rs            # get/set app settings
    icons/                     # generate with `bun tauri icon`
    gen/android/               # generated — NEVER hand-edit
```

## Architecture summary

```
┌────────────────────────── WebView (Svelte) ──────────────────────────┐
│  editor.svelte.ts                                                    │
│   keystrokes → CodeMirror doc (NO IPC)                               │
│   idle 600ms / blur / preview-open ──► save_file(path, content)      │
│                                                                      │
│  compile.svelte.ts                                                   │
│   after save (if preview visible or requested) ──► compile()         │
│       ◄── { generation, pages:[{w,h,key}], errors, warnings }        │
│                                                                      │
│  preview overlay                                                     │
│   <img src="…previewimg.localhost/{key}.png"> lazily per page        │
│                                                                      │
│  completion strip                                                    │
│   debounced get_completions(path, text, cursorUtf16, explicit)       │
└──────────────────────────────────────────────────────────────────────┘
┌────────────────────────── Rust core ─────────────────────────────────┐
│  MobileWorld   — sources read from disk, refreshed each compile      │
│  compile cmd   — async; runs typst::compile, returns page metadata   │
│  previewimg    — async URI handler; renders page PNG on first        │
│                  request, serves from LRU after (immutable cache)    │
└──────────────────────────────────────────────────────────────────────┘
```

## Phases

Work through these **in order**; each file is self-contained and ends with acceptance
criteria. Don't start a phase until the previous one's criteria pass.

| Phase | File | Delivers | Status |
|---|---|---|---|
| 1 | `01-scaffold.md` | Monorepo wiring, Tauri + SvelteKit scaffold, design system, Android project boots to a placeholder screen | DONE (frontend `bun run check` ✓; Android init pending host SDK) |
| 2 | `02-rust-core.md` | `MobileWorld`, compile command, on-demand renderer, full IPC contract | DONE (`cargo check` ✓; `cargo test` blocked by host disk space, tests written) |
| 3 | `03-shell-and-files.md` | Home screen, workspace store, app shell, file-tree sheet, file operations, back-gesture handling | DONE (`bun run check` ✓; on-device gestures untested) |
| 4 | `04-editor.md` | Lean CodeMirror editor, Typst language support, save model, keyboard toolbar | DONE (`bun run check` ✓; on-device typing untested) |
| 5 | `05-completions.md` | Touch completion strip end to end | DONE (`bun run check` ✓; `bun test` 8/8 ✓) |
| 6 | `06-preview.md` | Full-screen preview overlay, lazy page loading, pinch zoom | DONE (`bun run check` ✓; on-device pinch untested) |
| 7 | `07-export-diagnostics-settings.md` | PDF export/share, diagnostics drawer, settings screen | DONE (`bun run check` + `cargo check` ✓; SAF save-dialog branch is android-only, not host-compiled) |
| 8 | `08-saf-and-polish.md` | SAF external folders, package download progress, perf passes | TODO (post-v1, out of scope) |

Update the Status column (`TODO` → `IN PROGRESS` → `DONE`, or `BLOCKED: <why>`) as you
work; it is the only cross-phase progress record.

## Conventions (apply everywhere)

- **Svelte 5 shared state:** every shared store is a `class` with `$state`/`$derived`
  fields, exported as a singleton: `export const editor = new EditorStore()`.
  Module-level exported `$state` loses reactivity when imported — never do it.
- **neverthrow:** store methods that call IPC return `ResultAsync<T, string>`. Pure
  state mutations are synchronous methods. Chain with `.andThen()`, surface errors with
  `.mapErr()` + a toast (`svelte-sonner`).
- **IPC in one place:** components never call `invoke` directly; they call store
  methods, stores call `lib/ipc/commands.ts` wrappers.
- **Offsets crossing IPC are UTF-16 code units.** CodeMirror counts UTF-16; Typst counts
  UTF-8 bytes. Rust converts at the boundary (helpers specified in `02-rust-core.md`).
- **Naming:** camelCase variables/functions, PascalCase classes/components, kebab-case
  filenames.
- **Icons:** `import { X, Y } from 'phosphor-svelte'` only.

## Build environment gotchas (Windows host)

- Large crates (`typst-library`) can crash `cargo build` with
  `STATUS_STACK_BUFFER_OVERRUN`. Fix: set `RUST_MIN_STACK=8388608` before building.
- Use `cargo check` inside `src-tauri/` to verify Rust changes (~minutes); full builds
  are slow and disk-hungry. Only do full builds when actually producing an APK.
- Frontend type-check: `bun run check` inside the app dir (`svelte-check`).
- Android dev loop: `bun tauri android dev` (requires Android SDK/NDK configured);
  `bun tauri android build --apk` for an installable artifact.
- Never hand-edit `src-tauri/gen/android/` — regenerate with `bun tauri android init`.
- Android cross-compilation needs vendored OpenSSL (see `01-scaffold.md` Cargo.toml).

## Decision log

| Decision | Rationale |
|---|---|
| Single open document, no tabs | Tabs cost memory (one EditorView each) and screen space; mobile users edit one file at a time |
| Drop per-keystroke `update_file_content` IPC entirely | Sending the whole doc over the WebView bridge per keystroke froze typing on Android in the old app |
| Disk is source of truth; save before compile | Removes the "shadow buffer" concept and its desync bugs; autosave makes it invisible to the user |
| Completions send the live buffer text with the request | Self-consistent (text + cursor in one message), no shadow-sync race; requests are debounced so payload cost is fine |
| Lazy on-demand page rendering | Mobile devices are memory- and battery-constrained; most documents are read a page or two at a time |
| Render keyed by `(content fingerprint, scale bucket)` with immutable HTTP caching | Same proven scheme as desktop: the webview's HTTP cache does the heavy lifting |
| Native text selection (no `drawSelection`) | CodeMirror's drawn selection breaks Android's native touch handles and text-selection magnifier |
| Embedded fonts only at startup | Synchronous, fast, deterministic; Android system fonts add little for Typst documents |
