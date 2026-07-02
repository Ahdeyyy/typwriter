import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { Prec } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { Type } from "./lezer-typst/types"
import { buildMergedMarks } from "./decoration-utils"

const commentDecoration = Decoration.mark({
  class: "cm-typst-comment",
  attributes: { spellcheck: "false" },
  inclusive: true,
})

function buildDecorations(view: EditorView): DecorationSet {
  const tree = syntaxTree(view.state)
  // Collect comment ranges, then coalesce. A block comment spanning several
  // visible ranges is reported once per range, and `buildMergedMarks` dedupes
  // those and merges any touching same-type marks (the pattern that crashes
  // CodeMirror's tile renderer).
  const ranges: Array<{ from: number; to: number }> = []

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (
          node.from !== node.to &&
          (node.type.id === Type.LineComment ||
            node.type.id === Type.BlockComment)
        ) {
          ranges.push({ from: node.from, to: node.to })
          return false
        }
      },
    })
  }

  return buildMergedMarks(ranges, commentDecoration)
}

const commentDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

export const typstCommentDecorations = Prec.highest(commentDecorationPlugin)
