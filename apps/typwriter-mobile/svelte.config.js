// Tauri uses a static SPA frontend (no Node SSR server), so adapter-static
// with an index.html fallback puts SvelteKit in single-page-app mode.
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter({ fallback: "index.html" }) },
};

export default config;
