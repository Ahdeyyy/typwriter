import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Exercise real CodeMirror without starting the Tauri app or a dev server.
export default defineConfig({
    root: here('./'),
    plugins: [svelte({ configFile: false })],
    build: { outDir: here('../../dist/accessibility-preview'), emptyOutDir: true },
});
