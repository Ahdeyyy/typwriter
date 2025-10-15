import { invoke } from "@tauri-apps/api/core";
import { clsx, type ClassValue } from "clsx";
import { useDebounce } from "runed";
import { twMerge } from "tailwind-merge";
import { writeTextFile, readDir } from "@tauri-apps/plugin-fs";
import { compile_file } from "./ipc";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any }
  ? Omit<T, "children">
  : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};

/**
 * Get the file type / extension from a path or filename.
 * - Returns the extension without a leading dot.
 * - For multi-part extensions (e.g. `archive.tar.gz`) returns `tar.gz`.
 * - Strips URL query strings and hashes (`?` and `#`).
 * - Handles POSIX and Windows paths.
 * - Returns an empty string when no extension is present.
 */
export function getFileType(path: string): string {
  if (!path || path === "") return "";
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
  if (
    last.includes(".") &&
    !(
      last.startsWith(".") &&
      last.indexOf(".") === 0 &&
      last.indexOf(".", 1) === -1
    )
  ) {
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
  cleaned[0] = isWindowsAbs
    ? cleaned[0].replace(/\//g, "\\")
    : cleaned[0].replace(/\\/g, "/");
  return cleaned.join(sep);
}

export const saveTextToFile = async (file_path: string, text: string) => {
  try {
    await writeTextFile(file_path, text);
  } catch (e) {
    console.error("[ERROR] - saving file: ", e);
  }
};

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

type ScrollbarColors = {
  background?: string; // Background color of the editor
  scrollbarTrack?: string; // Color of the scrollbar track
  scrollbarThumb?: string; // Color of the scrollbar thumb
  scrollbarThumbHover?: string; // Color of the scrollbar thumb on hover
  scrollbarThumbActive?: string; // Color of the scrollbar thumb when active
};

export function createScrollbarTheme(colors: ScrollbarColors = {}): Extension {
  const {
    background = "#ffffff",
    scrollbarTrack = "#80C7FF",
    scrollbarThumb = "##C1E2F8",
    scrollbarThumbHover = "#C1E2F8",
    scrollbarThumbActive = "#C1E2F8",
  } = colors;

  return EditorView.theme({
    "&.cm-editor .cm-scroller::-webkit-scrollbar": {
      width: "12px",
      height: "12px",
    },
    "&.cm-editor .cm-scroller::-webkit-scrollbar-track": {
      background: scrollbarTrack,
      borderRadius: "7px",
    },
    "&.cm-editor .cm-scroller::-webkit-scrollbar-thumb": {
      background: scrollbarThumb,
      borderRadius: "7px",
      border: `2px solid ${background}`,
      minHeight: "30px",
    },
    "&.cm-editor .cm-scroller::-webkit-scrollbar-thumb:hover": {
      background: scrollbarThumbHover,
    },
    "&.cm-editor .cm-scroller::-webkit-scrollbar-thumb:active": {
      background: scrollbarThumbActive,
    },
    "&.cm-editor .cm-scroller::-webkit-scrollbar-corner": {
      background: background,
    },
    // Firefox scrollbar styling
    "&.cm-editor .cm-scroller": {
      scrollbarWidth: "thin",
      scrollbarColor: `${scrollbarThumb} ${scrollbarTrack}`,
    },
  });
}

// Light theme colors
export const lightScrollbar = createScrollbarTheme({
  background: "#ffffff",
  scrollbarTrack: "#f8f8f8",
  scrollbarThumb: "#d0d0d0",
  scrollbarThumbHover: "#b0b0b0",
  scrollbarThumbActive: "#999999",
});

// Dark theme colors
export const darkScrollbar = createScrollbarTheme({
  background: "#1e1e1e",
  scrollbarTrack: "#2d2d2d",
  scrollbarThumb: "#555555",
  scrollbarThumbHover: "#777777",
  scrollbarThumbActive: "#888888",
});

/**
 * MurmurHash3's 32-bit hashing function.
 * It provides excellent speed and distribution for non-cryptographic needs.
 *
 * @param  key The string to hash.
 * @param seed An optional seed value.
 * @returns A 32-bit integer hash.
 */
export function murmurHash3(key: string, seed = 0): number {
  let remainder: number,
    bytes: number,
    h1: number,
    h1b: number,
    c1: number,
    c2: number,
    k1: number,
    i: number;

  remainder = key.length & 3; // key.length % 4
  bytes = key.length - remainder;
  h1 = seed;
  c1 = 0xcc9e2d51;
  c2 = 0x1b873593;
  i = 0;

  while (i < bytes) {
    k1 =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(++i) & 0xff) << 8) |
      ((key.charCodeAt(++i) & 0xff) << 16) |
      ((key.charCodeAt(++i) & 0xff) << 24);
    ++i;

    k1 =
      ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 =
      ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1b =
      ((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) & 0xffffffff;
    h1 = (h1b & 0xffffffff) + 0x6b64e653;
  }

  k1 = 0;

  switch (remainder) {
    case 3:
      k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
    case 2:
      k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
    case 1:
      k1 ^= key.charCodeAt(i) & 0xff;
      k1 =
        ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) &
        0xffffffff;
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 =
        ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) &
        0xffffffff;
      h1 ^= k1;
  }

  h1 ^= key.length;
  h1 ^= h1 >>> 16;
  h1 =
    ((h1 & 0xffff) * 0x85ebca6b +
      ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) &
    0xffffffff;
  h1 ^= h1 >>> 13;
  h1 =
    ((h1 & 0xffff) * 0xc2b2ae35 +
      ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) &
    0xffffffff;
  h1 ^= h1 >>> 16;

  return h1 >>> 0; // Convert to unsigned 32-bit integer
}
