# Dependency migration: typwriter-desktop + typwriter-mobile (2026-11)

Status: **done** on branch `chore/deps-2026-11` (2026-11-23/24). The plan
below is kept as written; the next section records what actually happened.

## Outcome

Every gate in section 12 matched the baseline at every step, apart from tests
that were added along the way. Desktop `cargo test` went from 307 to 314.

**Surprises, and how they were handled**

- **typstyle-core 0.15.3** (a patch release, picked up by Step 1's
  `cargo update`) replaced `Config::wrap_text` with `wrap_mode: WrapMode` and
  added `line_ending`. The wrap setting maps to `WrapMode::Fill`. Line endings
  take the new `Preserve` default.
- **sha2 0.11**: as predicted, `{:x}` no longer formats the digest.
  `document_id` formats the bytes itself. Pinned-hash tests (generated with
  sha2 0.10) and a zstd-0.13 blob fixture guard the on-disk formats.
- **tauri-plugin-android-fs 30**: `FileUri` became `FsUri`, and
  `file_picker()` / `file_opener()` became `picker()` / `opener()`. All
  methods we call kept their signatures. `FsUri` serializes like `FileUri`, so
  persisted URIs still load.
- **TypeScript 6** stopped loading `@types/*` implicitly. Mobile's tsconfig
  names `types: ["$app/types", "bun"]`. SvelteKit 3 insists on `$app/types`
  being in any `types` list.
- **SvelteKit 3 `$app/tsconfig`** dropped SvelteKit 2's implicit include of
  `tests/`. Desktop's tsconfig lists it again, since the preview harnesses
  need it for lint. `verbatimModuleSyntax` found nothing to fix.
- **`version.pollInterval: 0`** in both apps. Kit 3's hourly
  `_app/version.json` poll can never find anything inside a Tauri bundle.
- **ESLint 10** added `no-useless-assignment` to recommended, which flagged one
  dead initializer.
- **tailwind-variants 4**: all 143 variant combinations of our four recipes
  produce identical class strings under 3.3.1 and 4.0.2.
- **harper-core 3.2** was the one real regression. Measured on a 5,480-word
  Typst document:

  | | first check | each re-check |
  |---|---|---|
  | release, 2.7.0 | 2.7 s | ~0.47 s |
  | release, 3.2.0 | 2.6 s | ~0.69 s |
  | dev, 2.7.0 | 6.2 s | ~0.9 s |
  | dev, 3.2.0 | 13.4 s | ~2.4 s |
  | dev + `opt-level = 2` deps, 3.2.0 | 2.4 s | ~0.55 s |

  **Kept at 3.2.** The perceived slowness was mostly a single mutex shared by
  the config and the lint group, fixed in `20706f4`. Dev builds now optimize
  dependencies (`6fd63bf`); the cost is a long first build after a clean
  `target/`. Harper 3 also matches dictionary entries case-sensitively, so
  user words now also accept their all-caps form.

**Not caused by the migration, fixed while testing**

- The editor accessibility plugin crashed on every editor
  (`setTabFocusMode` before `inputState` existed), present since `12fce83`.
  Fixed in `20db5f4`.
- The LSP request timeout was raised from 3 s to 10 s for tinymist's slow
  first responses (`c60efa5`).
- The onboarding preview harness mocks predated two IPC calls (`68c5d2d`).
- The diff viewer uses @pierre/diffs 1.7's `overflow: 'wrap'` instead of
  injected CSS (`8fd9cea`).

**Holds**: TypeScript 6.0.x, ecow 0.2 (typst 0.15), typst 0.15.1 (latest),
hayagriva 0.10. `packages/eslint-config` (TS ^5.9) was out of scope.

**Still to do by hand**: the section 12 smoke tests (desktop watcher, restore
points on an old workspace, grammar, diff wrapping; mobile on a device:
pickers, persisted folder permissions, fonts, export, external edits). The
local Android toolchain setup (NDK r26d, JDK 17, SDK, OpenSSL workarounds)
lives outside the repo, in `%LOCALAPPDATA%\Android\android-env.sh`.

Scope: every npm and Cargo dependency of `apps/typwriter-desktop` and
`apps/typwriter-mobile`, plus the root `package.json` entries they rely on
(CodeMirror `overrides`, `typescript`, `engines`). `typwriter-web` is out of
scope. It was already moved to SvelteKit 3 / Vite 8 / TS 6 / ESLint 10 in
`2db7aef`, and this plan reuses that commit's patterns so the three apps end
up matching.

---

## 0. Summary

| Area | Desktop | Mobile |
|---|---|---|
| SvelteKit 2 → **3** (+ adapter-static 3 → 4) | yes | yes |
| Vite → **8** / vite-plugin-svelte → **7** | already on 8 / 7 | 6 → 8, 5 → 7 |
| TypeScript | 6.0.3, stays (see holds) | 5.6 → **6.0** |
| ESLint 9 → **10** | yes | yes |
| tailwind-variants 3 → **4** | yes | yes |
| runed 0.37 → 0.38 (needs Kit 3) | yes | yes |
| @pierre/trees beta → 1.0, @pierre/diffs 1.2 → 1.7 | yes | n/a |
| layerchart 2.0.0-next.48 | **removed** (unused, see §9) | n/a |
| Tauri 2.11 → 2.12 (crates + JS + CLI + plugins) | yes | yes |
| Rust majors | notify 7→9, lru 0.12→0.19, parking_lot 0.12→0.13, sha2 0.10→0.11, zstd 0.13→0.14, toml 0.8→1, base64 0.22→0.23, harper-core 2.7→3.2 | notify 7→9, lru, parking_lot, base64, zip 8.6→9.8, tauri-plugin-android-fs 28.1→30.2 |

**Deliberate holds** (will *not* go to latest):

| Package | Stays at | Why |
|---|---|---|
| `typescript` | `~6.0.3` (all apps + root) | TS 7.0 exists, but `@sveltejs/kit@3` peers `typescript ^6.0.0`, `svelte-check@4.7.8` peers `^5 \|\| ^6`, and `typescript-eslint@8.73` peers `<6.1.0`. Same decision `typwriter-web` already made. |
| `ecow` | `0.2` | typst 0.15.1 is built on ecow 0.2. Our `EcoString`s go straight into typst's `World::packages()` and its other APIs. ecow 0.3 would be a *different type* and fail to compile at every boundary, even though 0.3 itself has no API breaks. Revisit when typst moves. |
| `typst*` crates | `0.15.1` | Already latest. |
| `hayagriva` | `0.10` | Already latest (0.10.1), and must match `typst-library`'s copy for parse parity (see Cargo.toml comment). |
| `windows-sys` | `0.61` | Already latest. I'll re-check that tao still uses 0.61 after the Tauri bump, so the Cargo.toml comment stays true. |
| `vaul-svelte` | `1.0.0-next.7` | Still the newest `next`. `latest` (0.3.2) is the old Svelte 4 line. Don't "upgrade" to it. |
| `codemirror-typst`, `thememirror`, `paneforge`, `mode-watcher`, `dunce`, `fs_extra` | unchanged | Already latest. |

---

## 1. Ground rules for execution

1. Work on a branch `chore/deps-2026-11` off `master`. One commit per step
   below, so a regression can be bisected or reverted on its own.
2. **Baseline first.** Before touching anything, record the current result of
   every gate (section 12). Any pre-existing failure is noted, not "fixed by
   the migration".
3. After each step, run the gates for the affected app. Don't stack the next
   step on a red tree.
4. Keep Tauri's JS and Rust halves on the same minor (`@tauri-apps/api` ↔
   `tauri`, each `@tauri-apps/plugin-*` ↔ its crate). The CLI warns on
   mismatches.
5. Match surrounding style by hand. No repo-wide `prettier --write` (root
   AGENTS.md).
6. Stable and nightly release configs (`tauri.conf.json`,
   `tauri.nightly.conf.json`, the `.nsh`/`.desktop` association files) are not
   touched by this migration.

---

## 2. Step 1: Rust, in-range updates (both apps)

`cargo update` in each `src-tauri`, with no manifest changes. This picks up
Tauri 2.12.7, tauri-build 2.7.x, tauri-utils 2.10.x, tauri-plugin 2.7.x, all
`tauri-plugin-*` minors (dialog 2.8, log 2.10, opener 2.7, os 2.4, process
2.4, store 2.5, updater 2.14, single-instance 2.5), serde, serde_json,
regex 1.13, rayon 1.12, url, log, chrono, png 0.18.1, thiserror 2.0.21,
typstyle-core 0.15.3, openssl, and so on.

Also bump the floor `typstyle-core = "0.15"`. It already resolves to 0.15.3,
so no manifest edit is needed.

Watch for: Tauri minor releases sometimes add capability permissions or
deprecate config keys. Check `cargo check` warnings and the `tauri build`
output for config-schema warnings.

Gate: `cargo check --all-targets && cargo test` (desktop and mobile).

## 3. Step 2: Rust majors, desktop (`apps/typwriter-desktop/src-tauri`)

One crate per sub-commit, in this order (cheapest first):

| Crate | Change | Code impact (from reading our call sites) |
|---|---|---|
| `base64` 0.22 → 0.23 | MSRV 1.71. `DecodeError::InvalidLastSymbol` gained a field. New default `simd-unsafe` feature. | `workspace/mod.rs:540` only uses `STANDARD.encode`, so no change expected. Keep default features. |
| `lru` 0.12 → 0.19 | `promote`/`demote` return `bool`. Shared iterators need `Sync`. Edition 2024. | `compiler/cache.rs`, `compiler/disk_cache.rs` use `LruCache::new(NonZeroUsize)`, which is unchanged. Expect a clean build. |
| `parking_lot` 0.12 → 0.13 | MSRV 1.95. Recursive-read methods moved to `RecursiveRwLock`. `const_*` constructors removed. `try_map_or_else` renamed. Eventual fairness removed. | Grepped: we use none of the removed APIs. Only `Mutex`, `RwLock`, `Condvar`, `RwLockWriteGuard`. Behavior note: no more automatic eventual fairness. I don't expect it to matter, but it's worth a manual check of preview/compile contention. |
| `zstd` 0.13 → 0.14 | `Decoder::finish()` now drains the frame. `read()` with an empty buffer returns `Ok(0)`. License now BSD-3. | `vcs/store.rs` uses `encode_all` and `Decoder::new`. Existing `.typwriter/history/` blobs written by 0.13 must still decode, so I'll add a test that round-trips a blob fixture written before the bump. |
| `sha2` 0.10 → 0.11 | digest 0.11 (hybrid-array output, newtypes instead of aliases). MSRV 1.88. | `vcs/store.rs::hex_sha256` iterates bytes, so it should still compile. `workspace/document.rs:46` uses `format!("{:x}", Sha256::digest(..))`. If the 0.11 output type has no `LowerHex`, switch it to the existing `hex_sha256` helper. **The ids must stay byte-identical**: they key the history store and the document cache. I'll add a test that pins a known hash. |
| `toml` 0.8 → 1.x | 0.9 rewrite: `serde`/`std`/`parse`/`display` are default features. `from_str` no longer preserves order without `preserve_order`. `Serializer` API changed. | Only `toml::from_str` in `commands/init.rs:164` (typst.toml template metadata). Order doesn't matter there. Expect a clean build. |
| `notify` 7 → 9 | MSRV 1.91, edition 2024. `Watcher::paths_mut` → `update_paths`. `watched_paths()` shape changed. `Config` not `Copy`. `Error` struct private. `ErrorKind` non-exhaustive. `Event.paths` keeps the registered form (relative roots stay relative). PollWatcher event kinds changed. | `workspace/watcher.rs` uses `recommended_watcher` and matches `Create/Remove/Modify(Data\|Name\|Any)` plus `RenameMode::{Both,From,To}`. Expected work: add `_` arms to any `ErrorKind` matches, and confirm we watch an *absolute, canonical* root so `Event.paths` still strip-prefix correctly. **Manual test on Windows** (and macOS/Linux in CI): create, rename, delete and external edit in a workspace. The file tree, rename-link updates and the open-tab reload must all still fire. |
| `harper-core` 2.7 → 3.2 | v3.0's one flagged break: "more explicit handling of case-sensitivity in dictionaries" (#2630). Release notes don't name the APIs, so I'll fix what the compiler finds. | `grammar/` uses `FstDictionary`, `MergedDictionary`, `MutableDictionary`, `DictWordMetadata`, `Document`, `LintGroup`, `Parser`/`StrParser`, `Mask`/`Masker`, `Token`/`TokenKind`/`Punctuation`/`Quote`, `Span`, `Dialect`. User-dictionary words (case handling) are the likely hot spot. Keep `features = ["concurrent"]` and confirm it still exists. Gate: the `grammar::engine` tests plus a manual check that a user-added word is no longer flagged, in both lower and Title case. Slowest compile (burn), so it goes last. |

Gate after each: `cargo check --all-targets && cargo test` in desktop.

## 4. Step 3: Rust majors, mobile (`apps/typwriter-mobile/src-tauri`)

| Crate | Change | Code impact |
|---|---|---|
| `base64`, `lru`, `parking_lot` | as desktop | `commands/editor.rs`, `commands/export.rs`, `renderer.rs`. Same no-op expectation. |
| `notify` 7 → 9 (`default-features = false, features = ["macos_kqueue"]`) | `macos_kqueue` still exists in 9.0.0 (checked the crate's `[features]`). PollWatcher now reports writes as `Modify(Data(_))` and creates/removes as `File`/`Folder`/`Other`. `watch()` on a missing path returns `PathNotFound`. | `src/watcher.rs::is_relevant` already accepts `Create(_)`, `Remove(_)`, `Modify(Data(_))` and `Modify(Any)`, so the new kinds are covered. The unit tests in `watcher.rs` build events by hand and should keep passing. **On-device test**: edit a file in a SAF workspace from another app. The open tab must reload. |
| `zip` `=8.6.0` → `=9.8.1` | 9.0: deprecated items removed, `ExtraField` non-exhaustive, AES options rewritten, `ZipFileData` fields removed. `SimpleFileOptions`, `CompressionMethod` and the `deflate` feature are not mentioned as changed. | `commands/export.rs:401-406` (`ZipWriter`, `SimpleFileOptions::default().compression_method(Deflated)`). Expect a clean build. Keep the exact `=` pin, since the original commit pinned deliberately. Verify a "project as .zip" export opens in a desktop unzipper. |
| `tauri-plugin-android-fs` `=28.1.0` → `=30.2.0` | **Real API break**, from diffing the 28.1 and 30.2 crate sources. `FileUri` → `FsUri`. `api.file_picker()` → `api.picker()`, and `file_opener()` → `opener()`. Thumbnail and mime helpers renamed (`get_mime_type` → `get_file_mime_type` or `get_mime_type_from_extension`). `show_*_dialog` → `show_*_app_chooser`. Needs `tauri ^2.12`, so Step 1 must land first. Feature `legacy_storage_permission` still exists, with new kebab-case aliases. | Call sites: `document.rs` (`FileUri`, `android_fs().write`, `read_to_string`, `get_name`), `fonts.rs` (`FileUri::from_uri`, `EntryOptions`, `OptionalEntry::{Dir,File}`, entry listing), `commands/export.rs` (`file_picker().save_file`, `pick_dir`, `pick_file`, `persist_uri_permission`, `release_persisted_uri_permission`, `create_new_file`). Mechanical rename `FileUri` → `FsUri` and `file_picker()` → `picker()`. Every method we call still exists in 30.2, but signatures need checking at compile time. **Important:** `FileUri`/`FsUri` may be persisted. If recent-workspace or font-folder URIs are stored in `tauri-plugin-store` as serialized `FileUri` JSON, its serde shape must still deserialize. I'll check `fs_uri.rs` vs `file_uri.rs` serde attributes and add a fixture test if they differ. Capability `android-fs:default` should be confirmed against the 30.x permission set. |

**Constraint:** almost all android-fs code is `#[cfg(target_os = "android")]`.
This machine has no Android Rust target or NDK, so local `cargo check` doesn't
compile it. Options, in order of preference:

1. **Chosen:** install `rustup target add aarch64-linux-android` plus NDK
   r26d (as in CI) and run `cargo check --target aarch64-linux-android`
   locally.
2. (Not used) push the branch and run `android-build` via
   `workflow_dispatch`.

Then an on-device smoke test (section 12) is still required, because the
picker and permissions are runtime behavior.

Also in Step 3: `bun run licenses:generate` in `apps/typwriter-mobile`. The
catalog fingerprints `Cargo.lock`, `bun.lock` and the manifests, and
`licenses:check` runs in CI and in `bun run build`, so it **must** be
regenerated after every dependency change. I'll regenerate it once at the end
of each mobile step and review the diff (new licenses, e.g. zstd's BSD-3 if
it's ever pulled into mobile).

## 5. Step 4: JS, in-range updates (both apps + root)

No API changes expected:

- Root `overrides`: bump the CodeMirror/Lezer pins to state 6.7.6,
  view 6.43.15, lint 6.9.8, language 6.13.1, @lezer/common 1.5.6,
  @lezer/highlight 1.2.5. These pins *cap* both apps (see `19fa765`), so the
  per-app ranges are meaningless without this. Keep exact pins: they exist to
  guarantee one copy.
- Desktop + mobile: all `@codemirror/*` (autocomplete 6.20.4, commands 6.11.1,
  lsp-client 6.3.1, search 6.7.2, lang-html, lang-markdown, legacy-modes),
  `@fontsource*` 5.3.x, `@hugeicons/*`, `@internationalized/date`,
  `@lucide/svelte` 1.77, `bits-ui` 2.22, `shadcn-svelte` 1.8.1,
  `svelte-sonner` 1.2.3, `tailwind-merge` 3.7.1, `tailwindcss` and
  `@tailwindcss/vite` 4.3.5, `prettier-plugin-tailwindcss`, `globals`,
  `@eslint/compat` 2.1.1, `eslint-plugin-svelte` 3.24, `typescript-eslint`
  8.73, `svelte` 5.59.1, `svelte-check` 4.7.8, `@types/bun` 1.4.5.
- Tauri JS: `@tauri-apps/api` 2.12.5, `cli` 2.12.6, all plugins to the minors
  matching Step 1's crates.
- Root: `prettier` 3.10.1, `turbo` 2.11.13, `@fontsource/iosevka` 5.3.0.
- Tighten mobile's stale floors to what's installed (`"svelte": "^5.0.0"` →
  `^5.59.1`, `"@sveltejs/kit": "^2.9.0"`, etc.).

Gates: check-types, lint, `bun test`, `test:state` (+ `test:themes` desktop),
plus a manual CodeMirror pass in both apps. CodeMirror bumps fixed Android
selection bugs before, so I'll re-check selection, caret-into-view and
completion on mobile.

## 6. Step 5: Mobile toolchain catch-up (Vite 6 → 8, TS 5.6 → 6)

Mobile only. This is a prerequisite for Kit 3, done separately so a Vite
regression isn't confused with a Kit one.

- `vite` ^8.3.8, `@sveltejs/vite-plugin-svelte` ^7.3.1 (still on Kit 2.70 at
  this point; vite-plugin-svelte 7 works with Kit 2.6x+).
- `typescript` ~6.0.3 (match desktop). Fix any new TS 6 strictness errors
  that svelte-check reports.
- Vite 7/8 notes that apply to us: Rolldown + Oxc replace Rollup + esbuild.
  The default `build.target` rises to Chrome 111 / Safari 16.4. **Check the
  Android System WebView floor**: our `minSdk` is 24, but WebView updates via
  the Play Store, so Chrome 111+ is a reasonable assumption. Still, I'll check
  the oldest WebView we claim to support. If it's lower, pin `build.target`
  explicitly. CJS default-import interop changed, so watch for a `default is
  not a function` at runtime from CJS deps. Escape hatch:
  `legacy.inconsistentCjsInterop`. `resolve.dedupe` isn't listed as changed,
  and desktop already runs it on Vite 8, which proves it out.
- Our `vite.config.ts` uses none of the removed options.

Gates: mobile check-types, lint, tests, `vite build`, and the `tauri android
dev` smoke test if a device is available.

## 7. Step 6: SvelteKit 3 + adapter-static 4 (both apps)

Floors: Node ≥ 22.17, Svelte ≥ 5.57.1, Vite ≥ 8.0.12,
vite-plugin-svelte 7, TS 6. All are met after Steps 4–5. Upgrade to the
latest Kit 2.70.x first and fix any deprecation warnings, then bump to
`@sveltejs/kit` ^3.4.0 and `@sveltejs/adapter-static` ^4.0.1. Desktop first,
mobile second (separate commits).

Neither app imports any `$app/*` module (`$app/stores`, `$app/paths`,
`$app/navigation`, `$app/environment`): grepped, zero hits. Both are
single-route SPAs. So most of Kit 3's runtime breaks (navigation, forms,
cookies, `resolve()` leading slashes, hooks, remote functions) don't apply.
The real work is config, `$lib` and tsconfig.

### 7.1 Config: delete `svelte.config.js`, move it into `vite.config`

Same as web's `2db7aef`:

```js
// apps/typwriter-desktop/vite.config.js
import adapter from "@sveltejs/adapter-static";
...
plugins: [
  tailwindcss(),
  sveltekit({
    // Tauri has no Node server: adapter-static with an index.html
    // fallback puts the app in SPA mode.
    adapter: adapter({ fallback: "index.html" }),
  }),
],
```

- `preprocess: vitePreprocess()` is dropped. vite-plugin-svelte 7
  preprocesses TS natively, and web dropped it with no issues. If a
  `<style lang="...">` or other preprocessor needs it, it's a pass-through
  option to `sveltekit({ preprocess })`.
- Desktop `kit.alias { "@/*": "./src/lib/*" }`: three imports use `@/`. I'll
  convert them to `#lib/...` and drop the alias. Web did the same, and
  `alias` is deprecated in 3.
- Desktop's commented-out `compilerOptions.experimental.async` block moves
  with it, still commented.
- The SPA fallback stays `index.html`. Kit docs suggest `200.html`, but Tauri
  serves `frontendDist` itself and `index.html` is what it loads. Keep it, and
  verify `build/index.html` exists after build.
- `eslint.config.js` (both): replace `import svelteConfig from
  './svelte.config.js'` with `@sveltejs/load-config` (add devDep `^0.2.2`),
  as web does:
  `const svelteConfig = (await loadConfig('./', { traverse: false }))?.config;`

### 7.2 `$lib` → `#lib` (the bulk of the work)

About 950 `$lib` specifiers across about 300 files (desktop src, mobile src,
and `tests/frontend-state/*.regression.ts`, which uses
`mock.module('$lib/...')`).

1. Add to each app's `package.json`:
   ```json
   "imports": { "#lib": "./src/lib/index.ts", "#lib/*": "./src/lib/*" }
   ```
   (`index.ts` if one exists; otherwise only the `#lib/*` entry.)
2. Run a **codemod script** (kept in the scratchpad, not committed). For every
   string literal `'$lib/<p>'` in `import … from`, `export … from`,
   `import()`, `mock.module()` and `import.meta.glob()`, it resolves `<p>`
   against `src/lib`, trying in order: exact file, `.ts`, `.js`,
   `.svelte.ts`, `.svelte.js`, `.svelte`, `/index.ts`, `/index.js`. It then
   rewrites to `#lib/<p><actual ext>` (e.g. `$lib/stores/workspace.svelte` →
   `#lib/stores/workspace.svelte.ts`, `$lib/components/ui/button` →
   `#lib/components/ui/button/index.ts`). It **fails loudly** on any
   specifier it can't resolve, rather than guessing. Comments mentioning
   `$lib` are updated by hand.
   - The `tests/` mocks must resolve to the *same* specifier the source uses,
     or `bun test`'s `mock.module` silently stops intercepting. The codemod
     handles both sides. I'll grep afterwards that `test:state` mocks still
     take effect (the tests would fail loudly if not, since they'd hit real
     IPC).
3. `components.json` (both): `$lib` → `#lib`, so future shadcn components
   generate correctly.
4. `grep -rn '\$lib'` must return only intentional prose afterwards.

### 7.3 tsconfig

```json
{
  "extends": "$app/tsconfig",
  "compilerOptions": { "sourceMap": true, "strict": true },
  "include": ["src", "vite.config.*"],
  "exclude": ["src/**/*.test.ts"]   // desktop keeps its bun:test exclusion
}
```

- `$app/tsconfig` turns on `verbatimModuleSyntax` and `isolatedModules`, which
  likely surfaces "import is only used as a type" errors. Fix them with
  `import type` / inline `type`. This is mechanical but may touch many files.
- Re-check `allowJs`/`checkJs`: we currently set them. Only keep them if
  svelte-check still needs them (it type-checks `vite.config.js`, which is
  JS).
- **Risk:** `bun test` reads tsconfig `extends` for path resolution. `#lib`
  resolves via `package.json` `imports` (Bun supports this natively), so we
  no longer *need* tsconfig paths, but I'll confirm bun doesn't choke on
  `"$app/tsconfig"`. Fallback: a small `tsconfig.bun.json`, or `bunfig.toml`
  `[test] tsconfig`.

### 7.4 Other Kit 3 items to verify, though they likely don't apply

- `+layout.ts` (both) exports `ssr = false` / `prerender`. Still valid in 3,
  so check it isn't affected by the "universal config overrides server config"
  change (we have no server config).
- `version.pollInterval` now defaults to 1 hour. In a Tauri SPA that's a
  pointless fetch of `_app/version.json` from the asset protocol. Set
  `version: { pollInterval: 0 }` in `sveltekit({...})` if it shows up in the
  network log or errors under the custom CSP.
- `output.linkHeaderPreload` / modulepreload: confirm nothing in the CSP
  (`default-src 'self' ipc: …`) blocks the new `<link rel=modulepreload>`
  elements. Check the console in a production `tauri build`, not just dev.

### 7.5 runed 0.38

`runed@0.38` only breaks `runed/kit` (needs Kit 3). We only import `watch`
from `runed`, so bump it in this step, after Kit 3.

Gates: everything in section 12, plus a production `tauri build` of desktop
and a launch of the built binary. The asset protocol, CSP and SPA fallback
only show up in a real bundle.

## 8. Step 7: ESLint 10 (both apps)

- `eslint` ^10.15.0, `@eslint/js` ^10.0.1 (web already uses both).
  `eslint-plugin-svelte` 3.24, `typescript-eslint` 8.73 and `@eslint/compat`
  2.1 all peer ESLint 10.
- ESLint 10 changes that matter here: config lookup now starts from each
  linted file's directory. We have one flat config per app, so nothing should
  change. `eslint:recommended` gained rules, and
  `no-shadow-restricted-names` now reports `globalThis` shadowing. New
  findings get fixed if they're mechanical. Otherwise they're downgraded to
  `warn` in the existing "real findings, behavior-changing" block, with a
  comment, matching the current convention.

Gate: `bun run lint` (both).

## 9. Step 8: Remaining JS majors

- **tailwind-variants 3 → 4** (both). Used only in shadcn `button`, `badge`
  and `sidebar-menu-button`. v4 makes unknown variant keys type errors, has
  `tv()`/`cn()` return `""` instead of `undefined`, moves `twMergeConfig` to
  `tailwind-variants/config`, and puts slotted compoundVariant arrays on
  `base`. None of our recipes use slots or `twMergeConfig`. Check that
  svelte-check passes and buttons/badges render identically (sizes and
  variants). `tailwind-merge` stays: our `cn()` in `utils.ts` imports it
  directly.
- **@pierre/trees 1.0.0-beta.4 → 1.0.0** (desktop file tree). No changelog
  is reachable (npm returns 403, and it isn't on the GitHub releases page). I
  confirmed the imported names (`FileTree`, `FILE_TREE_DEFAULT_ITEM_HEIGHT`,
  `ContextMenuAnchorRect`, `ContextMenuItem`, `FileTreeDirectoryHandle`,
  `FileTreeDropResult`, `FileTreeItemHandle`, `FileTreeRenameEvent`) still
  exist in 1.0.0's `.d.ts`. Signatures are validated by svelte-check. Manual
  test: expand/collapse, rename, drag-and-drop move (which triggers link
  updates from `ef7bd89`), context menu, and virtualization on a large
  workspace.
- **@pierre/diffs 1.2 → 1.7** (desktop `vcs/diff-viewer.svelte`, `FileDiff`).
  1.7 removed `*AST`/`css` from render results and `renderPartialHTML`,
  changed search-highlight CSS to `::highlight(...)`, and made the editor
  APIs stricter. We only mount `FileDiff`, so check the restore-point diff
  view and page diff view visually, including dark mode.
- **layerchart: remove** (decided). `src/lib/components/ui/chart/` is a
  shadcn scaffold that nothing imports. Delete that folder and the
  `layerchart` devDependency, then confirm with grep that nothing else
  references `layerchart` or `ui/chart`.
- `@lucide/svelte` 1.22 → 1.77 is in range, but icon renames happen. Let
  svelte-check catch missing exports.

## 10. Step 9: CI and runtime floors

- Kit 3 and Vite 8 need **Node ≥ 22.17**, and `svelte-kit`/`vite` run under
  Node even when started via `bun run` (their bin shebang is `node`).
  `ci.yml`'s frontend job already sets up Node 24. **`publish.yml`,
  `nightly.yml` and `android.yml` don't.** They rely on the runner image's
  Node, which builds the frontend through `beforeBuildCommand`. Add
  `actions/setup-node@v5` with `node-version: 24` before `setup-bun` in those
  three jobs. This is a minimal, additive change to release workflows. Their
  stable/nightly logic is untouched, and `.github/scripts/nightly.test.cjs`
  must still pass.
- Root `package.json` `engines.node`: `>=18` → `>=22.17`. Add the same
  `engines` to desktop and mobile `package.json`, like web.
- Rust MSRV rises to 1.95 (parking_lot 0.13). CI uses
  `dtolnay/rust-toolchain@stable`, and local is 1.100, so no action. I'll
  mention it in the commit body.

## 11. Step 10: Docs

- `apps/typwriter-desktop/AGENTS.md` and `apps/typwriter-mobile/AGENTS.md`:
  add the same notes web's AGENTS.md got. No `svelte.config.js`. `$lib` is
  gone, so use `#lib/...` with explicit extensions. TS stays on 6.x and why.
  Node 22.17+.
- Mobile AGENTS.md: android-fs 30 naming (`FsUri`, `picker()`), if it
  documents API names.
- Root AGENTS.md: the "`bun run lint` only reaches typwriter-web; desktop and
  mobile have no ESLint setup" line is already stale (both have
  `eslint.config.js` and lint in CI). Fix it while I'm there.
- Keep this file under `docs/migrations/` as the record of the upgrade.

---

## 12. Verification gates

**Automated (after every step, for the touched app):**

| Gate | Desktop | Mobile |
|---|---|---|
| `cargo check --all-targets` / `cargo test` | ✓ | ✓ (host) |
| `cargo check --target aarch64-linux-android` | — | ✓ (if the toolchain is installed; else CI `android-build`) |
| `bun run check` (svelte-kit sync + svelte-check) | ✓ | ✓ |
| `bun run lint` | ✓ | ✓ |
| `bun test` | ✓ | ✓ |
| `bun run test:state` (+ `test:themes`) | ✓ | ✓ |
| `bun run licenses:check` | — | ✓ |
| `node --test .github/scripts/*.test.cjs` | ✓ (once, root) | |
| `vite build` | ✓ | ✓ |

**Manual smoke tests (end of migration):**

Desktop (production `bun tauri build`, launch the bundle):
open a workspace; edit and see the live preview; the file tree
(rename/move/delete, plus external edits picked up by the watcher); export
PDF/PNG/SVG/HTML; package browser; grammar pane, including a user dictionary
word; restore points (create, diff view, restore an *existing* pre-migration
history); command palette; settings incl. themes/fonts; the updater card
renders (no real update); presentation mode; a `.typ` file-association open.

Mobile (on device): open a SAF folder; reopen it after an app restart (the
persisted URI permission); edit with selection and caret behavior, the cursor
row and completions; preview; export each format, incl. the zip and save
dialog; fonts folder; an external edit picked up by PollWatcher; licenses
screen.

---

## 13. Risks, ranked

1. **android-fs 30.** Renamed types and API, can't be compiled locally
   without an NDK, and persisted URIs might change format. Mitigation:
   Android target check, serde fixture test, on-device test.
2. **`$lib` → `#lib` codemod plus `verbatimModuleSyntax`.** Huge mechanical
   diff and easy to break bun test mocks. Mitigation: a resolver-based
   codemod that fails loudly, tests as the gate, and one commit for review.
3. **notify 9.** Behavior changes in event kinds and paths that compile fine
   but misbehave silently. Mitigation: unit tests and the manual watcher
   checks.
4. **sha2/zstd.** Must stay format-compatible with existing on-disk history
   and caches. Mitigation: pinned-hash and fixture round-trip tests.
5. **harper-core 3.** Case-sensitivity semantics in dictionaries.
6. **Vite 8 on mobile.** CJS interop and WebView build target.
7. **CI Node version** for the release workflows. Mitigation: explicit
   setup-node.

## 14. Decisions (2026-11-23)

1. **layerchart: remove.** Delete `src/lib/components/ui/chart/` and the
   `layerchart` devDependency in Step 8. Don't upgrade it.
2. **TypeScript: hold at `~6.0.3`** everywhere. No `--tsgo` setup.
3. **Branch/commits:** local branch `chore/deps-2026-11` off `master`, one
   commit per step. Never pushed. You merge when satisfied.
4. **Android verification: local.** `aarch64-linux-android` Rust target plus
   NDK r26d, installed under `%LOCALAPPDATA%\Android\Sdk\ndk\android-ndk-r26d`
   (same NDK as CI). The mobile gate is
   `cargo check --target aarch64-linux-android` with the same
   `CC_*`/`AR_*`/`RANLIB_*` env vars `android.yml` sets, pointed at the
   Windows NDK binaries. These are set per command, not globally. Nothing is
   pushed. An on-device smoke test is still needed for runtime behavior.

   **Working local setup (verified 2026-11-23, baseline passes on the
   unmodified code in about 16 minutes cold):**
   `. "$LOCALAPPDATA/Android/android-env.sh"` in Git Bash, then
   `cargo check --target aarch64-linux-android`. The vendored OpenSSL build
   needed these workarounds, all outside the repo:
   - Git's Unix-style Perl, plus pure-Perl modules it lacks
     (Locale::Maketext::Simple, ExtUtils::MakeMaker, Pod::*), copied from
     portable Strawberry Perl into `%LOCALAPPDATA%\Android\perl5lib`.
     Strawberry's own Perl can't be used: OpenSSL rejects Windows-style
     Perl for Unix targets.
   - `PERL5LIB` excluded from MSYS path conversion
     (`MSYS2_ENV_CONV_EXCL`).
   - Strawberry's `gmake.exe` copied as `make.exe` into a shim directory.
   - `CC` pointed directly at `clang.exe` with
     `--target=aarch64-linux-android24`, using forward-slash paths. The
     `.cmd` wrapper gets rewritten with a backslash that the build shell
     strips.
   - Baseline warnings: one `fetch_update` deprecation in
     `src/world.rs:211`, which is pre-existing and not in scope.
