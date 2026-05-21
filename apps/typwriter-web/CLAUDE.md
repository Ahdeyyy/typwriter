# typwriter-web

Landing page for Typwriter — a static SvelteKit site whose job is to advertise the app and link to GitHub releases. Not the editor (that's `typwriter-desktop`).

## Stack

- SvelteKit (Svelte 5), TypeScript, Tailwind v4, shadcn-svelte (Lyra style, mauve, 0rem radius), Phosphor icons.
- `bun` for package management; `eslint` + `prettier` + `vitest` configured.
- Dev server on port 5173 (`bun run dev`).

## Structure (`src/`)

- `routes/+page.server.ts` — server load: fetches the latest GitHub release to populate download links.
- `routes/+page.svelte` — the single landing page.
- `routes/+layout.svelte` + `layout.css` — global shell and styles.
- `lib/components/` — `FeatureCard.svelte` (Phosphor icon + title + description) and shadcn primitives under `ui/`.
- `lib/assets/`, `lib/utils.ts`, `lib/hooks/`, `lib/index.ts` — shared helpers.

## Svelte MCP tools

When working on Svelte code in this app, use the Svelte MCP server:

1. **list-sections** — call FIRST to discover all available Svelte/SvelteKit docs sections.
2. **get-documentation** — fetch full content for sections relevant to the task (check the `use_cases` field).
3. **svelte-autofixer** — run on any Svelte code you write; keep calling until it returns no issues.
4. **playground-link** — generate a Svelte Playground link. Only after user confirmation, and never if code was written to project files.
