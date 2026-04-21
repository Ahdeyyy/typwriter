import { Type } from "./types"
import { Elt, TypstParseContext } from "./parser"
import { Scanner, Ch, isAlpha, isDigit, isHexDigit, isIdentStart, isIdentChar, isWhitespace, isNewline, isLineWhitespace } from "./scanner"
import { parseContentBlock, parseLineComment, parseBlockComment } from "./markup"
import { parseMathContent } from "./math"

/// Keyword table for quick lookup.
const KEYWORDS: Record<string, number> = {
  let: Type.Let, set: Type.Set, show: Type.Show,
  if: Type.If, else: Type.Else,
  for: Type.For, in: Type.In, while: Type.While,
  break: Type.Break, continue: Type.Continue, return: Type.Return,
  import: Type.Import, include: Type.Include, as: Type.As,
  not: Type.Not, and: Type.And, or: Type.Or,
  none: Type.None, auto: Type.Auto,
  true: Type.True, false: Type.False,
  context: Type.Context,
}

/// Parse a code expression after `#` in markup/math, or as a statement in a code block.
/// When `embedded` is true, we're in markup context and should only parse a single
/// expression (not a full code block).
export function parseCodeExpr(s: Scanner, ctx: TypstParseContext, embedded: boolean): Elt | null {
  skipWhitespaceAndComments(s)

  const ch = s.peek()
  if (ch === Ch.EOF) return null

  // Keyword-led expressions
  if (isIdentStart(ch)) {
    const word = peekWord(s)
    const kwType = KEYWORDS[word]

    if (kwType !== undefined) {
      switch (kwType) {
        case Type.Let: return parseLetBinding(s, ctx)
        case Type.Set: return parseSetRule(s, ctx)
        case Type.Show: return parseShowRule(s, ctx)
        case Type.If: return parseConditional(s, ctx)
        case Type.For: return parseForLoop(s, ctx)
        case Type.While: return parseWhileLoop(s, ctx)
        case Type.Import: return parseImport(s, ctx)
        case Type.Include: return parseInclude(s, ctx)
        case Type.Return: return parseReturn(s, ctx)
        case Type.Break: return parseBreakContinue(s, Type.Break, Type.LoopBreak)
        case Type.Continue: return parseBreakContinue(s, Type.Continue, Type.LoopContinue)
        case Type.Context: return parseContextExpr(s, ctx)
        default: break
      }
    }
  }

  // Non-keyword expression
  return parseExpr(s, ctx, 0, embedded)
}

/// Parse a code block: { ... }
export function parseCodeBlock(s: Scanner, ctx: TypstParseContext): Elt | null {
  if (s.peek() !== Ch.LeftBrace) return null
  const start = s.pos
  s.next() // consume {

  const children: Elt[] = [new Elt(Type.LeftBrace, start, s.pos)]

  // Parse statements until }
  while (!s.done) {
    skipWhitespaceAndComments(s, children)

    if (s.peek() === Ch.RightBrace) break
    if (s.done) break

    const stmt = parseCodeExpr(s, ctx, false)
    if (stmt) {
      children.push(stmt)
    } else {
      // Error recovery: skip one character
      const errStart = s.pos
      s.next()
      children.push(new Elt(Type.Error, errStart, s.pos))
    }

    // Optional semicolons
    skipWhitespaceAndComments(s, children)
    if (s.peek() === Ch.Semicolon) {
      const semiPos = s.pos
      s.next()
      children.push(new Elt(Type.Semicolon, semiPos, s.pos))
    }
  }

  if (s.eat(Ch.RightBrace)) {
    children.push(new Elt(Type.RightBrace, s.pos - 1, s.pos))
  }

  return new Elt(Type.CodeBlock, start, s.pos, children)
}

// ===== Expression parsing with precedence climbing =====

/// Precedence levels for binary operators.
const enum Prec {
  Assign = 1,
  Or = 2,
  And = 3,
  Compare = 4,
  Add = 5,
  Mul = 6,
  Unary = 7,
  Postfix = 8,
}

function parseExpr(s: Scanner, ctx: TypstParseContext, minPrec: number, embedded: boolean): Elt | null {
  let left = parseUnary(s, ctx, embedded)
  if (!left) return null

  for (;;) {
    const ch = s.peek()

    // In embedded mode, stop at whitespace before binary operators.
    // But always allow postfix operations (field access, calls, content blocks)
    // when there's no space between them.

    // Field access: .ident (no space required)
    if (ch === Ch.Dot && isIdentStart(s.peek(1))) {
      const dotStart = s.pos
      s.next() // consume .
      const dotElt = new Elt(Type.Dot, dotStart, s.pos)
      const ident = parseIdentifier(s)
      if (ident) {
        left = new Elt(Type.FieldAccess, left.from, s.pos, [left, dotElt, ident])
        continue
      }
    }

    // Function call: expr(...) - must be immediately adjacent (no space)
    if (ch === Ch.LeftParen) {
      const args = parseArgs(s, ctx)
      if (args) {
        left = new Elt(Type.FuncCall, left.from, s.pos, [left, args])
        continue
      }
    }

    // Content block after call: expr[...] - must be immediately adjacent
    if (ch === Ch.LeftBracket) {
      const cb = parseContentBlock(s, ctx)
      if (cb) {
        if (left.type === Type.FuncCall) {
          left = new Elt(Type.FuncCall, left.from, s.pos, [...left.children, cb])
        } else {
          left = new Elt(Type.FuncCall, left.from, s.pos, [left, cb])
        }
        continue
      }
    }

    // In embedded mode, don't consume binary operators
    if (embedded) break

    skipWhitespaceAndComments(s)

    // Binary operators
    const binOp = getBinOp(s)
    if (binOp && binOp.prec >= minPrec) {
      const opStart = s.pos
      s.pos += binOp.len
      const opElt = new Elt(binOp.type, opStart, s.pos)

      skipWhitespaceAndComments(s)
      const right = parseExpr(s, ctx, binOp.prec + (binOp.rightAssoc ? 0 : 1), embedded)

      if (right) {
        left = new Elt(Type.Binary, left.from, s.pos, [left, opElt, right])
      } else {
        left = new Elt(Type.Binary, left.from, s.pos, [left, opElt])
      }
      continue
    }

    break
  }

  return left
}

interface BinOp {
  type: number
  prec: number
  len: number
  rightAssoc?: boolean
}

function getBinOp(s: Scanner): BinOp | null {
  const ch = s.peek()
  const ch2 = s.peek(1)

  // Two-character operators
  if (ch === Ch.Eq && ch2 === Ch.Eq) return { type: Type.EqEq, prec: Prec.Compare, len: 2 }
  if (ch === Ch.Bang && ch2 === Ch.Eq) return { type: Type.ExclEq, prec: Prec.Compare, len: 2 }
  if (ch === Ch.Lt && ch2 === Ch.Eq) return { type: Type.LtEq, prec: Prec.Compare, len: 2 }
  if (ch === Ch.Gt && ch2 === Ch.Eq) return { type: Type.GtEq, prec: Prec.Compare, len: 2 }
  if (ch === Ch.Plus && ch2 === Ch.Eq) return { type: Type.PlusEq, prec: Prec.Assign, len: 2, rightAssoc: true }
  if (ch === Ch.Minus && ch2 === Ch.Eq) return { type: Type.HyphEq, prec: Prec.Assign, len: 2, rightAssoc: true }
  if (ch === Ch.Star && ch2 === Ch.Eq) return { type: Type.StarEq, prec: Prec.Assign, len: 2, rightAssoc: true }
  if (ch === Ch.Slash && ch2 === Ch.Eq) return { type: Type.SlashEq, prec: Prec.Assign, len: 2, rightAssoc: true }
  if (ch === Ch.Eq && ch2 === Ch.Gt) return null // Arrow, not a binary op here

  // Single-character operators
  if (ch === Ch.Plus) return { type: Type.Plus, prec: Prec.Add, len: 1 }
  if (ch === Ch.Minus) return { type: Type.Minus, prec: Prec.Add, len: 1 }
  if (ch === Ch.Star) return { type: Type.Star, prec: Prec.Mul, len: 1 }
  if (ch === Ch.Slash && ch2 !== Ch.Slash && ch2 !== Ch.Star) return { type: Type.Slash, prec: Prec.Mul, len: 1 }
  if (ch === Ch.Eq) return { type: Type.Eq, prec: Prec.Assign, len: 1, rightAssoc: true }
  if (ch === Ch.Lt) return { type: Type.Lt, prec: Prec.Compare, len: 1 }
  if (ch === Ch.Gt) return { type: Type.Gt, prec: Prec.Compare, len: 1 }

  // Keyword operators
  const word = peekWord(s)
  if (word === "and") return { type: Type.And, prec: Prec.And, len: 3 }
  if (word === "or") return { type: Type.Or, prec: Prec.Or, len: 2 }
  if (word === "in") return { type: Type.In, prec: Prec.Compare, len: 2 }
  // "not in" handled as compound
  if (word === "not" && s.text.slice(s.pos + 3).trimStart().startsWith("in")) {
    // "not in" is a compare operator
    const totalLen = s.text.slice(s.pos).indexOf("in") + 2
    return { type: Type.Not, prec: Prec.Compare, len: totalLen }
  }

  return null
}

function parseUnary(s: Scanner, ctx: TypstParseContext, embedded: boolean): Elt | null {
  skipWhitespaceAndComments(s)
  const ch = s.peek()
  const pos = s.pos

  // Unary minus / plus
  if ((ch === Ch.Minus || ch === Ch.Plus) && !isLineWhitespace(s.peek(1))) {
    s.next()
    const opElt = new Elt(ch === Ch.Minus ? Type.Minus : Type.Plus, pos, s.pos)
    const operand = parseUnary(s, ctx, embedded)
    if (operand) {
      return new Elt(Type.Unary, pos, s.pos, [opElt, operand])
    }
    return opElt
  }

  // Keyword "not"
  if (isIdentStart(ch)) {
    const word = peekWord(s)
    if (word === "not") {
      s.pos += 3
      const opElt = new Elt(Type.Not, pos, s.pos)
      skipWhitespaceAndComments(s)
      const operand = parseUnary(s, ctx, embedded)
      if (operand) {
        return new Elt(Type.Unary, pos, s.pos, [opElt, operand])
      }
      return opElt
    }
  }

  return parseAtom(s, ctx, embedded)
}

function parseAtom(s: Scanner, ctx: TypstParseContext, embedded: boolean): Elt | null {
  skipWhitespaceAndComments(s)
  const ch = s.peek()
  const pos = s.pos

  if (ch === Ch.EOF) return null

  // String literal: "..."
  if (ch === Ch.DoubleQuote) return parseString(s)

  // Number literal
  if (isDigit(ch)) return parseNumber(s)
  // Negative number when we see a dot followed by digit
  if (ch === Ch.Dot && isDigit(s.peek(1))) return parseNumber(s)

  // Identifier or keyword-value (true, false, none, auto)
  if (isIdentStart(ch)) {
    const word = peekWord(s)

    // Boolean literals
    if (word === "true" || word === "false") {
      s.pos += word.length
      return new Elt(Type.Bool, pos, s.pos)
    }
    // None
    if (word === "none") {
      s.pos += 4
      return new Elt(Type.None, pos, s.pos)
    }
    // Auto
    if (word === "auto") {
      s.pos += 4
      return new Elt(Type.Auto, pos, s.pos)
    }

    return parseIdentifier(s)
  }

  // Code block: { ... }
  if (ch === Ch.LeftBrace) return parseCodeBlock(s, ctx)

  // Content block: [ ... ]
  if (ch === Ch.LeftBracket) return parseContentBlock(s, ctx)

  // Parenthesized / array / dict / closure params: ( ... )
  if (ch === Ch.LeftParen) return parseParenExpr(s, ctx)

  // Dollar (equation in code mode)
  if (ch === Ch.Dollar) {
    const start = s.pos
    s.next()
    const children: Elt[] = [new Elt(Type.Dollar, start, s.pos)]
    const mathElts = parseMathContent(s, ctx)
    children.push(...mathElts)
    if (s.eat(Ch.Dollar)) {
      children.push(new Elt(Type.Dollar, s.pos - 1, s.pos))
    }
    return new Elt(Type.Equation, start, s.pos, children)
  }

  // Spread: ..
  if (ch === Ch.Dot && s.peek(1) === Ch.Dot) {
    s.next(); s.next()
    const dotsElt = new Elt(Type.Dots, pos, s.pos)
    const expr = parseExpr(s, ctx, 0, false)
    if (expr) {
      return new Elt(Type.Spread, pos, s.pos, [dotsElt, expr])
    }
    return dotsElt
  }

  return null
}

// ===== Literals =====

function parseString(s: Scanner): Elt {
  const start = s.pos
  s.next() // consume opening "
  const children: Elt[] = []

  const contentStart = s.pos
  while (!s.done && s.peek() !== Ch.DoubleQuote) {
    if (s.peek() === Ch.Backslash) {
      // Flush content before escape
      if (s.pos > contentStart) {
        // content up to here
      }
      s.next() // backslash
      if (!s.done) s.next() // escaped char
    } else {
      s.next()
    }
  }

  if (s.pos > start + 1) {
    children.push(new Elt(Type.StrContent, start + 1, s.pos))
  }

  s.eat(Ch.DoubleQuote) // consume closing "

  return new Elt(Type.Str, start, s.pos, children)
}

function parseNumber(s: Scanner): Elt {
  const start = s.pos
  let isFloat = false

  // Check for hex/binary/octal prefix
  if (s.peek() === Ch.Zero) {
    const next = s.peek(1)
    if (next === Ch.x) {
      s.next(); s.next()
      s.eatWhile(isHexDigit)
      return new Elt(Type.Int, start, s.pos)
    }
    if (next === Ch.b) {
      s.next(); s.next()
      s.eatWhile(ch => ch === Ch.Zero || ch === 49) // 0 or 1
      return new Elt(Type.Int, start, s.pos)
    }
    if (next === Ch.o) {
      s.next(); s.next()
      s.eatWhile(ch => ch >= Ch.Zero && ch <= 55) // 0-7
      return new Elt(Type.Int, start, s.pos)
    }
  }

  // Decimal digits
  if (s.peek() === Ch.Dot) {
    isFloat = true
  } else {
    s.eatWhile(isDigit)
  }

  // Decimal point
  if (s.peek() === Ch.Dot && isDigit(s.peek(1))) {
    isFloat = true
    s.next()
    s.eatWhile(isDigit)
  }

  // Exponent
  if (s.peek() === Ch.e || s.peek() === 69) { // e or E
    isFloat = true
    s.next()
    if (s.peek() === Ch.Plus || s.peek() === Ch.Minus) s.next()
    s.eatWhile(isDigit)
  }

  // Unit suffix: pt, cm, mm, em, in, deg, rad, fr, %
  const unitStart = s.pos
  if (s.peek() === Ch.Percent) {
    s.next()
    return new Elt(Type.Numeric, start, s.pos)
  }
  const unit = peekWord(s)
  const validUnits = ["pt", "mm", "cm", "in", "em", "deg", "rad", "fr"]
  if (validUnits.includes(unit)) {
    s.pos += unit.length
    return new Elt(Type.Numeric, start, s.pos)
  }

  return new Elt(isFloat ? Type.Float : Type.Int, start, s.pos)
}

function parseIdentifier(s: Scanner): Elt | null {
  const start = s.pos
  if (!isIdentStart(s.peek())) return null
  s.next()
  while (isIdentChar(s.peek())) s.next()

  // Don't match keywords as identifiers
  const word = s.text.slice(start, s.pos)
  if (KEYWORDS[word] !== undefined) {
    s.pos = start
    return null
  }

  return new Elt(Type.Ident, start, s.pos)
}

// ===== Parenthesized expressions, arrays, dicts =====

function parseParenExpr(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.next() // consume (
  const children: Elt[] = [new Elt(Type.LeftParen, start, s.pos)]

  let itemCount = 0
  let hasColon = false
  let hasComma = false
  let hasArrow = false

  while (!s.done) {
    skipWhitespaceAndComments(s, children)
    if (s.peek() === Ch.RightParen) break
    if (s.done) break

    // Spread: ..expr
    if (s.peek() === Ch.Dot && s.peek(1) === Ch.Dot) {
      const spreadStart = s.pos
      s.next(); s.next()
      const dotsElt = new Elt(Type.Dots, spreadStart, s.pos)
      const expr = parseExpr(s, ctx, 0, false)
      if (expr) {
        children.push(new Elt(Type.Spread, spreadStart, s.pos, [dotsElt, expr]))
      } else {
        children.push(dotsElt)
      }
      itemCount++
    } else {
      // Parse an expression
      const expr = parseExpr(s, ctx, 0, false)
      if (expr) {
        skipWhitespaceAndComments(s)

        // Check for named argument: ident: value
        if (s.peek() === Ch.Colon && expr.type === Type.Ident) {
          const colonStart = s.pos
          s.next()
          const colonElt = new Elt(Type.Colon, colonStart, s.pos)
          skipWhitespaceAndComments(s)
          const value = parseExpr(s, ctx, 0, false)
          if (value) {
            children.push(new Elt(Type.Named, expr.from, s.pos, [expr, colonElt, value]))
          } else {
            children.push(expr)
            children.push(colonElt)
          }
          hasColon = true
        }
        // Check for keyed entry: "string": value (dict)
        else if (s.peek() === Ch.Colon && expr.type === Type.Str) {
          const colonStart = s.pos
          s.next()
          const colonElt = new Elt(Type.Colon, colonStart, s.pos)
          skipWhitespaceAndComments(s)
          const value = parseExpr(s, ctx, 0, false)
          if (value) {
            children.push(new Elt(Type.Keyed, expr.from, s.pos, [expr, colonElt, value]))
          } else {
            children.push(expr)
            children.push(colonElt)
          }
          hasColon = true
        }
        // Check for arrow (closure): => body
        else if (s.peek() === Ch.Eq && s.peek(1) === Ch.Gt) {
          // This is a closure
          hasArrow = true
          const arrowStart = s.pos
          s.next(); s.next()
          const arrowElt = new Elt(Type.Arrow, arrowStart, s.pos)
          skipWhitespaceAndComments(s)
          const body = parseExpr(s, ctx, 0, false)
          children.push(expr)
          children.push(arrowElt)
          if (body) children.push(body)
          break
        } else {
          children.push(expr)
        }
        itemCount++
      } else {
        // Error recovery
        const errStart = s.pos
        s.next()
        children.push(new Elt(Type.Error, errStart, s.pos))
      }
    }

    skipWhitespaceAndComments(s, children)

    // Comma
    if (s.peek() === Ch.Comma) {
      hasComma = true
      const commaPos = s.pos
      s.next()
      children.push(new Elt(Type.Comma, commaPos, s.pos))
    }
  }

  if (s.eat(Ch.RightParen)) {
    children.push(new Elt(Type.RightParen, s.pos - 1, s.pos))
  }

  // Determine type based on contents
  let type: number
  if (hasArrow) {
    type = Type.Closure
  } else if (hasColon) {
    type = Type.Dict
  } else if (hasComma || itemCount === 0) {
    type = itemCount === 1 && !hasComma ? Type.Parenthesized : Type.Array
  } else {
    type = Type.Parenthesized
  }

  return new Elt(type, start, s.pos, children)
}

// ===== Arguments (function call) =====

function parseArgs(s: Scanner, ctx: TypstParseContext): Elt | null {
  if (s.peek() !== Ch.LeftParen) return null
  const start = s.pos
  s.next() // consume (
  const children: Elt[] = [new Elt(Type.LeftParen, start, s.pos)]

  while (!s.done) {
    skipWhitespaceAndComments(s, children)
    if (s.peek() === Ch.RightParen) break
    if (s.done) break

    // Spread
    if (s.peek() === Ch.Dot && s.peek(1) === Ch.Dot) {
      const spreadStart = s.pos
      s.next(); s.next()
      const dotsElt = new Elt(Type.Dots, spreadStart, s.pos)
      const expr = parseExpr(s, ctx, 0, false)
      if (expr) {
        children.push(new Elt(Type.Spread, spreadStart, s.pos, [dotsElt, expr]))
      } else {
        children.push(dotsElt)
      }
    } else {
      const expr = parseExpr(s, ctx, 0, false)
      if (expr) {
        skipWhitespaceAndComments(s)
        // Named argument
        if (s.peek() === Ch.Colon && expr.type === Type.Ident) {
          const colonStart = s.pos
          s.next()
          skipWhitespaceAndComments(s)
          const value = parseExpr(s, ctx, 0, false)
          if (value) {
            children.push(new Elt(Type.Named, expr.from, s.pos, [expr, new Elt(Type.Colon, colonStart, colonStart + 1), value]))
          } else {
            children.push(expr)
          }
        } else {
          children.push(expr)
        }
      } else {
        const errStart = s.pos
        s.next()
        children.push(new Elt(Type.Error, errStart, s.pos))
      }
    }

    skipWhitespaceAndComments(s, children)
    if (s.peek() === Ch.Comma) {
      const commaPos = s.pos
      s.next()
      children.push(new Elt(Type.Comma, commaPos, s.pos))
    }
  }

  if (s.eat(Ch.RightParen)) {
    children.push(new Elt(Type.RightParen, s.pos - 1, s.pos))
  }

  return new Elt(Type.Args, start, s.pos, children)
}

// ===== Statements =====

function parseLetBinding(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 3 // consume "let"
  const children: Elt[] = [new Elt(Type.Let, start, s.pos)]

  skipWhitespaceAndComments(s)

  // Pattern: identifier or destructuring
  const ident = parseIdentifier(s)
  if (ident) {
    children.push(ident)

    skipWhitespaceAndComments(s)

    // Function shorthand: let name(params) = body
    if (s.peek() === Ch.LeftParen) {
      const params = parseParenExpr(s, ctx)
      children.push(new Elt(Type.Params, params.from, params.to, params.children))
    }

    skipWhitespaceAndComments(s)

    // = value
    if (s.peek() === Ch.Eq && s.peek(1) !== Ch.Eq && s.peek(1) !== Ch.Gt) {
      const eqPos = s.pos
      s.next()
      children.push(new Elt(Type.Eq, eqPos, s.pos))
      skipWhitespaceAndComments(s)
      const value = parseCodeExpr(s, ctx, false)
      if (value) children.push(value)
    }
  }

  return new Elt(Type.LetBinding, start, s.pos, children)
}

function parseSetRule(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 3 // consume "set"
  const children: Elt[] = [new Elt(Type.Set, start, s.pos)]

  skipWhitespaceAndComments(s)

  // Target expression (identifier, possibly with field access)
  const target = parseExpr(s, ctx, Prec.Postfix, false)
  if (target) children.push(target)

  // Optional "if" condition
  skipWhitespaceAndComments(s)
  if (peekWord(s) === "if") {
    const ifStart = s.pos
    s.pos += 2
    children.push(new Elt(Type.If, ifStart, s.pos))
    skipWhitespaceAndComments(s)
    const cond = parseExpr(s, ctx, 0, false)
    if (cond) children.push(cond)
  }

  return new Elt(Type.SetRule, start, s.pos, children)
}

function parseShowRule(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 4 // consume "show"
  const children: Elt[] = [new Elt(Type.Show, start, s.pos)]

  skipWhitespaceAndComments(s)

  // Optional selector (before the colon)
  if (s.peek() !== Ch.Colon) {
    const selector = parseExpr(s, ctx, 0, false)
    if (selector) children.push(selector)
  }

  skipWhitespaceAndComments(s)

  // Colon
  if (s.peek() === Ch.Colon) {
    const colonPos = s.pos
    s.next()
    children.push(new Elt(Type.Colon, colonPos, s.pos))

    skipWhitespaceAndComments(s)

    // Transform function/expression
    const transform = parseCodeExpr(s, ctx, false)
    if (transform) children.push(transform)
  }

  return new Elt(Type.ShowRule, start, s.pos, children)
}

function parseConditional(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 2 // consume "if"
  const children: Elt[] = [new Elt(Type.If, start, s.pos)]

  skipWhitespaceAndComments(s)

  // Condition
  const cond = parseExpr(s, ctx, 0, false)
  if (cond) children.push(cond)

  skipWhitespaceAndComments(s)

  // Body (code block or content block)
  const body = parseBlockBody(s, ctx)
  if (body) children.push(body)

  // Optional else
  skipWhitespaceAndComments(s)
  if (peekWord(s) === "else") {
    const elseStart = s.pos
    s.pos += 4
    children.push(new Elt(Type.Else, elseStart, s.pos))

    skipWhitespaceAndComments(s)

    // else if or else body
    if (peekWord(s) === "if") {
      const elseIf = parseConditional(s, ctx)
      children.push(elseIf)
    } else {
      const elseBody = parseBlockBody(s, ctx)
      if (elseBody) children.push(elseBody)
    }
  }

  return new Elt(Type.Conditional, start, s.pos, children)
}

function parseForLoop(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 3 // consume "for"
  const children: Elt[] = [new Elt(Type.For, start, s.pos)]

  skipWhitespaceAndComments(s)

  // Pattern
  const pattern = parseIdentifier(s)
  if (pattern) children.push(pattern)

  skipWhitespaceAndComments(s)

  // "in" keyword
  if (peekWord(s) === "in") {
    const inStart = s.pos
    s.pos += 2
    children.push(new Elt(Type.In, inStart, s.pos))
  }

  skipWhitespaceAndComments(s)

  // Iterable
  const iter = parseExpr(s, ctx, 0, false)
  if (iter) children.push(iter)

  skipWhitespaceAndComments(s)

  // Body
  const body = parseBlockBody(s, ctx)
  if (body) children.push(body)

  return new Elt(Type.ForLoop, start, s.pos, children)
}

function parseWhileLoop(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 5 // consume "while"
  const children: Elt[] = [new Elt(Type.While, start, s.pos)]

  skipWhitespaceAndComments(s)

  const cond = parseExpr(s, ctx, 0, false)
  if (cond) children.push(cond)

  skipWhitespaceAndComments(s)

  const body = parseBlockBody(s, ctx)
  if (body) children.push(body)

  return new Elt(Type.WhileLoop, start, s.pos, children)
}

function parseImport(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 6 // consume "import"
  const children: Elt[] = [new Elt(Type.Import, start, s.pos)]

  skipWhitespaceAndComments(s)

  // Source (string or expression)
  const source = parseExpr(s, ctx, 0, false)
  if (source) children.push(source)

  skipWhitespaceAndComments(s)

  // Optional ": items" or "as name"
  if (s.peek() === Ch.Colon) {
    const colonPos = s.pos
    s.next()
    children.push(new Elt(Type.Colon, colonPos, s.pos))

    skipWhitespaceAndComments(s)

    // Import items: ident, ident as alias, *
    while (!s.done) {
      skipWhitespaceAndComments(s)
      if (s.peek() === Ch.Star) {
        const starPos = s.pos
        s.next()
        children.push(new Elt(Type.Star, starPos, s.pos))
        break
      }
      const item = parseIdentifier(s)
      if (item) {
        children.push(item)
        skipWhitespaceAndComments(s)
        if (peekWord(s) === "as") {
          const asStart = s.pos
          s.pos += 2
          children.push(new Elt(Type.As, asStart, s.pos))
          skipWhitespaceAndComments(s)
          const alias = parseIdentifier(s)
          if (alias) children.push(alias)
        }
      }
      skipWhitespaceAndComments(s)
      if (s.peek() === Ch.Comma) {
        const commaPos = s.pos
        s.next()
        children.push(new Elt(Type.Comma, commaPos, s.pos))
      } else {
        break
      }
    }
  } else if (peekWord(s) === "as") {
    const asStart = s.pos
    s.pos += 2
    children.push(new Elt(Type.As, asStart, s.pos))
    skipWhitespaceAndComments(s)
    const alias = parseIdentifier(s)
    if (alias) children.push(alias)
  }

  return new Elt(Type.ModuleImport, start, s.pos, children)
}

function parseInclude(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 7 // consume "include"
  const children: Elt[] = [new Elt(Type.Include, start, s.pos)]

  skipWhitespaceAndComments(s)

  const source = parseExpr(s, ctx, 0, false)
  if (source) children.push(source)

  return new Elt(Type.ModuleInclude, start, s.pos, children)
}

function parseReturn(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 6 // consume "return"
  const children: Elt[] = [new Elt(Type.Return, start, s.pos)]

  skipWhitespaceAndComments(s)

  // Optional return value
  const ch = s.peek()
  if (!s.done && ch !== Ch.Semicolon && ch !== Ch.RightBrace && ch !== Ch.RightBracket && ch !== Ch.RightParen && !isNewline(ch)) {
    const value = parseExpr(s, ctx, 0, false)
    if (value) children.push(value)
  }

  return new Elt(Type.FuncReturn, start, s.pos, children)
}

function parseBreakContinue(s: Scanner, kwType: number, nodeType: number): Elt {
  const start = s.pos
  const word = peekWord(s)
  s.pos += word.length
  return new Elt(nodeType, start, s.pos, [new Elt(kwType, start, s.pos)])
}

function parseContextExpr(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.pos += 7 // consume "context"
  const children: Elt[] = [new Elt(Type.Context, start, s.pos)]

  skipWhitespaceAndComments(s)

  const expr = parseCodeExpr(s, ctx, false)
  if (expr) children.push(expr)

  return new Elt(Type.ContextExpr, start, s.pos, children)
}

// ===== Helpers =====

function parseBlockBody(s: Scanner, ctx: TypstParseContext): Elt | null {
  if (s.peek() === Ch.LeftBrace) return parseCodeBlock(s, ctx)
  if (s.peek() === Ch.LeftBracket) return parseContentBlock(s, ctx)
  return null
}

function skipWhitespaceAndComments(s: Scanner, elts?: Elt[]) {
  while (!s.done) {
    const ch = s.peek()
    if (isWhitespace(ch)) {
      const start = s.pos
      s.eatWhile(isWhitespace)
      // Don't emit whitespace elements in code - they're trivia
      continue
    }
    if (ch === Ch.Slash && s.peek(1) === Ch.Slash) {
      const elt = parseLineComment(s)
      if (elts) elts.push(elt)
      continue
    }
    if (ch === Ch.Slash && s.peek(1) === Ch.Star) {
      const elt = parseBlockComment(s)
      if (elts) elts.push(elt)
      continue
    }
    break
  }
}

/// Peek at the word (identifier-like) starting at current position.
function peekWord(s: Scanner): string {
  let i = s.pos
  if (i >= s.text.length) return ""
  const ch = s.text.charCodeAt(i)
  if (!isAlpha(ch) && ch !== Ch.Underscore) return ""
  i++
  while (i < s.text.length && isIdentChar(s.text.charCodeAt(i))) i++
  return s.text.slice(s.pos, i)
}
