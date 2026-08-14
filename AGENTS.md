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

Each app has its own `AGENTS.md` with details specific to that app. `CLAUDE.md`
is a one-line `@AGENTS.md` import everywhere — put content in `AGENTS.md` only,
so the two can't drift.

## Tooling

- **Package manager:** `bun` (workspaces declared in root `package.json`)
- **Task runner:** `turbo` — `bun run dev`, `bun run build`, `bun run check-types` fan out across workspaces. `bun run lint` only reaches `typwriter-web`; desktop and mobile have no ESLint setup, so turbo silently skips them.
- **Formatter:** `prettier` at the root (`bun run format`). There is no prettier config, so `--write` reflows files to 80 columns — match surrounding style by hand instead of formatting files you didn't otherwise touch.

## Targets

- `typwriter-desktop` builds for Windows / macOS / Linux via Tauri 2. It is desktop-only: Android support moved to `typwriter-mobile`. Don't add mobile/SAF code paths to it.
- `typwriter-mobile` is the independent Android app (Tauri 2 + `tauri-plugin-android-fs` for SAF storage).
- `typwriter-web` is a static SvelteKit site whose only job is to advertise the app and link to GitHub releases.
