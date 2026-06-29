import {
  ViewPlugin,
  Decoration,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"
import { Type } from "./lezer-typst/types"
import { buildMergedMarks } from "./decoration-utils"

const noSpellcheck = Decoration.mark({
  attributes: { spellcheck: "false" },
})

const noSpellcheckBlocks = new Set([
  Type.Equation,
  Type.Raw,
  Type.Label,
  Type.Ref,
  Type.Link,
])

const noSpellcheckTokens = new Set([
  Type.Ident,
  Type.MathIdent,
  Type.Bool,
  Type.True,
  Type.False,
  Type.Int,
  Type.Float,
  Type.Numeric,
  Type.None,
  Type.Auto,
  Type.Str,
  Type.StrContent,
  Type.Escape,
  Type.Shorthand,
  Type.Hash,
  Type.RawDelim,
  Type.RawLang,
  Type.RawCode,
  Type.RefMarker,
  Type.Dollar,
  // Keywords
  Type.Let,
  Type.Set,
  Type.Show,
  Type.Context,
  Type.If,
  Type.Else,
  Type.For,
  Type.In,
  Type.While,
  Type.Break,
  Type.Continue,
  Type.Return,
  Type.Import,
  Type.Include,
  Type.As,
  Type.Not,
  Type.And,
  Type.Or,
])

function buildDecorations(view: EditorView): DecorationSet {
  const tree = syntaxTree(view.state)
  // Collect ranges first, then coalesce. Every range here carries the same
  // `noSpellcheck` mark, and adjacent/nested tokens (e.g. a `Str` wrapping a
  // `StrContent`, or a run of consecutive idents) would otherwise produce
  // touching/overlapping marks of the same type — which crashes CodeMirror's
  // tile renderer (see `buildMergedMarks`).
  const ranges: Array<{ from: number; to: number }> = []

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.from === node.to) return

        // Both branches cover their whole subtree, so stop descending: a child
        // token would only add a redundant, overlapping same-type mark.
        if (
          noSpellcheckBlocks.has(node.type.id) ||
          noSpellcheckTokens.has(node.type.id)
        ) {
          ranges.push({ from: node.from, to: node.to })
          return false
        }
      },
    })
  }

  return buildMergedMarks(ranges, noSpellcheck)
}

export const typstSpellcheck = ViewPlugin.fromClass(
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
