// Pure completion helpers (no Svelte/CM imports) so they're unit-testable.

import type { IpcCompletion } from "$lib/ipc/types";

export interface StripItem {
  label: string;
  kind: string;
  /** Already flattened (no `${…}` placeholders). */
  apply: string;
  /** Where to put the cursor inside `apply` after insert (-1 = end). */
  cursorOffset: number;
}

/** Flatten an LSP-ish snippet apply (e.g. `image(${})`) into plain text, placing
 *  the cursor at the first placeholder. Later holes are dropped (v1). */
export function flattenSnippet(c: IpcCompletion): StripItem {
  const apply = c.apply ?? c.label;
  const firstHole = apply.indexOf("${");
  const flattened = apply.replace(/\$\{[^}]*\}/g, "");
  return {
    label: c.label,
    kind: c.kind,
    apply: flattened,
    cursorOffset: firstHole >= 0 ? firstHole : -1,
  };
}

/** Whether auto-trigger applies, given the text on the current line before the
 *  cursor. Fires after `#`, `@`, `.`, or a word of ≥2 word-chars; declines
 *  inside a `//` line comment. */
export function autoTriggerApplies(beforeCursor: string): boolean {
  // Cheap noise filter: a line comment before the cursor.
  if (beforeCursor.includes("//")) return false;
  const lastChar = beforeCursor.at(-1);
  if (lastChar === "#" || lastChar === "@" || lastChar === ".") return true;
  return /[\w-]{2,}$/.test(beforeCursor);
}
