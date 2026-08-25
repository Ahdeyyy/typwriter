import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

// Tauri injects TAURI_DEV_HOST when running on a physical device over the LAN.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
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
