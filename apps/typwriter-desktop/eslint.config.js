import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// src-tauri/target holds generated Rust build artifacts, including JS the
	// Tauri build script emits. Nothing in there is ours to lint.
	{ ignores: ['src-tauri/**', 'build/**', '.svelte-kit/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	// Formatting is not linted. The repo has no prettier config and the files
	// are hand-formatted, so stylistic rules would only fight the existing code.
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// `_`-prefixed names are deliberately unused (callback signatures we
			// have to match, destructured leftovers).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			],

			// ── Warnings: real findings, but fixing them changes behaviour ──
			// Left visible rather than silenced, and non-blocking so `bun run
			// lint` still gates on the mechanical rules above.

			// Adding a key to an {#each} is not a no-op: a wrong or duplicated
			// key throws at render time and blanks the window.
			'svelte/require-each-key': 'warn',
			// Swapping Set/Map for SvelteSet/SvelteMap changes what re-renders.
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/no-dom-manipulating': 'warn',
			'svelte/no-navigation-without-resolve': 'warn',
			'@typescript-eslint/no-explicit-any': 'warn',
			// Off, not warn: eslint-plugin-svelte and svelte-check disagree about
			// which ignores are needed, and this rule reported a
			// `state_referenced_locally` ignore as unused that svelte-check does
			// in fact need. Acting on it removes a load-bearing comment.
			'svelte/no-unused-svelte-ignore': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		},
		rules: {
			// A bare identifier inside `$effect` is how you declare a dependency
			// you don't otherwise read. It is the idiom, not a mistake.
			'@typescript-eslint/no-unused-expressions': 'off'
		}
	}
);
