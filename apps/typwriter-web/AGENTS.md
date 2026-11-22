# typwriter-web

Landing page for Typwriter — a static SvelteKit site whose job is to advertise the app and link to GitHub releases. Not the editor (that's `typwriter-desktop`).

## Stack

- SvelteKit (Svelte 5), TypeScript, Tailwind v4, shadcn-svelte (Lyra style, mauve, 0rem radius), Hugeicons (`@hugeicons/svelte`).
- `bun` for package management; `eslint` + `prettier` + `vitest` configured.
- Dev server on port 5173 (`bun run dev`).

## Structure (`src/`)

- `routes/+page.svelte` — the landing page. Kept deliberately short: hero, screenshot, a plain feature list. Its one download button is for the visitor's platform (detected after mount from the user agent via `lib/platforms.ts`); everything else links to `/download`.
- `routes/download/+page.svelte` — every platform's files, with a Stable / Nightly switch. The visitor's platform is listed first. The nightly release (`releases/tags/nightly`, the separate "Typwriter Nightly" app) is fetched only when that tab is opened and cached for 5 minutes, because every nightly build deletes the previous build's files.
- Both routes are prerendered (`+page.ts`) and fetch releases after mount via `lib/releases.ts`, with a one-hour localStorage cache for stable so downloads update without a site rebuild. Expired or invalid cache entries trigger a fresh lookup. If GitHub is unavailable or rate limited, downloads fall back to the GitHub release page.
- `lib/platforms.ts` — platform detection, grouping release files per platform (recommended file first), and file labels.
- `lib/components/` — `Navbar`, `Footer`, `InteractiveShowcase` (desktop/Android + theme screenshots) and shadcn primitives under `ui/`.
- `routes/+layout.svelte` + `layout.css` — global shell and styles.
- `lib/assets/`, `lib/links.ts`, `lib/utils.ts`, `lib/hooks/`, `lib/index.ts` — shared helpers.

## Svelte MCP tools

When working on Svelte code in this app, use the Svelte MCP server:

1. **list-sections** — call FIRST to discover all available Svelte/SvelteKit docs sections.
2. **get-documentation** — fetch full content for sections relevant to the task (check the `use_cases` field).
3. **svelte-autofixer** — run on any Svelte code you write; keep calling until it returns no issues.
4. **playground-link** — generate a Svelte Playground link. Only after user confirmation, and never if code was written to project files.
