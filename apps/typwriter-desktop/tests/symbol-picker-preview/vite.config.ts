import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The production picker and CodeMirror, without starting Tauri or a dev server.
export default defineConfig({
  root: here("./"),
  plugins: [svelte({ configFile: false }), tailwindcss()],
  resolve: {
    alias: { $lib: here("../../src/lib") },
    dedupe: ["svelte"],
  },
  build: { outDir: here("../../dist/symbol-picker-preview"), emptyOutDir: true },
});
