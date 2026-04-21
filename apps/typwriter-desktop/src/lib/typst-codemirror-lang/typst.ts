import {
  Language,
  LanguageSupport,
  LanguageDescription,
  defineLanguageFacet,
  languageDataProp,
  foldNodeProp,
  indentNodeProp,
  ParseContext,
} from "@codemirror/language"
import { NodeProp } from "@lezer/common"
import { parser as baseParser, parseCode, nodeSet } from "./lezer-typst"

const data = defineLanguageFacet({
  commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
})

// Extend the node set with CodeMirror-specific props
const typstNodeSet = nodeSet.extend(
  languageDataProp.add({ Document: data }),
  foldNodeProp.add((type) => {
    if (type.name === "CodeBlock" || type.name === "ContentBlock") {
      return (tree: any, state: any) => ({
        from: tree.from + 1,
        to: tree.to - 1,
      })
    }
    if (type.name === "Raw") {
      return (tree: any, state: any) => {
        const text = state.doc.sliceString(
          tree.from,
          Math.min(tree.from + 100, tree.to),
        )
        const nl = text.indexOf("\n")
        if (nl < 0) return null
        return { from: tree.from + nl, to: tree.to }
      }
    }
    if (type.name === "Equation") {
      return (tree: any, state: any) => {
        if (tree.to - tree.from < 4) return null
        return { from: tree.from + 1, to: tree.to - 1 }
      }
    }
    return undefined
  }),
  indentNodeProp.add({
    Document: () => null,
    CodeBlock: (context: any) => context.baseIndent + context.unit,
    ContentBlock: (context: any) => context.baseIndent + context.unit,
  }),
)

// Create parser instance using the extended node set
const typstParser = baseParser.configure({ nodeSet: typstNodeSet })

/// The base Typst language (no nested code block parsing).
export const typstLanguage = new Language(data, baseParser, [], "typst")


/// Resolve a language info string (from a raw code block) to a
/// LanguageDescription, using either a list or a lookup function.
export function getCodeParser(
  languages:
    | readonly LanguageDescription[]
    | ((info: string) => Language | LanguageDescription | null)
    | undefined,
  defaultLanguage?: Language,
) {
  return (info: string) => {
    if (info && languages) {
      info = /\S*/.exec(info)![0]
      let found: Language | LanguageDescription | null = null
      if (typeof languages === "function") {
        found = languages(info)
      } else {
        found = LanguageDescription.matchLanguageName(languages, info, true)
      }
      if (found instanceof LanguageDescription) {
        return found.support
          ? found.support.language.parser
          : ParseContext.getSkippingParser(found.load())
      } else if (found) {
        return found.parser
      }
    }
    return defaultLanguage ? defaultLanguage.parser : null
  }
}

/// Create a Typst language support instance.
///
/// Options:
/// - `codeLanguages`: A list of `LanguageDescription` objects or a function
///   that maps language info strings to languages. Used for syntax highlighting
///   inside raw code blocks (`` ```lang ... ``` ``).
/// - `defaultCodeLanguage`: Fallback language for raw blocks without a language tag.
export function typst(config?: {
  codeLanguages?:
    | readonly LanguageDescription[]
    | ((info: string) => Language | LanguageDescription | null)
  defaultCodeLanguage?: Language
}): LanguageSupport {
  const { codeLanguages, defaultCodeLanguage } = config ?? {}

  let lang = typstLanguage
  if (codeLanguages || defaultCodeLanguage) {
    const codeParser = getCodeParser(codeLanguages, defaultCodeLanguage)
    const wrappedParser = baseParser.configure({
      wrap: parseCode({ codeParser }),
    })
    lang = new Language(data, wrappedParser, [], "typst")
  }

  return new LanguageSupport(lang)
}
