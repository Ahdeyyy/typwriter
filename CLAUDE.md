# Typwriter

A Typst editor (desktop + mobile) + landing page, organized as a Turborepo monorepo managed with `bun`.

## Layout

```
apps/
  typwriter-desktop/   Tauri 2 desktop app (Windows, macOS, Linux) — the editor
  typwriter-mobile/    Tauri 2 Android app — standalone mobile editor
  typwriter-web/       SvelteKit landing page (download + marketing)
packages/
  eslint-config/       shared ESLint config
  typescript-config/   shared tsconfig presets
```

Each app has its own `CLAUDE.md` / `AGENTS.md` with details specific to that app.

## Tooling

- **Package manager:** `bun` (workspaces declared in root `package.json`)
- **Task runner:** `turbo` — `bun run dev`, `bun run build`, `bun run lint`, `bun run check-types` fan out across workspaces
- **Formatter:** `prettier` at the root (`bun run format`)

## Targets

- `typwriter-desktop` builds for Windows / macOS / Linux via Tauri 2. It is desktop-only: Android support moved to `typwriter-mobile`. Don't add mobile/SAF code paths to it.
- `typwriter-mobile` is the independent Android app (Tauri 2 + `tauri-plugin-android-fs` for SAF storage).
- `typwriter-web` is a static SvelteKit site whose only job is to advertise the app and link to GitHub releases.
