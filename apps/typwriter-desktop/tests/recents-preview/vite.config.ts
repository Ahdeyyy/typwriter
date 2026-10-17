import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const mocked = [
  "@/stores/page.svelte", "$lib/stores/page.svelte", "$lib/ipc/commands",
  "$lib/stores/workspace.svelte", "$lib/stores/onboarding.svelte",
  "$lib/stores/platform.svelte", "$lib/stores/settings.svelte", "$lib/services/document-opening",
  "$lib/windows", "$lib/logger", "@tauri-apps/api/window",
  "@tauri-apps/plugin-dialog",
];

// Build the real Home and shared UI with in-memory service boundaries. This
// intentionally does not start the desktop app or its Vite development server.
export default defineConfig({
  root: here("./"),
  plugins: [svelte({ configFile: false }), tailwindcss()],
  resolve: {
    alias: [
      ...mocked.map((find) => ({ find, replacement: here("./mocks.ts") })),
      { find: "$lib", replacement: here("../../src/lib") },
      { find: "@", replacement: here("../../src/lib") },
    ],
    dedupe: ["svelte"],
  },
  build: {
    outDir: here("../../dist/recents-preview"),
    emptyOutDir: true,
    rollupOptions: { input: { index: here("./index.html"), canvas: here("./canvas.html") } },
  },
});
