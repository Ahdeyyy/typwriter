import adapter from "@sveltejs/adapter-static";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    tailwindcss(),
    // SvelteKit 3 reads its options here; there is no svelte.config.js.
    // `eslint.config.js` loads them back through @sveltejs/load-config.
    sveltekit({
      // Tauri has no Node.js server for SSR, so adapter-static with an
      // index.html fallback puts the app in SPA mode.
      // See: https://v2.tauri.app/start/frontend/sveltekit/
      adapter: adapter({ fallback: "index.html" }),
      // Kit 3 polls _app/version.json hourly by default. The frontend ships
      // inside the binary, so a new version can never appear; Kit 2 didn't poll.
      version: { pollInterval: 0 },
      preprocess: vitePreprocess(),
      // compilerOptions: { experimental: { async: true } },
    }),
  ],
  optimizeDeps: {
    include: ['codemirror']
  },
  // Force a single copy of the CodeMirror/Lezer core packages into the bundle.
  // Plugins like thememirror and @replit/codemirror-* pull older transitive
  // copies of @codemirror/language / @lezer/common; loading two copies of
  // @lezer/common collides NodeProp ids and crashes highlighting with
  // "tags is not iterable". Deduping keeps a single instance.
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@codemirror/search",
      "@codemirror/lint",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ],
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,

  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
