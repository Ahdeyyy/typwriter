# Phase 1 — Scaffold

Goal: `apps/typwriter-mobile/` exists as a workspace member, builds, and boots on an
Android emulator/device showing a styled placeholder screen with the shared design
tokens applied (light + dark).

Read `00-overview.md` first. Do not modify anything under `apps/typwriter-desktop/`.

## 1. Create the SvelteKit app

Create `apps/typwriter-mobile/` (the root `package.json` workspaces glob `apps/*`
picks it up automatically — no root changes needed).

`package.json`:

```json
{
  "name": "typwriter-mobile",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test": "bun test",
    "tauri": "tauri"
  },
  "dependencies": {
    "@codemirror/autocomplete": "^6.20.0",
    "@codemirror/commands": "^6.10.2",
    "@codemirror/language": "^6.12.1",
    "@codemirror/state": "^6.5.4",
    "@codemirror/view": "^6.39.14",
    "@lezer/common": "^1.5.1",
    "@lezer/highlight": "^1.2.3",
    "@fontsource-variable/ibm-plex-sans": "^5.2.8",
    "@fontsource-variable/jetbrains-mono": "^5.2.8",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "~2",
    "@tauri-apps/plugin-log": "~2",
    "@tauri-apps/plugin-store": "~2",
    "neverthrow": "^8.2.0"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.6",
    "@sveltejs/kit": "^2.9.0",
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "@tailwindcss/vite": "^4.1.18",
    "@tauri-apps/cli": "^2",
    "bits-ui": "^2.16.3",
    "clsx": "^2.1.1",
    "mode-watcher": "^1.1.0",
    "phosphor-svelte": "^3.1.0",
    "shadcn-svelte": "^1.2.7",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "svelte-sonner": "^1.1.0",
    "tailwind-merge": "^3.5.0",
    "tailwind-variants": "^3.2.2",
    "tailwindcss": "^4.1.18",
    "tw-animate-css": "^1.4.0",
    "typescript": "~5.6.2",
    "vite": "^6.0.3"
  }
}
```

Note what is deliberately **absent** vs. desktop: no `@codemirror/lint`, no
`@codemirror/search`, no `@codemirror/lang-*` packages, no vscode keymap, no
indentation markers, no theme packages, no 30+ fonts, no `paneforge`, no updater
plugin, no `runed`. Only two fonts ship: IBM Plex Sans (UI) and JetBrains Mono (editor).

Also absent: `@lezer/generator` and `@lezer/lr` — the desktop Typst parser is a
**hand-written incremental parser in TypeScript** (`lezer-typst/parser.ts`), not a
generated LR parser. There is no `.grammar` file to regenerate and no
`generate-parser` script. (Desktop used to carry such a script pointing at a
nonexistent `typst.grammar`; it was removed 2026-06-13 — there is nothing to copy.)
`@lezer/common` and `@lezer/highlight` are the only lezer packages the parser needs.

`svelte.config.js`:

```js
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter({ fallback: "index.html" }) },
};
```

`vite.config.ts` — Tauri-compatible dev server on **port 1430** (desktop uses 1420, so
both dev servers can run at once):

```ts
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
```

`src/routes/+layout.ts`:

```ts
export const prerender = true;
export const ssr = false;
```

## 2. Design system

The design system is **identical tokens to desktop, fewer fonts**. Copy the
`:root { … }`, `.dark { … }`, and `@theme` / base-layer sections from
`apps/typwriter-desktop/src/routes/layout.css` into
`apps/typwriter-mobile/src/routes/layout.css`, then:

- Replace the long `@fontsource` import list with just:
  ```css
  @import "tailwindcss";
  @import "tw-animate-css";
  @import "shadcn-svelte/tailwind.css";
  @import "@fontsource-variable/ibm-plex-sans";
  @import "@fontsource-variable/jetbrains-mono";
  ```
- Keep `@custom-variant dark (&:is(.dark *));`.
- Keep all `--background/--foreground/--primary/...` oklch token values **byte-identical**
  to desktop (this is the shared design system).
- Drop the `--vcs-node-*` variables (no VCS in mobile) and `--titlebar-height`.
- Set `--font-mono: "JetBrains Mono Variable", monospace;` and keep
  `--app-font-sans: "IBM Plex Sans Variable", ...` as the sans stack.
- Add mobile viewport hygiene to the base layer:
  ```css
  html, body { overscroll-behavior: none; height: 100%; }
  body { font-family: var(--app-font-sans); -webkit-tap-highlight-color: transparent; user-select: none; }
  /* text inputs and the editor re-enable selection */
  input, textarea, .cm-content { user-select: text; -webkit-user-select: text; }
  ```

`src/app.html` must include the mobile viewport meta (note `viewport-fit` and
`interactive-widget` — the latter makes the soft keyboard resize the visual viewport
predictably on Chrome Android):

```html
<meta name="viewport"
  content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
```

### shadcn-svelte

Initialize with `bunx shadcn-svelte@latest init` using the same `components.json`
settings as `apps/typwriter-desktop/components.json` (open it and mirror style/base
color/alias values). Then add the components the app needs:

```
bunx shadcn-svelte@latest add button input dialog sheet drawer dropdown-menu
  separator scroll-area skeleton sonner tooltip badge
```

(`drawer` is the vaul-svelte bottom sheet — used for diagnostics and long-press file
menus; `sheet` is the side panel — used for the file tree.)

`+layout.svelte`:

```svelte
<script lang="ts">
  import "./layout.css";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner";
  let { children } = $props();
</script>

<ModeWatcher />
<Toaster position="top-center" />
{@render children?.()}
```

## 3. Tauri shell

From `apps/typwriter-mobile/`: `bun tauri init` (or author files manually to match below).

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Typwriter Mobile",
  "version": "0.1.0",
  "identifier": "com.ahdey.typwriter.mobile",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1430",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../build"
  },
  "app": {
    "windows": [{ "title": "Typwriter", "width": 420, "height": 860 }],
    "security": {
      "csp": "default-src 'self' ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; img-src 'self' previewimg: http://previewimg.localhost data: blob:; font-src 'self' data:"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

Notes:
- `previewimg:` must be in `img-src` — on Android the custom scheme is served as
  `http://previewimg.localhost`, so both forms are listed.
- No `assetProtocol` — the app never uses `convertFileSrc` (images are shipped as
  `data:` URLs by `read_file`, see `02-rust-core.md`), which sidesteps the whole
  SAF/asset-protocol incompatibility from day one.
- A window entry is still required for the desktop dev loop; Android ignores most of it.

`src-tauri/Cargo.toml`:

```toml
[package]
name = "typwriter-mobile"
version = "0.1.0"
edition = "2021"

[lib]
name = "mobile_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2" }
tauri-plugin-dialog = "2"
tauri-plugin-log = "2"
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
log = "0.4"
parking_lot = "0.12"
lru = "0.12"
thiserror = "2"
chrono = "0.4"
typst = "0.14.2"
typst-ide = "0.14.2"
typst-render = "0.14.2"
typst-pdf = "0.14.2"
typst-kit = { version = "0.14.2", features = ["embed-fonts", "packages"] }
ecow = { version = "0.2", features = ["serde"] }
png = "0.18"
tauri-plugin-android-fs = { version = "=28.1.0", features = ["legacy_storage_permission"] }

# Mobile cross-compilation can't find a system OpenSSL; vendor it.
[target.'cfg(target_os = "android")'.dependencies]
openssl = { version = "*", features = ["vendored"] }
```

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mobile_lib::run()
}
```

`src-tauri/src/lib.rs` (placeholder for this phase — state and the URI scheme arrive in
phase 2):

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_android_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "store:default",
    "log:default",
    "android-fs:default"
  ]
}
```

(`android-fs:default` matches the desktop precedent —
`apps/typwriter-desktop/src-tauri/capabilities/default.json` lists it because the
plugin is initialized in `lib.rs` on every platform. Without it the phase-7 export
dialog calls fail at runtime with a permissions error.)

Generate icons (`bun tauri icon path/to/logo.png` — reuse the desktop logo source if
available, otherwise any square PNG ≥ 1024px), then initialize Android:

```
bun tauri android init
```

After init, verify `src-tauri/gen/android/app/src/main/AndroidManifest.xml` contains
`<uses-permission android:name="android.permission.INTERNET" />` (needed for Typst
package downloads) and `android:windowSoftInputMode="adjustResize"` on the main
activity (needed so the soft keyboard resizes the webview — the editor toolbar docks to
the keyboard this way). If `adjustResize` is missing, add it via
`gen/android` regeneration config or document the manual step in the app README —
this is the one accepted hand-touch of the generated project; re-apply it after any
`android init`.

## 4. Placeholder screen

`src/routes/+page.svelte`: render a centered card with the app name, a phosphor icon,
and a button that toggles dark mode (via `toggleMode` from `mode-watcher`) — enough to
prove tokens, fonts, icons, dark mode, and the toolchain all work on-device.

## Acceptance criteria

1. `bun install` at repo root succeeds; `turbo run build` builds `typwriter-mobile`
   alongside existing workspaces (no root config changes were needed).
2. `bun run check` passes in `apps/typwriter-mobile/`.
3. `cargo check` passes in `apps/typwriter-mobile/src-tauri/` (set
   `RUST_MIN_STACK=8388608` on Windows).
4. `bun tauri dev` (desktop window) shows the styled placeholder; dark-mode toggle works.
5. `bun tauri android dev` boots on an emulator/device and shows the same screen.
6. Nothing under `apps/typwriter-desktop/` changed (`git status` clean there).
