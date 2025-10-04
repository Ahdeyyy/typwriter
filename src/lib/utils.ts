import { invoke } from "@tauri-apps/api/core";
import { clsx, type ClassValue } from "clsx";
import { useDebounce } from "runed";
import { twMerge } from "tailwind-merge";
import { appState } from "./states.svelte";
import { writeTextFile, readDir } from "@tauri-apps/plugin-fs";
import { compile_file } from "./ipc";


export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

/**
 * Get the file type / extension from a path or filename.
 * - Returns the extension without a leading dot.
 * - For multi-part extensions (e.g. `archive.tar.gz`) returns `tar.gz`.
 * - Strips URL query strings and hashes (`?` and `#`).
 * - Handles POSIX and Windows paths.
 * - Returns an empty string when no extension is present.
 */
export function getFileType(path: string): string {
	if (!path) return "";
	// Remove query string / hash
	const cleaned = path.split(/[?#]/, 1)[0];
	// Normalize backslashes to forward slashes and get basename
	const parts = cleaned.replace(/\\/g, "/").split("/");
	const base = parts.pop() || "";
	if (!base) return "";
	// If there's no dot (.) or the dot is the last char, there's no extension
	if (!base.includes(".")) return "";
	// Split on dots and drop the leading name part to support multi-part exts
	const segs = base.split(".");
	segs.shift(); // remove the filename portion
	return segs.join(".");
}


/**
 * Return the name of the last folder in a path.
 * - If the path points to a file (has an extension in the final segment), the parent folder name is returned.
 * - Trailing slashes/backslashes are ignored.
 * - Strips URL query strings and hashes (`?` and `#`).
 * - Returns an empty string when there is no folder in the path.
 */
export function getFolderName(path: string): string {
	if (!path) return "";
	// Strip query/hash
	const cleaned = path.split(/[?#]/, 1)[0];
	// Normalize backslashes and trim trailing slashes
	const normalized = cleaned.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!normalized) return "";
	const segments = normalized.split("/");
	// If there is no slash in the original cleaned path, there's no folder
	if (segments.length === 1) return "";
	const last = segments[segments.length - 1];
	// If last segment looks like a filename (contains a dot and not just a leading dot), return parent
	if (last.includes(".") && !(last.startsWith(".") && last.indexOf(".") === 0 && last.indexOf(".", 1) === -1)) {
		return segments[segments.length - 2] || "";
	}
	// Otherwise the last segment is a folder name
	return last || "";
}


// returns the name of the file in the path - the path may be relative or absolute-

export function getFileName(path: string): string {
	if (!path) return "";
	// Remove query/hash
	const cleaned = path.split(/[?#]/, 1)[0];
	// Normalize separators and trim trailing slashes
	const normalized = cleaned.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!normalized) return "";
	const segments = normalized.split("/");
	const last = segments[segments.length - 1] || "";
	return last;
}


/**
 * Join filesystem paths in a cross-platform friendly way.
 * - Preserves Windows drive letters and UNC paths.
 * - Avoids duplicate separators.
 */
export function joinFsPath(...parts: Array<string | undefined | null>): string {
	const filtered = parts.filter((p): p is string => !!p && p.length > 0);
	if (filtered.length === 0) return "";
	// Trim leading/trailing separators (keep leading on first if root-like)
	const cleaned = filtered.map((p, i) => {
		if (i === 0) return p.replace(/[\\/]+$/, "");
		return p.replace(/^[\\/]+|[\\/]+$/g, "");
	});
	const first = cleaned[0];
	const isWindowsAbs = /^[a-zA-Z]:/.test(first) || first.startsWith("\\\\");
	const sep = isWindowsAbs ? "\\" : "/";
	// Normalize first segment separators to chosen sep
	cleaned[0] = isWindowsAbs ? cleaned[0].replace(/\//g, "\\") : cleaned[0].replace(/\\/g, "/");
	return cleaned.join(sep);
}




export const compile = async (file_path: string, text: string) => {
	let res = await compile_file(text, file_path, 1, appState.view?.state.selection.ranges[0].from || 0);
	if (res) {
		console.error("[ERROR] - compiling file: ", res);
	}
}

export const saveTextToFile = async (file_path: string, text: string) => {

	try {
		await writeTextFile(file_path, text)
	} catch (e) {
		console.error("[ERROR] - saving file: ", e)
	}
}


/**
 * 
 * @param path - The root path to build the file tree from.
 * @returns A hierarchical representation of the file tree.
 * e.g: tree: [
	  ["lib", ["components", "button.svelte", "card.svelte"], "utils.ts"],
	  [
		"routes",
		["hello", "+page.svelte", "+page.ts"],
		"+page.svelte",
		"+page.server.ts",
		"+layout.svelte",
	  ],
	  ["static", "favicon.ico", "svelte.svg"],
	  "eslint.config.js",
	  ".gitignore",
	  "svelte.config.js",
	  "tailwind.config.js",
	  "package.json",
	  "README.md",
	],
 */
export const buildFileTree = async (path: string) => {
	const tree: any[] = [];
	const entries = await readDir(path);
	for (const entry of entries) {
		if (entry.isDirectory) {
			const subTree = await buildFileTree(`${path}/${entry.name}`);
			tree.push([entry.name, subTree]);
		} else {
			tree.push(entry.name);
		}
	}
	return tree;
}

/**
 * Build a file tree where file leaves are relative paths from the provided root.
 * Directories remain as [dirname, subtree].
 */
export const buildFileTreeRel = async (absRoot: string, relBase = ""): Promise<any[]> => {
	const tree: any[] = [];
	const entries = await readDir(absRoot);
	for (const entry of entries) {
		if (entry.isDirectory) {
			const nextAbs = `${absRoot}\\${entry.name}`;
			const nextRel = relBase ? `${relBase}\\${entry.name}` : entry.name;
			const subTree = await buildFileTreeRel(nextAbs, nextRel);
			tree.push([entry.name, subTree]);
		} else {
			const relPath = relBase ? `${relBase}\\${entry.name}` : entry.name;
			tree.push(relPath);
		}
	}
	return tree;
}

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

type ScrollbarColors = {
	background?: string; // Background color of the editor
	scrollbarTrack?: string; // Color of the scrollbar track
	scrollbarThumb?: string; // Color of the scrollbar thumb
	scrollbarThumbHover?: string; // Color of the scrollbar thumb on hover
	scrollbarThumbActive?: string; // Color of the scrollbar thumb when active
}

export function createScrollbarTheme(colors: ScrollbarColors = {}): Extension {
	const {
		background = '#ffffff',
		scrollbarTrack = '#80C7FF',
		scrollbarThumb = '##C1E2F8',
		scrollbarThumbHover = '#C1E2F8',
		scrollbarThumbActive = '#C1E2F8'
	} = colors;

	return EditorView.theme({
		'&.cm-editor .cm-scroller::-webkit-scrollbar': {
			width: '12px',
			height: '12px',
		},
		'&.cm-editor .cm-scroller::-webkit-scrollbar-track': {
			background: scrollbarTrack,
			borderRadius: '7px',
		},
		'&.cm-editor .cm-scroller::-webkit-scrollbar-thumb': {
			background: scrollbarThumb,
			borderRadius: '7px',
			border: `2px solid ${background}`,
			minHeight: '30px',
		},
		'&.cm-editor .cm-scroller::-webkit-scrollbar-thumb:hover': {
			background: scrollbarThumbHover,
		},
		'&.cm-editor .cm-scroller::-webkit-scrollbar-thumb:active': {
			background: scrollbarThumbActive,
		},
		'&.cm-editor .cm-scroller::-webkit-scrollbar-corner': {
			background: background,
		},
		// Firefox scrollbar styling
		'&.cm-editor .cm-scroller': {
			scrollbarWidth: 'thin',
			scrollbarColor: `${scrollbarThumb} ${scrollbarTrack}`,
		}
	});
}

// Light theme colors
export const lightScrollbar = createScrollbarTheme({
	background: '#ffffff',
	scrollbarTrack: '#f8f8f8',
	scrollbarThumb: '#d0d0d0',
	scrollbarThumbHover: '#b0b0b0',
	scrollbarThumbActive: '#999999'
});

// Dark theme colors  
export const darkScrollbar = createScrollbarTheme({
	background: '#1e1e1e',
	scrollbarTrack: '#2d2d2d',
	scrollbarThumb: '#555555',
	scrollbarThumbHover: '#777777',
	scrollbarThumbActive: '#888888'
});