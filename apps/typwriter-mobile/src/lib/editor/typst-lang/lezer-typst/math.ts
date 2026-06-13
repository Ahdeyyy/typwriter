import { Type } from "./types"
import { Elt, TypstParseContext } from "./parser"
import { Scanner, Ch, isAlpha, isDigit, isIdentChar, isNewline, isWhitespace, isLineWhitespace } from "./scanner"
import { parseCodeExpr } from "./code"
import { parseLineComment, parseBlockComment } from "./markup"

/// Math shorthands: multi-character operator sequences recognised in math mode.
const MATH_SHORTHANDS = [
  "<==", "==>", "<=>", "-->", "<--", "<->",
  "!=", "<<", ">>", "<=", ">=", "->", "<-", "=>", "|->", "|-", "-|",
  "...", "~~", "~",
]

/// Parse math content (inside $...$). Returns child elements.
export function parseMathContent(s: Scanner, ctx: TypstParseContext): Elt[] {
  const elts: Elt[] = []

  while (!s.done && s.peek() !== Ch.Dollar) {
    const ch = s.peek()
    const pos = s.pos

    // Whitespace
    if (isWhitespace(ch)) {
      const start = s.pos
      s.next()
      s.eatWhile(isWhitespace)
      elts.push(new Elt(Type.Space, start, s.pos))
      continue
    }

    // Line comment
    if (ch === Ch.Slash && s.peek(1) === Ch.Slash) {
      elts.push(parseLineComment(s))
      continue
    }

    // Block comment
    if (ch === Ch.Slash && s.peek(1) === Ch.Star) {
      elts.push(parseBlockComment(s))
      continue
    }

    // Embedded code: #
    if (ch === Ch.Hash) {
      const elt = parseMathEmbeddedCode(s, ctx)
      if (elt) { elts.push(elt); continue }
      s.next()
      elts.push(new Elt(Type.MathText, pos, s.pos))
      continue
    }

    // Alignment point: &
    if (ch === Ch.Ampersand) {
      s.next()
      elts.push(new Elt(Type.MathAlignPoint, pos, s.pos))
      continue
    }

    // Math shorthands (multi-character operators)
    const shorthand = tryMathShorthand(s)
    if (shorthand) {
      elts.push(shorthand)
      continue
    }

    // Delimited groups: (...), [...], {...}, |...|
    if (ch === Ch.LeftParen || ch === Ch.LeftBracket || ch === Ch.LeftBrace) {
      const elt = parseMathDelimited(s, ctx, ch)
      if (elt) { elts.push(elt); continue }
    }

    // Math identifier (multi-letter)
    if (isAlpha(ch) || ch > 127) {
      const elt = parseMathIdentOrCall(s, ctx)
      elts.push(elt)
      continue
    }

    // Digits
    if (isDigit(ch)) {
      const start = s.pos
      s.eatWhile(isDigit)
      if (s.peek() === Ch.Dot && isDigit(s.peek(1))) {
        s.next()
        s.eatWhile(isDigit)
      }
      elts.push(new Elt(Type.MathText, start, s.pos))
      continue
    }

    // Superscript ^
    if (ch === Ch.Hat) {
      s.next()
      const opElt = new Elt(Type.Hat, pos, s.pos)
      // Parse the attached expression
      const attached = parseMathAtom(s, ctx)
      if (attached) {
        elts.push(new Elt(Type.MathAttach, pos, s.pos, [opElt, attached]))
      } else {
        elts.push(opElt)
      }
      continue
    }

    // Subscript _
    if (ch === Ch.Underscore) {
      s.next()
      const opElt = new Elt(Type.Underscore, pos, s.pos)
      const attached = parseMathAtom(s, ctx)
      if (attached) {
        elts.push(new Elt(Type.MathAttach, pos, s.pos, [opElt, attached]))
      } else {
        elts.push(opElt)
      }
      continue
    }

    // Fraction /
    if (ch === Ch.Slash) {
      s.next()
      elts.push(new Elt(Type.Slash, pos, s.pos))
      continue
    }

    // Primes '
    if (ch === Ch.SingleQuote) {
      const start = s.pos
      while (s.eat(Ch.SingleQuote)) {}
      elts.push(new Elt(Type.MathPrimes, start, s.pos))
      continue
    }

    // Root symbol: √ (U+221A), ∛ (U+221B), ∜ (U+221C)
    const codePoint = s.text.codePointAt(s.pos)
    if (codePoint === 0x221A || codePoint === 0x221B || codePoint === 0x221C) {
      const start = s.pos
      s.pos += codePoint > 0xFFFF ? 2 : 1
      const rootSym = new Elt(Type.MathText, start, s.pos)
      const arg = parseMathAtom(s, ctx)
      if (arg) {
        elts.push(new Elt(Type.MathRoot, start, s.pos, [rootSym, arg]))
      } else {
        elts.push(rootSym)
      }
      continue
    }

    // Everything else: single character as MathText
    s.next()
    elts.push(new Elt(Type.MathText, pos, s.pos))
  }

  return elts
}

function parseMathEmbeddedCode(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  s.next() // consume #

  const ch = s.peek()
  if (!isAlpha(ch) && ch !== Ch.Underscore && ch !== Ch.LeftBrace && ch !== Ch.LeftBracket && ch !== Ch.LeftParen && ch > 127 === false) {
    s.pos = start
    return null
  }

  const children: Elt[] = [new Elt(Type.Hash, start, start + 1)]
  const codeElt = parseCodeExpr(s, ctx, true)
  if (codeElt) children.push(codeElt)

  return children.length > 1
    ? new Elt(children[children.length - 1].type, start, s.pos, children)
    : null
}

function tryMathShorthand(s: Scanner): Elt | null {
  const remaining = s.text.slice(s.pos)
  for (const sh of MATH_SHORTHANDS) {
    if (remaining.startsWith(sh)) {
      const start = s.pos
      s.pos += sh.length
      return new Elt(Type.MathShorthand, start, s.pos)
    }
  }
  return null
}

function parseMathDelimited(s: Scanner, ctx: TypstParseContext, openCh: number): Elt | null {
  const start = s.pos
  const closeCh = openCh === Ch.LeftParen ? Ch.RightParen
    : openCh === Ch.LeftBracket ? Ch.RightBracket
    : Ch.RightBrace

  s.next() // consume open
  const children: Elt[] = [new Elt(Type.MathText, start, s.pos)]

  // Parse inner content until close
  while (!s.done && s.peek() !== closeCh && s.peek() !== Ch.Dollar) {
    const ch = s.peek()
    const pos = s.pos

    if (isWhitespace(ch)) {
      s.next()
      s.eatWhile(isWhitespace)
      children.push(new Elt(Type.Space, pos, s.pos))
      continue
    }

    // Nested delimiters
    if (ch === Ch.LeftParen || ch === Ch.LeftBracket || ch === Ch.LeftBrace) {
      const nested = parseMathDelimited(s, ctx, ch)
      if (nested) { children.push(nested); continue }
    }

    // Embedded code
    if (ch === Ch.Hash) {
      const elt = parseMathEmbeddedCode(s, ctx)
      if (elt) { children.push(elt); continue }
    }

    // Comma separator in args
    if (ch === Ch.Comma || ch === Ch.Semicolon) {
      s.next()
      children.push(new Elt(ch === Ch.Comma ? Type.Comma : Type.Semicolon, pos, s.pos))
      continue
    }

    // Math identifier/call
    if (isAlpha(ch) || ch > 127) {
      children.push(parseMathIdentOrCall(s, ctx))
      continue
    }

    // Everything else
    s.next()
    children.push(new Elt(Type.MathText, pos, s.pos))
  }

  if (s.peek() === closeCh) {
    const closeStart = s.pos
    s.next()
    children.push(new Elt(Type.MathText, closeStart, s.pos))
  }

  return new Elt(Type.MathDelimited, start, s.pos, children)
}

function parseMathIdentOrCall(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos

  // Consume identifier
  while (!s.done && (isAlpha(s.peek()) || isDigit(s.peek()) || s.peek() > 127)) {
    s.next()
  }

  // Check for field access
  while (s.peek() === Ch.Dot && (isAlpha(s.peek(1)) || s.peek(1) > 127)) {
    s.next() // consume dot
    while (!s.done && (isAlpha(s.peek()) || isDigit(s.peek()) || s.peek() > 127)) {
      s.next()
    }
  }

  const identEnd = s.pos

  // Check for function call
  if (s.peek() === Ch.LeftParen) {
    const argsElt = parseMathDelimited(s, ctx, Ch.LeftParen)
    const children: Elt[] = [new Elt(Type.MathIdent, start, identEnd)]
    if (argsElt) {
      children.push(new Elt(Type.MathArgs, argsElt.from, argsElt.to, argsElt.children))
    }
    return new Elt(Type.MathCall, start, s.pos, children)
  }

  return new Elt(Type.MathIdent, start, identEnd)
}

/// Parse a single math atom (for attach targets, root args, etc.)
function parseMathAtom(s: Scanner, ctx: TypstParseContext): Elt | null {
  s.eatWhile(isLineWhitespace)

  const ch = s.peek()
  if (ch === Ch.EOF || ch === Ch.Dollar) return null

  const pos = s.pos

  // Delimited group
  if (ch === Ch.LeftParen || ch === Ch.LeftBracket || ch === Ch.LeftBrace) {
    return parseMathDelimited(s, ctx, ch)
  }

  // Identifier
  if (isAlpha(ch) || ch > 127) {
    return parseMathIdentOrCall(s, ctx)
  }

  // Digit
  if (isDigit(ch)) {
    s.eatWhile(isDigit)
    return new Elt(Type.MathText, pos, s.pos)
  }

  // Embedded code
  if (ch === Ch.Hash) {
    return parseMathEmbeddedCode(s, ctx)
  }

  // Single character
  s.next()
  return new Elt(Type.MathText, pos, s.pos)
}
