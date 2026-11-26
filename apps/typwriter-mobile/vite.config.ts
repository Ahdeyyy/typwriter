import adapter from "@sveltejs/adapter-static";
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

// Tauri injects TAURI_DEV_HOST when running on a physical device over the LAN.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    tailwindcss(),
    // SvelteKit 3 reads its options here; there is no svelte.config.js.
    // `eslint.config.js` loads them back through @sveltejs/load-config.
    sveltekit({
      // Tauri uses a static SPA frontend (no Node SSR server), so
      // adapter-static with an index.html fallback puts SvelteKit in
      // single-page-app mode.
      adapter: adapter({ fallback: "index.html" }),
      // Kit 3 polls _app/version.json hourly by default. The frontend ships
      // inside the APK, so a new version can never appear; Kit 2 didn't poll.
      version: { pollInterval: 0 },
      preprocess: vitePreprocess(),
    }),
  ],
  // Force a single copy of the CodeMirror/Lezer core packages into the bundle.
  // These arrive transitively as well as directly (@codemirror/language pulls
  // its own @lezer/lr, autocomplete pulls @codemirror/state), and loading two
  // copies of @lezer/common collides NodeProp ids — highlighting then either
  // renders as plain uncolored text or crashes with "tags is not iterable".
  // Deduping keeps a single instance. The root package.json `overrides` block
  // pins the versions; this is the build-level backstop.
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ],
  },
  clearScreen: false,
  server: {
    // Port 1430 so this dev server can run alongside the desktop app (1420).
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
