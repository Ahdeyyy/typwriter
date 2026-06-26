# 06 — iOS port guide

iOS is the unimplemented half of "mobile". The good news: the architecture
was built with it in mind — most `cfg` gates already say
`any(target_os = "android", target_os = "ios")` where behavior is
mobile-generic, and `target_os = "android"` only where it's genuinely
Android-specific. This doc maps what carries over, what needs new work, and
the order to do it in.

## What already works for iOS (by design)

| Area | Why it carries over |
|------|---------------------|
| Entry point | `#[cfg_attr(mobile, tauri::mobile_entry_point)]` covers both OSes |
| Package/cache dirs | `world::packages_dir` already routes `any(android, ios)` to `<Documents>/Typwriter/Packages` |
| App-managed workspaces | `<Documents>/Typwriter/` via `path().document_dir()` — iOS app sandbox Documents works with plain `std::fs`, same as Android app-private storage |
| Frontend mobile UI | `platform.isMobile` already includes `ios`; all `.mobile.svelte` variants, keyboard avoider, typing-preview suppression apply as-is |
| Preview protocol | `previewimg://localhost/...` is the documented macOS/iOS URL form, already handled in `lib.rs` |
| Updater exclusion | dependency is gated `cfg(not(any(android, ios)))` |
| Vendored OpenSSL | currently `cfg(any(target_os = "android"))` — **extend to ios** if the same link error appears (likely) |

## What does NOT carry over

### 1. External folder access (the SAF equivalent)

`tauri-plugin-android-fs` is Android-only. iOS's analogue is:

- `UIDocumentPickerViewController` to pick an external folder,
- **security-scoped bookmarks** to persist access across launches,
- `startAccessingSecurityScopedResource()` around file IO.

Unlike SAF, once a security-scoped URL is "open" you can use normal POSIX
file APIs on it — so `LocalWorkingTreeFs` (std::fs) mostly works *inside an
access session*. The integration shape that fits the existing architecture:

1. Build (or adopt, if one has matured) a small Tauri plugin exposing:
   `pickFolder() -> bookmark`, `resolveBookmark(bookmark) -> path + access
   handle`, `stopAccess(handle)`.
2. Add an iOS arm to `VcsState`: a registry mapping workspace root → bookmark
   (mirror of `saf_roots`), and have `working_tree_fs_for` return a wrapper
   `IosScopedWorkingTreeFs` that delegates to `LocalWorkingTreeFs` but holds
   the access session open (RAII guard per operation or per attach).
3. `is_saf_root` generalizes to `needs_inline_bytes(root)`: on iOS the asset
   protocol *can* read inside an active security scope, so inline `data:`
   URLs may be unnecessary — verify, and prefer paths if it works.

**Phase-1 shortcut:** ship iOS with app-managed workspaces only (Documents
folder is user-visible in the Files app on iOS when
`UIFileSharingEnabled`/`LSSupportsOpeningDocumentsInPlace` are set in
Info.plist — that alone covers most of the "my files are mine" need without
any bookmark machinery).

### 2. Fonts

`import_font_directory_uri` is android-fs-based. iOS equivalent: document
picker (folder or multiple font files) → copy into app container → existing
`set_typst_font_directories` path. Same copy-into-private-storage strategy,
different picker plumbing. System font scanning via fontdb works on iOS but
the system font set differs; the embedded fonts remain the baseline.

### 3. Exports / share sheet

The `*_to_uri` commands are android-fs typed. On iOS the idiomatic flow is
the **share sheet** (`UIActivityViewController`) or a document picker in
export mode. Reuse the byte-producing core (`export_pdf_bytes`,
`export_png_pages`, `export_svg_pages`) — only the thin command layer is new:
`export_pdf_ios(temp file in caches dir) → present share sheet`.

### 4. Hot-exit pressure is higher

iOS suspends/kills backgrounded apps more aggressively than Android. The
existing hot-exit machinery (doc 03) applies unchanged, but also listen for
the `visibilitychange`/`pagehide` events and flush there — on iOS that's
often the *only* warning before termination.

### 5. Keyboard

`adjustResize` is an Android manifest concept. On iOS the WebView viewport
behavior differs (the keyboard overlays rather than resizes in some
configurations). `mobile-keyboard.ts` is written against `visualViewport`,
which iOS Safari/WKWebView supports — it should mostly work, but the
`KEYBOARD_DELTA_THRESHOLD_PX` heuristic and the inset math need on-device
verification. Budget a polish pass.

## Step-by-step port plan

1. **Toolchain:** macOS machine, Xcode, `rustup target add aarch64-apple-ios
   aarch64-apple-ios-sim`, Apple developer account.
2. `bun tauri ios init` → generates `src-tauri/gen/apple/`. Commit it (same
   policy as `gen/android`): hand-maintain only Info.plist and signing.
3. **Compile gate:** `bun tauri ios dev` on a simulator. Expect to fix:
   - OpenSSL linking → extend the vendored-openssl target cfg to ios.
   - Any `target_os = "android"` code accidentally required on mobile
     (there shouldn't be — `VcsState` falls back to `LocalWorkingTreeFs`).
4. **Phase 1 (managed workspaces only):** verify create/open/edit/compile/
   preview/export-via-share-sheet against `<Documents>/Typwriter`. Set
   `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` so users see
   their workspaces in the Files app.
5. **Phase 2 (external folders):** security-scoped bookmark plugin +
   `VcsState` iOS registry as above.
6. **Phase 3 (polish):** keyboard pass, share-sheet exports for PNG/SVG
   batches (zip or multi-item share), TestFlight beta.
7. Add an `ios.yml` CI workflow (macOS runner, simulator build as the smoke
   gate; signed builds only on release tags — Apple signing in CI is its own
   project).

## Effort estimate

Phase 1 is days, not weeks — the architecture genuinely carries. Phase 2
(bookmarks plugin) is the only piece of real new systems work, comparable to
what the SAF integration cost on Android.
