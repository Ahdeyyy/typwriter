import { styleTags, tags as t } from "@lezer/highlight"

export const highlight = styleTags({
  // Markup
  "Text Space": t.content,
  "Linebreak Parbreak": t.processingInstruction,
  Escape: t.escape,
  Shorthand: t.character,
  SmartQuote: t.quote,
  "Strong/...": t.strong,
  StrongMarker: t.processingInstruction,
  "Emph/...": t.emphasis,
  EmphMarker: t.processingInstruction,
  "Heading/...": t.heading,
  HeadingMarker: t.processingInstruction,
  ListMarker: t.list,
  EnumMarker: t.list,
  TermMarker: t.list,
  RawDelim: t.processingInstruction,
  RawLang: t.labelName,
  RawCode: t.monospace,
  Link: t.link,
  Label: t.labelName,
  Ref: t.labelName,
  RefMarker: t.processingInstruction,
  "Dollar": t.processingInstruction,

  // Math
  MathIdent: t.variableName,
  MathText: t.content,
  MathShorthand: t.operator,
  MathAlignPoint: t.processingInstruction,

  // Code identifiers & literals
  Ident: t.variableName,
  Bool: t.bool,
  "True False": t.bool,
  Int: t.integer,
  Float: t.float,
  Numeric: t.unit,
  Str: t.string,
  StrContent: t.string,
  "None Auto": t.null,

  // Keywords
  "Let Set Show If Else For In While Break Continue Return Import Include As Context Not And Or": t.keyword,

  // Operators & punctuation
  "Plus Minus Star Slash Eq EqEq ExclEq Lt LtEq Gt GtEq PlusEq HyphEq StarEq SlashEq": t.operator,
  "Dots Arrow Hat Underscore Bang Hash": t.operator,
  "LeftBrace RightBrace LeftBracket RightBracket LeftParen RightParen": t.bracket,
  "Comma Semicolon Colon Dot": t.separator,

  // Comments
  LineComment: t.lineComment,
  BlockComment: t.blockComment,

  // Function calls
  "FuncCall/Ident": t.function(t.variableName),
  "MathCall/MathIdent": t.function(t.variableName),

  // Error
  Error: t.invalid,
})
