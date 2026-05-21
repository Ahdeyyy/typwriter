# Typwriter

A Typst editor + landing page, organized as a Turborepo monorepo managed with `bun`.

## Layout

```
apps/
  typwriter-desktop/   Tauri 2 app (Windows, macOS, Linux, Android) — the editor
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

- `typwriter-desktop` builds for Windows / macOS / Linux **and Android** via Tauri 2 (mobile entry point + `tauri-plugin-android-fs`). Despite the name, it is the cross-platform app, not desktop-only.
- `typwriter-web` is a static SvelteKit site whose only job is to advertise the app and link to GitHub releases.
