import { NodeType, NodeSet, NodeProp } from "@lezer/common"
import { styleTags } from "@lezer/highlight"
import { highlight } from "./highlight"

/// All Typst syntax node type IDs.
export const enum Type {
  // === Document root ===
  Document = 1,

  // === Markup nodes ===
  Text,
  Space,
  Parbreak,
  Linebreak,
  Escape,
  Shorthand,
  SmartQuote,
  Strong,
  StrongMarker,
  Emph,
  EmphMarker,
  Raw,
  RawDelim,
  RawLang,
  RawCode,
  Heading,
  HeadingMarker,
  ListItem,
  ListMarker,
  EnumItem,
  EnumMarker,
  TermItem,
  TermMarker,
  Link,
  Label,
  Ref,
  RefMarker,
  Equation,

  // === Math nodes ===
  MathIdent,
  MathText,
  MathShorthand,
  MathAlignPoint,
  MathDelimited,
  MathAttach,
  MathFrac,
  MathRoot,
  MathPrimes,
  MathCall,
  MathArgs,

  // === Code nodes ===
  Ident,
  Bool,
  Int,
  Float,
  Numeric,
  Str,
  StrContent,
  CodeBlock,
  ContentBlock,
  Parenthesized,
  Array,
  Dict,
  Named,
  Keyed,
  Unary,
  Binary,
  FieldAccess,
  FuncCall,
  Args,
  Closure,
  Params,
  Spread,
  LetBinding,
  SetRule,
  ShowRule,
  Conditional,
  WhileLoop,
  ForLoop,
  ModuleImport,
  ModuleInclude,
  FuncReturn,
  LoopBreak,
  LoopContinue,
  Destructuring,
  ContextExpr,

  // === Punctuation / operator tokens ===
  Hash,
  LeftBrace,
  RightBrace,
  LeftBracket,
  RightBracket,
  LeftParen,
  RightParen,
  Comma,
  Semicolon,
  Colon,
  Dot,
  Plus,
  Minus,
  Star,
  Slash,
  Eq,
  EqEq,
  ExclEq,
  Lt,
  LtEq,
  Gt,
  GtEq,
  PlusEq,
  HyphEq,
  StarEq,
  SlashEq,
  Dots,
  Arrow,
  Hat,
  Underscore,
  Dollar,
  Bang,

  // === Keywords ===
  Not,
  And,
  Or,
  None,
  Auto,
  Let,
  Set,
  Show,
  Context,
  If,
  Else,
  For,
  In,
  While,
  Break,
  Continue,
  Return,
  Import,
  Include,
  As,
  True,
  False,

  // === Comments ===
  LineComment,
  BlockComment,

  // === Error ===
  Error,

  _Count,
}

// Groups for tree navigation
const blockGroup = ["Block"]
const inlineGroup = ["Inline"]
const mathGroup = ["Math"]
const codeGroup = ["Code"]
const keywordGroup = ["Code", "Keyword"]
const operatorGroup = ["Code", "Operator"]

function defineTypes(): NodeType[] {
  const types: NodeType[] = [NodeType.none]

  function def(id: number, name: string, props?: Record<string, any>) {
    const p: [NodeProp<any>, any][] = []
    if (props?.group) p.push([NodeProp.group, props.group])
    types[id] = NodeType.define({
      id,
      name,
      props: p,
      top: name === "Document",
      error: name === "Error",
    })
  }

  // Document
  def(Type.Document, "Document")

  // Markup
  def(Type.Text, "Text", { group: inlineGroup })
  def(Type.Space, "Space", { group: inlineGroup })
  def(Type.Parbreak, "Parbreak", { group: blockGroup })
  def(Type.Linebreak, "Linebreak", { group: inlineGroup })
  def(Type.Escape, "Escape", { group: inlineGroup })
  def(Type.Shorthand, "Shorthand", { group: inlineGroup })
  def(Type.SmartQuote, "SmartQuote", { group: inlineGroup })
  def(Type.Strong, "Strong", { group: inlineGroup })
  def(Type.StrongMarker, "StrongMarker")
  def(Type.Emph, "Emph", { group: inlineGroup })
  def(Type.EmphMarker, "EmphMarker")
  def(Type.Raw, "Raw", { group: blockGroup })
  def(Type.RawDelim, "RawDelim")
  def(Type.RawLang, "RawLang")
  def(Type.RawCode, "RawCode")
  def(Type.Heading, "Heading", { group: blockGroup })
  def(Type.HeadingMarker, "HeadingMarker")
  def(Type.ListItem, "ListItem", { group: blockGroup })
  def(Type.ListMarker, "ListMarker")
  def(Type.EnumItem, "EnumItem", { group: blockGroup })
  def(Type.EnumMarker, "EnumMarker")
  def(Type.TermItem, "TermItem", { group: blockGroup })
  def(Type.TermMarker, "TermMarker")
  def(Type.Link, "Link", { group: inlineGroup })
  def(Type.Label, "Label", { group: inlineGroup })
  def(Type.Ref, "Ref", { group: inlineGroup })
  def(Type.RefMarker, "RefMarker")
  def(Type.Equation, "Equation", { group: inlineGroup })

  // Math
  def(Type.MathIdent, "MathIdent", { group: mathGroup })
  def(Type.MathText, "MathText", { group: mathGroup })
  def(Type.MathShorthand, "MathShorthand", { group: mathGroup })
  def(Type.MathAlignPoint, "MathAlignPoint", { group: mathGroup })
  def(Type.MathDelimited, "MathDelimited", { group: mathGroup })
  def(Type.MathAttach, "MathAttach", { group: mathGroup })
  def(Type.MathFrac, "MathFrac", { group: mathGroup })
  def(Type.MathRoot, "MathRoot", { group: mathGroup })
  def(Type.MathPrimes, "MathPrimes", { group: mathGroup })
  def(Type.MathCall, "MathCall", { group: mathGroup })
  def(Type.MathArgs, "MathArgs", { group: mathGroup })

  // Code
  def(Type.Ident, "Ident", { group: codeGroup })
  def(Type.Bool, "Bool", { group: codeGroup })
  def(Type.Int, "Int", { group: codeGroup })
  def(Type.Float, "Float", { group: codeGroup })
  def(Type.Numeric, "Numeric", { group: codeGroup })
  def(Type.Str, "Str", { group: codeGroup })
  def(Type.StrContent, "StrContent", { group: codeGroup })
  def(Type.CodeBlock, "CodeBlock", { group: codeGroup })
  def(Type.ContentBlock, "ContentBlock", { group: codeGroup })
  def(Type.Parenthesized, "Parenthesized", { group: codeGroup })
  def(Type.Array, "Array", { group: codeGroup })
  def(Type.Dict, "Dict", { group: codeGroup })
  def(Type.Named, "Named", { group: codeGroup })
  def(Type.Keyed, "Keyed", { group: codeGroup })
  def(Type.Unary, "Unary", { group: codeGroup })
  def(Type.Binary, "Binary", { group: codeGroup })
  def(Type.FieldAccess, "FieldAccess", { group: codeGroup })
  def(Type.FuncCall, "FuncCall", { group: codeGroup })
  def(Type.Args, "Args", { group: codeGroup })
  def(Type.Closure, "Closure", { group: codeGroup })
  def(Type.Params, "Params", { group: codeGroup })
  def(Type.Spread, "Spread", { group: codeGroup })
  def(Type.LetBinding, "LetBinding", { group: codeGroup })
  def(Type.SetRule, "SetRule", { group: codeGroup })
  def(Type.ShowRule, "ShowRule", { group: codeGroup })
  def(Type.Conditional, "Conditional", { group: codeGroup })
  def(Type.WhileLoop, "WhileLoop", { group: codeGroup })
  def(Type.ForLoop, "ForLoop", { group: codeGroup })
  def(Type.ModuleImport, "ModuleImport", { group: codeGroup })
  def(Type.ModuleInclude, "ModuleInclude", { group: codeGroup })
  def(Type.FuncReturn, "FuncReturn", { group: codeGroup })
  def(Type.LoopBreak, "LoopBreak", { group: codeGroup })
  def(Type.LoopContinue, "LoopContinue", { group: codeGroup })
  def(Type.Destructuring, "Destructuring", { group: codeGroup })
  def(Type.ContextExpr, "ContextExpr", { group: codeGroup })

  // Punctuation / operators
  def(Type.Hash, "Hash", { group: operatorGroup })
  def(Type.LeftBrace, "LeftBrace", { group: operatorGroup })
  def(Type.RightBrace, "RightBrace", { group: operatorGroup })
  def(Type.LeftBracket, "LeftBracket", { group: operatorGroup })
  def(Type.RightBracket, "RightBracket", { group: operatorGroup })
  def(Type.LeftParen, "LeftParen", { group: operatorGroup })
  def(Type.RightParen, "RightParen", { group: operatorGroup })
  def(Type.Comma, "Comma", { group: operatorGroup })
  def(Type.Semicolon, "Semicolon", { group: operatorGroup })
  def(Type.Colon, "Colon", { group: operatorGroup })
  def(Type.Dot, "Dot", { group: operatorGroup })
  def(Type.Plus, "Plus", { group: operatorGroup })
  def(Type.Minus, "Minus", { group: operatorGroup })
  def(Type.Star, "Star", { group: operatorGroup })
  def(Type.Slash, "Slash", { group: operatorGroup })
  def(Type.Eq, "Eq", { group: operatorGroup })
  def(Type.EqEq, "EqEq", { group: operatorGroup })
  def(Type.ExclEq, "ExclEq", { group: operatorGroup })
  def(Type.Lt, "Lt", { group: operatorGroup })
  def(Type.LtEq, "LtEq", { group: operatorGroup })
  def(Type.Gt, "Gt", { group: operatorGroup })
  def(Type.GtEq, "GtEq", { group: operatorGroup })
  def(Type.PlusEq, "PlusEq", { group: operatorGroup })
  def(Type.HyphEq, "HyphEq", { group: operatorGroup })
  def(Type.StarEq, "StarEq", { group: operatorGroup })
  def(Type.SlashEq, "SlashEq", { group: operatorGroup })
  def(Type.Dots, "Dots", { group: operatorGroup })
  def(Type.Arrow, "Arrow", { group: operatorGroup })
  def(Type.Hat, "Hat", { group: operatorGroup })
  def(Type.Underscore, "Underscore", { group: operatorGroup })
  def(Type.Dollar, "Dollar", { group: operatorGroup })
  def(Type.Bang, "Bang", { group: operatorGroup })

  // Keywords
  def(Type.Not, "Not", { group: keywordGroup })
  def(Type.And, "And", { group: keywordGroup })
  def(Type.Or, "Or", { group: keywordGroup })
  def(Type.None, "None", { group: keywordGroup })
  def(Type.Auto, "Auto", { group: keywordGroup })
  def(Type.Let, "Let", { group: keywordGroup })
  def(Type.Set, "Set", { group: keywordGroup })
  def(Type.Show, "Show", { group: keywordGroup })
  def(Type.Context, "Context", { group: keywordGroup })
  def(Type.If, "If", { group: keywordGroup })
  def(Type.Else, "Else", { group: keywordGroup })
  def(Type.For, "For", { group: keywordGroup })
  def(Type.In, "In", { group: keywordGroup })
  def(Type.While, "While", { group: keywordGroup })
  def(Type.Break, "Break", { group: keywordGroup })
  def(Type.Continue, "Continue", { group: keywordGroup })
  def(Type.Return, "Return", { group: keywordGroup })
  def(Type.Import, "Import", { group: keywordGroup })
  def(Type.Include, "Include", { group: keywordGroup })
  def(Type.As, "As", { group: keywordGroup })
  def(Type.True, "True", { group: keywordGroup })
  def(Type.False, "False", { group: keywordGroup })

  // Comments
  def(Type.LineComment, "LineComment")
  def(Type.BlockComment, "BlockComment")

  // Error
  def(Type.Error, "Error")

  return types
}

export const nodeTypes = defineTypes()

export const nodeSet = new NodeSet(nodeTypes).extend(highlight)
