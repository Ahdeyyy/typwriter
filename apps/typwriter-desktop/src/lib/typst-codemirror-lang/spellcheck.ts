import {
  ViewPlugin,
  Decoration,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { RangeSetBuilder } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { Type } from "./lezer-typst/types"

const noSpellcheck = Decoration.mark({
  attributes: { spellcheck: "false" },
})

const noSpellcheckBlocks = new Set([
  Type.Equation,
  Type.Raw,
  Type.Label,
  Type.Ref,
  Type.Link,
  Type.LineComment,
  Type.BlockComment,
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
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.from === node.to) return

        if (noSpellcheckBlocks.has(node.type.id)) {
          builder.add(node.from, node.to, noSpellcheck)
          return false
        }

        if (noSpellcheckTokens.has(node.type.id)) {
          builder.add(node.from, node.to, noSpellcheck)
        }
      },
    })
  }

  return builder.finish()
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
