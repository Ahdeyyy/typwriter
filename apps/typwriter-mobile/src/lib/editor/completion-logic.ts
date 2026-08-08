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

// ─── Relevance ────────────────────────────────────────────────────────────────
//
// typst-ide does not filter its candidates: for `#im|` it hands back every
// binding in scope (~200 globals plus locals) in scope order, and for an
// explicit trigger in markup it hands back the fixed snippet list. Narrowing
// that to what the user typed is the client's job — CodeMirror's
// `autocompletion()` does it on desktop, and the touch strip has to do it here
// or the chips are just "the first N things typst emitted".

/**
 * Initials of the words in `label`, so `pb` matches `page-break` and `tS`
 * matches `toString`. A word starts at the beginning, after a separator, or at
 * a lower→upper transition.
 */
function wordInitials(label: string): string {
  let out = "";
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (/[-_.]/.test(ch)) continue;
    const prev = label[i - 1];
    if (i === 0 || /[-_.]/.test(prev) || (prev === prev.toLowerCase() && ch !== ch.toLowerCase())) {
      out += ch;
    }
  }
  return out;
}

/**
 * Score `needle` as a subsequence of `hay` (both lowercased), or null if it
 * isn't one. Tighter matches that start earlier score higher, so `pgbk` prefers
 * `page-break` over a label that merely happens to contain those letters spread
 * out.
 */
function subsequenceScore(hay: string, needle: string): number | null {
  let i = 0;
  let start = -1;
  let end = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) {
      if (start < 0) start = j;
      end = j + 1;
      i++;
    }
  }
  if (i < needle.length) return null;
  const gaps = end - start - needle.length; // characters skipped inside the match
  return Math.max(0, 60 - gaps * 3 - start);
}

/**
 * How well `label` answers what the user typed. `null` drops the candidate.
 * Bands, best first — they can't overlap, so a weaker kind of match never
 * outranks a stronger one:
 *
 *   300+  exact-case prefix        `im`   → `image`
 *   200+  case-insensitive prefix  `IM`   → `image`
 *   100+  word initials            `pb`   → `page-break`, `tS` → `toString`
 *     0+  subsequence              `pgbk` → `page-break`
 *
 * Within a band shorter labels win, so `box` beats `bookmark` for `bo`.
 * An empty prefix matches everything at equal score, which preserves typst's
 * own order for the "nothing typed yet" case (`#|`, or the button on a blank
 * line).
 */
export function scoreCompletion(label: string, prefix: string): number | null {
  if (!prefix) return 0;
  const shorter = Math.max(0, 40 - label.length); // 0..40
  if (label.startsWith(prefix)) return 300 + shorter;

  const l = label.toLowerCase();
  const p = prefix.toLowerCase();
  if (l.startsWith(p)) return 200 + shorter;
  if (wordInitials(label).toLowerCase().startsWith(p)) return 100 + shorter;

  const sub = subsequenceScore(l, p);
  return sub === null ? null : sub + shorter / 4;
}

/**
 * Drop the candidates that don't match `prefix`, best first, then cut to
 * `limit`. Truncating *after* ranking is the whole point: cutting first (which
 * is what both the Rust cap and the old client slice did) throws away the item
 * the user is typing towards.
 */
export function rankCompletions(
  items: readonly StripItem[],
  prefix: string,
  limit: number,
): StripItem[] {
  if (!prefix) return items.slice(0, limit);
  const scored: { item: StripItem; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = scoreCompletion(item.label, prefix);
    if (score !== null) scored.push({ item, score, index });
  });
  // Ties keep typst's order, which already puts locals before globals.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.item);
}

/** Start of the `[\w-]` run ending at `cursor` within `line`, as a doc offset.
 *  `lineFrom` is the doc offset of the line's first character. */
export function wordStartBefore(line: string, lineFrom: number, cursor: number): number {
  let i = cursor - lineFrom;
  while (i > 0 && /[\w-]/.test(line[i - 1])) i--;
  return lineFrom + i;
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
