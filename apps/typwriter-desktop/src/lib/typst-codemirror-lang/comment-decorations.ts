import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { Prec, RangeSetBuilder } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { Type } from "./lezer-typst/types"

const commentDecoration = Decoration.mark({
  class: "cm-typst-comment",
  attributes: { spellcheck: "false" },
  inclusive: true,
})

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)
  // Track the highest `to` position added to avoid duplicate/out-of-order
  // additions when a block comment overlaps multiple visible ranges.
  let lastTo = -1

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
          if (node.from >= lastTo) {
            builder.add(node.from, node.to, commentDecoration)
            lastTo = node.to
          }
          return false
        }
      },
    })
  }

  return builder.finish()
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
