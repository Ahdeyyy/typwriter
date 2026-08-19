// Turn "replace the document with this text" into the smallest edit that gets
// there, so CodeMirror can map the caret through it.
//
// Dispatching `{from: 0, to: doc.length, insert: text}` deletes everything the
// caret sits in, and every position inside a deleted range collapses to its
// edge — the user is thrown to the top of the file. Reloading a file that
// changed on disk should leave them where they were reading, so the change is
// narrowed to the span that actually differs first.

export interface MinimalChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * The single replacement that turns `oldText` into `newText`, trimmed to the
 * region between their common prefix and common suffix. `null` when the two are
 * already equal.
 *
 * Offsets are UTF-16 code units, CodeMirror's coordinate space. The scan works
 * on code units rather than code points, and the overlap guard is what keeps a
 * surrogate pair from being split: `lcs` can never reach back past `lcp`, so the
 * replaced span is always a whole, contiguous region of the original.
 */
export function minimalChange(oldText: string, newText: string): MinimalChange | null {
  if (oldText === newText) return null;

  const maxLen = Math.min(oldText.length, newText.length);

  let lcp = 0;
  while (lcp < maxLen && oldText.charCodeAt(lcp) === newText.charCodeAt(lcp)) {
    lcp++;
  }

  let lcs = 0;
  while (
    lcs < maxLen - lcp &&
    oldText.charCodeAt(oldText.length - 1 - lcs) === newText.charCodeAt(newText.length - 1 - lcs)
  ) {
    lcs++;
  }

  return {
    from: lcp,
    to: oldText.length - lcs,
    insert: newText.slice(lcp, newText.length - lcs),
  };
}
