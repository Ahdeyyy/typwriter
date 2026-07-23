// Pure completion helpers (no Svelte/CM imports) so they're unit-testable.

import type { IpcCompletion } from "$lib/ipc/types";

export interface StripItem {
  label: string;
  kind: string;
  /** CodeMirror snippet template — `${name}` placeholders become selectable
   *  tabstops; everything else is inserted literally. */
  template: string;
}

/**
 * Convert a typst-ide completion `apply` string into a CodeMirror snippet
 * template. typst-ide marks placeholders as `${name}` (default text, e.g.
 * `${body}`) or `${}` (empty). CodeMirror's snippet parser treats `${…}` and
 * `#{…}` as fields and only honors `\{` / `\}` as escapes — so we escape every
 * literal brace. That neutralizes Typst's own `#{…}` code blocks and stray
 * braces while leaving real placeholders as tabstops (the first is selected on
 * accept; Tab/Escape jump through the rest, empty ones land the cursor only).
 */
export function typstApplyToSnippet(apply: string): string {
  let out = "";
  for (let i = 0; i < apply.length; i++) {
    const ch = apply[i];
    if (ch === "$" && apply[i + 1] === "{") {
      const end = apply.indexOf("}", i + 2);
      if (end !== -1) {
        const inner = apply.slice(i + 2, end);
        out += "${" + inner.replace(/[{}]/g, "\\$&") + "}";
        i = end; // for-loop ++ advances past the closing brace
        continue;
      }
    }
    out += ch === "{" || ch === "}" ? "\\" + ch : ch;
  }
  return out;
}

export function toStripItem(c: IpcCompletion): StripItem {
  return {
    label: c.label,
    kind: c.kind,
    template: typstApplyToSnippet(c.apply ?? c.label),
  };
}

/** Whether auto-trigger applies, given the text on the current line before the
 *  cursor. Fires on a trigger sigil (`#`, `@`, `.`), while typing an identifier
 *  that follows one (`#i`, `@r`, `dict.k`), or on a standalone word of ≥2
 *  word-chars; declines inside a `//` line comment.
 *
 *  The sigil-identifier branch is what keeps the list from flickering off: a
 *  bare `#` fires, but so does `#i` and `#im` — without it, the single-char
 *  state (`#i`) matched neither the sigil nor the ≥2-word branch, so the strip
 *  cleared for one keystroke and reappeared, reading as broken. */
export function autoTriggerApplies(beforeCursor: string): boolean {
  // Cheap noise filter: a line comment before the cursor.
  if (beforeCursor.includes("//")) return false;
  const lastChar = beforeCursor.at(-1);
  if (lastChar === "#" || lastChar === "@" || lastChar === ".") return true;
  // Mid-identifier right after a sigil — complete from the first character.
  if (/[#@.][\w-]+$/.test(beforeCursor)) return true;
  // A standalone word of 2+ chars, so plain prose doesn't request on every key.
  return /[\w-]{2,}$/.test(beforeCursor);
}
