# 01 — Architecture: one codebase, two form factors

## Entry points

`src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { … }
```

- **Desktop** launches via `src-tauri/src/main.rs` → `run()`.
- **Mobile** builds the crate as a library (`crate-type = ["staticlib",
  "cdylib", "rlib"]`); the generated Android project under
  `src-tauri/gen/android/` loads it and calls the
  `tauri::mobile_entry_point`-generated symbol.

There is exactly one `run()`; platform differences live in `cfg` blocks and
runtime checks, never in separate binaries.

## cfg-gating conventions

Three predicates appear in the codebase — know which one you need:

| Predicate | Means | Used for |
|-----------|-------|----------|
| `#[cfg(desktop)]` / `#[cfg(mobile)]` | Tauri-provided alias for the platform family | window management (preview pop-out teardown in `lib.rs`), `WebviewWindow::destroy` |
| `#[cfg(any(target_os = "android", target_os = "ios"))]` | both mobile OSes | package/cache directory overrides in `world/mod.rs::packages_dir` |
| `#[cfg(target_os = "android")]` | Android only | everything SAF: `VcsState::saf_roots`, `AndroidWorkingTreeFs`, background VCS attach |

Rule of thumb: storage code is `target_os = "android"` (iOS will need its own
mechanism, see doc 06); directory-layout code is `any(android, ios)`;
windowing code is `desktop`/`mobile`.

## Plugin matrix

From `lib.rs` and `Cargo.toml`:

| Plugin | Desktop | Android | Notes |
|--------|---------|---------|-------|
| `tauri-plugin-updater` | ✅ | ❌ | dep is target-gated `cfg(not(any(android, ios)))`; registered inside a `#[cfg]` block |
| `tauri-plugin-android-fs` | registered but inert | ✅ | pinned `=28.1.0`; in the unconditional `[dependencies]` — the crate no-ops off Android |
| `tauri-plugin-dialog` | ✅ | ✅ | desktop pickers; Android uses android-fs pickers instead for SAF |
| `tauri-plugin-os` | ✅ | ✅ | feeds the frontend `platform` store |
| `tauri-plugin-store` | ✅ | ✅ | settings, recent workspaces, tab persistence |
| `tauri-plugin-log` | ✅ | ✅ | stdout + rotating file in the app log dir |
| `tauri-plugin-opener` | ✅ | ✅ | open URLs/files externally |

Android-only build detail (`Cargo.toml`): `openssl = { features = ["vendored"] }`
is forced for the Android target because cross-compilation can't find a system
OpenSSL for typst-kit/typst-ide's transitive consumers.

## Shared state and who owns what

Constructed in the `setup` hook, in dependency order:

```
VcsState  ──────────────┐  owns: SAF-root registry, WorkingTreeFs factory,
   │                    │        snapshot store
   ▼                    │
EditorWorld ────────────┤  owns: fonts, source/file caches, shadow buffers,
   │                    │        package storage   (reads files via VcsState)
   ▼                    │
PreviewPipeline ────────┤  owns: compile worker thread, page caches (RAM+disk),
   │                    │        last compiled document
   ▼                    │
WorkspaceState ─────────┘  owns: root, main file, FS watcher, file ops
```

`VcsState` is deliberately first: it owns the SAF registry, so **everything**
that reads workspace bytes (the compiler's `World::file`, the file tree, file
ops, snapshots) can resolve the right accessor. This ordering is what makes a
SAF workspace fully usable rather than merely listable.

A note for mobile: `VcsState::attach` runs its initial snapshot on a
**background thread on Android** (`typwriter-vcs-attach`) because hashing a
workspace through the SAF binder interface is slow — doing it inline would
stall workspace open. Desktop does it synchronously. Keep this asymmetry in
mind when adding attach-time work.

## The preview image path on mobile

Pages are served over the custom `previewimg://` URI scheme, not IPC:

- URL on **Windows/Android**: `http://previewimg.localhost/{key}.png`
- URL on macOS/iOS/Linux: `previewimg://localhost/{key}.png`

The key is `{content_fingerprint}-{zoom_bucket}`, responses are
`Cache-Control: immutable`, so the Android WebView's HTTP cache does the heavy
lifting and page updates cost one tiny event + one (often cached) image fetch.
This design is mobile-friendly as-is — don't replace it with base64-over-IPC.

## Frontend platform detection

`src/lib/stores/platform.svelte.ts` classifies via `@tauri-apps/plugin-os`:

```ts
isMobile = $derived(this.os === "android" || this.os === "ios");
```

- Branch **behavior** with `platform.isMobile` (e.g. typing-preview suppression
  in `editor.svelte.ts`).
- Branch **whole components** with the `.mobile.svelte` convention (doc 04).
- `platform.displayPath()` strips the long app-private `<Documents>/` prefix
  so users see `Typwriter/MyDoc` instead of
  `/storage/emulated/0/Android/data/...`.

## Watcher caveat

`workspace/watcher.rs` uses the `notify` crate, which on Android only sees
inotify-visible paths — i.e. the **app-managed** workspaces dir. External
changes to a SAF workspace do not produce events (SAF has no inotify bridge).
This is acceptable today (nothing else writes those folders while the app is
open) but means "external change detection" is desktop + managed-dir only.
If it ever matters, the options are polling through `WorkingTreeFs.read_dir`
or a `DocumentsProvider` content-observer in Kotlin via a plugin.
