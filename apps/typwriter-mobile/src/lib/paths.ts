// Workspace-relative path helpers. Paths always use `/`, never start with one,
// and the empty string is the workspace root. Mirrors `remap_rel` in
// src-tauri/src/workspace.rs — the two must agree, or the frontend's tabs and
// the persisted metadata drift apart after a rename.

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
