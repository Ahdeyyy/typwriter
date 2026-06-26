// Pure helpers for the Obsidian-style quick switcher (no Svelte/CM imports so
// they're unit-testable). Flattens the file tree and ranks files against a
// query with a light subsequence fuzzy match.

import type { FileNode } from "$lib/ipc/types";

export interface FileEntry {
  name: string;
  relPath: string;
}

/** Depth-first flatten of the tree to its files (directories excluded). */
export function flattenFiles(root: FileNode | null): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (node: FileNode) => {
    for (const child of node.children) {
      if (child.isDir) walk(child);
      else out.push({ name: child.name, relPath: child.relPath });
    }
  };
  if (root) walk(root);
  return out;
}

/**
 * Score `text` against `query` as a case-insensitive subsequence. Returns a
 * higher score for earlier and more contiguous matches; `null` when `query`
 * is not a subsequence of `text`. An empty query matches everything (score 0).
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    // Reward contiguous runs and matches near the start.
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
}

/** Filter + rank entries by query, matching on the basename then full path. */
export function searchFiles(entries: FileEntry[], query: string): FileEntry[] {
  const q = query.trim();
  if (!q) return entries;
  const scored: { entry: FileEntry; score: number }[] = [];
  for (const entry of entries) {
    const nameScore = fuzzyScore(entry.name, q);
    const pathScore = fuzzyScore(entry.relPath, q);
    const best =
      nameScore === null
        ? pathScore
        : pathScore === null
          ? nameScore
          : Math.max(nameScore + 5, pathScore); // prefer name matches
    if (best !== null) scored.push({ entry, score: best });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored.map((s) => s.entry);
}
