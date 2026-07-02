import { RangeSetBuilder } from "@codemirror/state"
import { Decoration, type DecorationSet } from "@codemirror/view"

/**
 * Build a `DecorationSet` that applies a single `mark` to `ranges`, coalescing
 * any touching or overlapping ranges into one.
 *
 * CodeMirror's view renderer can corrupt its internal "tile tree" — and then
 * crash during `EditorView.measure` with errors like *"Cannot destructure
 * property 'tile' of 'parents.pop(...)'"* — when it is handed **adjacent or
 * overlapping mark decorations of the same type** (this class of bug has been
 * patched repeatedly upstream, e.g. @codemirror/view 6.39.3 and 6.43.4, but
 * still reproduces). A plugin that tags many sibling/nested syntax nodes with
 * one shared `Decoration.mark` is a prime way to produce exactly that pattern,
 * so we merge such runs before they ever reach the view.
 *
 * `ranges` may be unsorted and may contain duplicates (e.g. the same node
 * reported once per visible range) — both are normalized here. Empty/inverted
 * ranges are dropped. The merge is only valid when every range carries the same
 * `mark`; callers must not mix decoration kinds in a single call.
 */
export function buildMergedMarks(
  ranges: Array<{ from: number; to: number }>,
  mark: Decoration,
): DecorationSet {
  const sorted = ranges
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)

  const builder = new RangeSetBuilder<Decoration>()
  let curFrom = -1
  let curTo = -1
  for (const { from, to } of sorted) {
    if (curTo < 0) {
      curFrom = from
      curTo = to
    } else if (from <= curTo) {
      // Touching or overlapping the open run — extend it rather than emitting
      // a second mark of the same type right next to the first.
      if (to > curTo) curTo = to
    } else {
      builder.add(curFrom, curTo, mark)
      curFrom = from
      curTo = to
    }
  }
  if (curTo >= 0) builder.add(curFrom, curTo, mark)

  return builder.finish()
}
