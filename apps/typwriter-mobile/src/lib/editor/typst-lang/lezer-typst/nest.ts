import { parseMixed, type SyntaxNodeRef, type Input, Parser } from "@lezer/common"
import { Type } from "./types"

/// Create a wrapper that enables nested parsing of code blocks.
/// When a raw block (` ```lang ... ``` `) has a language tag,
/// the `codeParser` function is called with the language name.
/// If it returns a parser, that parser is used to parse the code
/// content inside the raw block.
///
/// Usage:
/// ```ts
/// import { parser } from "lezer-typst"
/// import { parseCode } from "lezer-typst/nest"
///
/// const typstParser = parser.configure({
///   wrap: parseCode({
///     codeParser(info) {
///       if (info === "javascript") return javascriptParser
///       return null
///     }
///   })
/// })
/// ```
export function parseCode(config: {
  /// Given a language info string (e.g. "javascript", "python"),
  /// return a parser for that language, or null if none is available.
  codeParser?: (info: string) => Parser | null
}) {
  const { codeParser } = config
  return parseMixed((node: SyntaxNodeRef, input: Input) => {
    if (!codeParser) return null

    // Only process Raw nodes (code blocks)
    if (node.type.id !== Type.Raw) return null

    // Find the language tag child
    let info = ""
    let cursor = node.node.cursor()
    if (cursor.firstChild()) {
      do {
        if (cursor.type.id === Type.RawLang) {
          info = input.read(cursor.from, cursor.to)
          break
        }
      } while (cursor.nextSibling())
    }

    const parser = codeParser(info)
    if (!parser) return null

    // Parse only the RawCode children (not delimiters or language tag)
    return {
      parser,
      overlay: (childNode: SyntaxNodeRef) => childNode.type.id === Type.RawCode,
    }
  })
}
