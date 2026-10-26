import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const mocked = [
    '$lib/stores/onboarding.svelte', '$lib/stores/preview.svelte',
    '$lib/ipc/commands', '$lib/ipc/events', '$lib/logger', '@tauri-apps/plugin-opener',
];
const stubbed = [
    '$lib/components/titlebar/titlebar.svelte',
    '$lib/components/editor/onboarding-editor.svelte',
    '$lib/components/sidebar/preview.svelte',
];

// Build the actual onboarding page and settings store; native services and
// editor/preview panes are isolated so no Tauri app or dev server is needed.
export default defineConfig({
    root: here('./'),
    plugins: [svelte({ configFile: false }), tailwindcss()],
    resolve: {
        alias: [
            ...mocked.map((find) => ({ find, replacement: here('./mocks.ts') })),
            ...stubbed.map((find) => ({ find, replacement: here('./stub.svelte') })),
            { find: '$lib', replacement: here('../../src/lib') },
        ],
        dedupe: ['svelte'],
    },
    build: { outDir: here('../../dist/onboarding-preview'), emptyOutDir: true },
});
