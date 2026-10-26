// Path helpers. Workspace-relative paths use `/`, never start with one,
// and the empty string is the workspace root. Mirrors `remap_rel` in
// src-tauri/src/workspace.rs — the two must agree, or the frontend's tabs and
// the persisted metadata drift apart after a rename.

/** Last segment of a workspace-relative path. Returns `rel` unchanged when it
 *  has no separator. */
export function basename(rel: string): string {
  const parts = rel.split("/");
  return parts[parts.length - 1] ?? rel;
}

/** Parent folder of `rel`, for display. Returns `"/"` — not `""` — for a path
 *  at the workspace root, since this is rendered as a subtitle. */
export function parentDir(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "/" : rel.slice(0, i);
}

export interface DisplayPathRoot {
  path: string;
  label: string;
}

/** Display an absolute location beneath a known user/storage directory.
 *  This never changes the path used for opening or saving a workspace. */
export function displayPath(path: string, roots: DisplayPathRoot[]): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const windows = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//");
  const compared = windows ? normalized.toLowerCase() : normalized;
  const candidates = roots
    .map((root) => ({ ...root, path: root.path.replace(/\\/g, "/").replace(/\/+$/, "") }))
    .filter((root) => root.path)
    .sort((a, b) => b.path.length - a.path.length);

  for (const root of candidates) {
    const prefix = windows ? root.path.toLowerCase() : root.path;
    if (compared === prefix) return root.label;
    if (compared.startsWith(`${prefix}/`)) {
      const relative = normalized.slice(root.path.length + 1);
      return root.label ? `${root.label}/${relative}` : relative;
    }
  }
  return path;
}

export type PathRemap =
  | { kind: "unaffected" }
  | { kind: "moved"; to: string }
  | { kind: "gone" };

/**
 * How `rel` is affected by the entry at `from` becoming `to` — or being deleted,
 * with `to = null`.
 *
 * Descendants travel with a folder, so a path *inside* `from` lands at the same
 * position under `to`. Matching is on whole path segments: renaming `notes`
 * must leave `notes-old.typ` alone.
 */
export function remapPath(rel: string, from: string, to: string | null): PathRemap {
  let tail: string;
  if (rel === from) {
    tail = "";
  } else if (from !== "" && rel.startsWith(`${from}/`)) {
    tail = rel.slice(from.length + 1);
  } else {
    return { kind: "unaffected" };
  }
  if (to === null) return { kind: "gone" };
  return { kind: "moved", to: tail ? `${to}/${tail}` : to };
}
