import { Type } from "./types"
import { Elt, TypstParseContext } from "./parser"
import { Scanner, Ch, isAlpha, isDigit, isIdentStart, isIdentChar, isNewline, isLineWhitespace, isWhitespace } from "./scanner"
import { parseMathContent } from "./math"
import { parseCodeExpr, parseCodeBlock } from "./code"

/// Parse top-level markup content. Returns a list of elements that
/// become children of the Document node.
export function parseMarkup(ctx: TypstParseContext): Elt[] {
  return parseMarkupContent(ctx.scanner, ctx, Ch.EOF, false)
}

/// Parse markup content until the given closing character or EOF.
/// `inContentBlock` is true when parsing inside `[...]`.
export function parseMarkupContent(
  s: Scanner,
  ctx: TypstParseContext,
  closeChar: number,
  inContentBlock: boolean,
): Elt[] {
  const elts: Elt[] = []
  let textFrom = -1

  function flushText() {
    if (textFrom >= 0 && textFrom < s.pos) {
      elts.push(new Elt(Type.Text, textFrom, s.pos))
      textFrom = -1
    }
  }

  function startText() {
    if (textFrom < 0) textFrom = s.pos
  }

  // Track whether we're at the start of a line (for headings, lists, etc.)
  let atLineStart = true
  let lineIndent = 0

  while (!s.done) {
    // Check for close delimiter
    if (closeChar !== Ch.EOF && s.peek() === closeChar) {
      flushText()
      break
    }

    const ch = s.peek()
    const pos = s.pos

    // Paragraph break: two+ newlines in a row
    if (isNewline(ch)) {
      flushText()
      const start = s.pos
      s.next()
      if (ch === Ch.CarriageReturn) s.eat(Ch.Newline)

      // Check for paragraph break (blank line)
      let blankCount = 0
      const savedPos = s.pos
      let isParbreak = false
      // Skip whitespace-only lines
      while (!s.done) {
        const lineStart = s.pos
        s.eatWhile(isLineWhitespace)
        if (isNewline(s.peek())) {
          s.next()
          if (s.peek() === Ch.Newline && s.text.charCodeAt(s.pos - 1) === Ch.CarriageReturn) s.next()
          isParbreak = true
        } else {
          s.pos = lineStart
          break
        }
      }

      if (isParbreak) {
        elts.push(new Elt(Type.Parbreak, start, s.pos))
      } else {
        elts.push(new Elt(Type.Space, start, s.pos))
      }

      atLineStart = true
      lineIndent = 0
      // Count indent on new line
      const indentStart = s.pos
      s.eatWhile(isLineWhitespace)
      lineIndent = s.pos - indentStart
      if (s.pos > indentStart && !isNewline(s.peek()) && !s.done) {
        // The whitespace before content is space
        elts.push(new Elt(Type.Space, indentStart, s.pos))
      }
      continue
    }

    // Spaces (non-newline)
    if (isLineWhitespace(ch)) {
      flushText()
      const start = s.pos
      s.eatWhile(isLineWhitespace)
      elts.push(new Elt(Type.Space, start, s.pos))
      continue
    }

    // Line-start constructs
    if (atLineStart) {
      atLineStart = false

      // Heading: = at line start
      if (ch === Ch.Eq) {
        flushText()
        const elt = parseHeading(s, ctx)
        if (elt) { elts.push(elt); continue }
      }

      // Bullet list: - followed by space
      if (ch === Ch.Minus && isLineWhitespace(s.peek(1))) {
        flushText()
        const elt = parseListItem(s, ctx)
        if (elt) { elts.push(elt); continue }
      }

      // Numbered list: + followed by space, or digit(s). followed by space
      if (ch === Ch.Plus && isLineWhitespace(s.peek(1))) {
        flushText()
        const elt = parseEnumItem(s, ctx, false)
        if (elt) { elts.push(elt); continue }
      }
      if (isDigit(ch)) {
        const elt = tryParseEnumItemNumbered(s, ctx)
        if (elt) { flushText(); elts.push(elt); continue }
      }

      // Term list: / followed by space
      if (ch === Ch.Slash && isLineWhitespace(s.peek(1))) {
        flushText()
        const elt = parseTermItem(s, ctx)
        if (elt) { elts.push(elt); continue }
      }
    }

    atLineStart = false

    // Strong: *...*
    if (ch === Ch.Star) {
      flushText()
      const elt = parseStrong(s, ctx)
      if (elt) { elts.push(elt); continue }
      // Fallthrough: treat as text
      startText()
      s.next()
      continue
    }

    // Emphasis: _..._
    if (ch === Ch.Underscore) {
      flushText()
      const elt = parseEmph(s, ctx)
      if (elt) { elts.push(elt); continue }
      startText()
      s.next()
      continue
    }

    // Raw text: ` (backticks)
    if (ch === Ch.Backtick) {
      flushText()
      const elt = parseRaw(s)
      if (elt) { elts.push(elt); continue }
      startText()
      s.next()
      continue
    }

    // Equation: $
    if (ch === Ch.Dollar) {
      flushText()
      const elt = parseEquation(s, ctx)
      elts.push(elt)
      continue
    }

    // Embedded code: #
    if (ch === Ch.Hash) {
      flushText()
      const elt = parseEmbeddedCode(s, ctx)
      if (elt) { elts.push(elt); continue }
      startText()
      s.next()
      continue
    }

    // Escape: \ followed by special char or unicode
    if (ch === Ch.Backslash) {
      flushText()
      const elt = parseEscape(s)
      if (elt) { elts.push(elt); continue }
      // Just a linebreak if followed by newline
      if (isNewline(s.peek(1))) {
        const start = s.pos
        s.next() // consume backslash
        s.next() // consume newline
        if (s.peek() === Ch.Newline && s.text.charCodeAt(s.pos - 1) === Ch.CarriageReturn) s.next()
        elts.push(new Elt(Type.Linebreak, start, s.pos))
        atLineStart = true
        continue
      }
      startText()
      s.next()
      continue
    }

    // Label: <name>
    if (ch === Ch.Lt) {
      flushText()
      const elt = parseLabel(s)
      if (elt) { elts.push(elt); continue }
      startText()
      s.next()
      continue
    }

    // Reference: @name
    if (ch === Ch.At) {
      flushText()
      const elt = parseRef(s, ctx)
      if (elt) { elts.push(elt); continue }
      startText()
      s.next()
      continue
    }

    // Shorthand: ~, ---, --, -?, ...
    if (ch === Ch.Tilde) {
      flushText()
      s.next()
      elts.push(new Elt(Type.Shorthand, pos, s.pos))
      continue
    }
    if (ch === Ch.Minus) {
      // Check for --- (em-dash), -- (en-dash), -? (soft hyphen)
      if (s.peek(1) === Ch.Minus) {
        flushText()
        s.next(); s.next()
        if (s.eat(Ch.Minus)) {} // em dash: ---
        elts.push(new Elt(Type.Shorthand, pos, s.pos))
        continue
      }
      if (s.peek(1) === 63 /* ? */) {
        flushText()
        s.next(); s.next()
        elts.push(new Elt(Type.Shorthand, pos, s.pos))
        continue
      }
    }
    if (ch === Ch.Dot && s.peek(1) === Ch.Dot && s.peek(2) === Ch.Dot) {
      flushText()
      s.next(); s.next(); s.next()
      elts.push(new Elt(Type.Shorthand, pos, s.pos))
      continue
    }

    // Smart quotes: ' and "
    if (ch === Ch.SingleQuote || ch === Ch.DoubleQuote) {
      flushText()
      s.next()
      elts.push(new Elt(Type.SmartQuote, pos, s.pos))
      continue
    }

    // Link: auto-detect http:// or https://
    if (ch === Ch.h || ch === 104) { // 'h'
      const elt = tryParseLink(s)
      if (elt) { flushText(); elts.push(elt); continue }
    }

    // Line comment: //
    if (ch === Ch.Slash && s.peek(1) === Ch.Slash) {
      flushText()
      const elt = parseLineComment(s)
      elts.push(elt)
      continue
    }

    // Block comment: /* ... */
    if (ch === Ch.Slash && s.peek(1) === Ch.Star) {
      flushText()
      const elt = parseBlockComment(s)
      elts.push(elt)
      continue
    }

    // Default: accumulate as text
    startText()
    s.next()
  }

  flushText()
  return elts
}

// === Heading ===

function parseHeading(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  let level = 0
  while (s.peek() === Ch.Eq) { s.next(); level++ }
  // Must be followed by space or newline
  if (!isLineWhitespace(s.peek()) && !isNewline(s.peek()) && !s.done) {
    s.pos = start
    return null
  }

  const markerEnd = s.pos
  const children: Elt[] = [new Elt(Type.HeadingMarker, start, markerEnd)]

  // Skip space after marker
  s.eatWhile(isLineWhitespace)

  // Parse content until end of line
  const content = parseMarkupUntilNewline(s, ctx)
  children.push(...content)

  return new Elt(Type.Heading, start, s.pos, children)
}

// === List items ===

function parseListItem(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  s.next() // consume -
  const markerEnd = s.pos
  const children: Elt[] = [new Elt(Type.ListMarker, start, markerEnd)]

  s.eatWhile(isLineWhitespace)

  const content = parseMarkupUntilNewline(s, ctx)
  children.push(...content)

  return new Elt(Type.ListItem, start, s.pos, children)
}

function parseEnumItem(s: Scanner, ctx: TypstParseContext, isNumbered: boolean): Elt | null {
  const start = s.pos
  if (isNumbered) {
    s.eatWhile(isDigit)
    s.eat(Ch.Dot)
  } else {
    s.next() // consume +
  }
  const markerEnd = s.pos
  const children: Elt[] = [new Elt(Type.EnumMarker, start, markerEnd)]

  s.eatWhile(isLineWhitespace)

  const content = parseMarkupUntilNewline(s, ctx)
  children.push(...content)

  return new Elt(Type.EnumItem, start, s.pos, children)
}

function tryParseEnumItemNumbered(s: Scanner, ctx: TypstParseContext): Elt | null {
  // Look ahead for digits followed by . and space
  let i = 0
  while (isDigit(s.peek(i))) i++
  if (i === 0 || s.peek(i) !== Ch.Dot || !isLineWhitespace(s.peek(i + 1))) return null
  return parseEnumItem(s, ctx, true)
}

function parseTermItem(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  s.next() // consume /
  const markerEnd = s.pos
  const children: Elt[] = [new Elt(Type.TermMarker, start, markerEnd)]

  s.eatWhile(isLineWhitespace)

  // Parse until : then rest of line
  const content = parseMarkupUntilNewline(s, ctx)
  children.push(...content)

  return new Elt(Type.TermItem, start, s.pos, children)
}

// === Strong and Emphasis ===

function parseStrong(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  s.next() // consume *

  const children: Elt[] = [new Elt(Type.StrongMarker, start, s.pos)]

  // Parse until matching *
  const inner = parseMarkupContent(s, ctx, Ch.Star, false)
  children.push(...inner)

  if (s.eat(Ch.Star)) {
    children.push(new Elt(Type.StrongMarker, s.pos - 1, s.pos))
    return new Elt(Type.Strong, start, s.pos, children)
  }

  // Unclosed - return null and let caller treat * as text
  s.pos = start
  return null
}

function parseEmph(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  s.next() // consume _

  const children: Elt[] = [new Elt(Type.EmphMarker, start, s.pos)]

  const inner = parseMarkupContent(s, ctx, Ch.Underscore, false)
  children.push(...inner)

  if (s.eat(Ch.Underscore)) {
    children.push(new Elt(Type.EmphMarker, s.pos - 1, s.pos))
    return new Elt(Type.Emph, start, s.pos, children)
  }

  s.pos = start
  return null
}

// === Raw text / code blocks ===

export function parseRaw(s: Scanner): Elt | null {
  const start = s.pos
  let backtickCount = 0
  while (s.peek() === Ch.Backtick) { s.next(); backtickCount++ }

  if (backtickCount === 2) {
    // Two backticks: empty inline raw
    const children: Elt[] = [
      new Elt(Type.RawDelim, start, start + 1),
      new Elt(Type.RawDelim, start + 1, start + 2),
    ]
    return new Elt(Type.Raw, start, s.pos, children)
  }

  const isBlock = backtickCount >= 3
  const delimEnd = s.pos
  const children: Elt[] = [new Elt(Type.RawDelim, start, delimEnd)]

  if (isBlock) {
    // Optional language tag (until whitespace or backtick)
    const langStart = s.pos
    while (!s.done && !isWhitespace(s.peek()) && s.peek() !== Ch.Backtick) s.next()
    if (s.pos > langStart) {
      children.push(new Elt(Type.RawLang, langStart, s.pos))
    }

    // Skip rest of first line
    s.eatWhile(isLineWhitespace)
    if (isNewline(s.peek())) {
      s.next()
      if (s.peek(-1) === Ch.CarriageReturn && s.peek() === Ch.Newline) s.next()
    }

    // Find closing delimiter: same number of backticks at start of line (or more)
    const codeStart = s.pos
    let codeEnd = s.pos
    let foundClose = false

    while (!s.done) {
      // Check for closing backticks
      let btCount = 0
      const linePos = s.pos
      while (s.peek() === Ch.Backtick) { s.next(); btCount++ }
      if (btCount >= backtickCount) {
        codeEnd = linePos
        foundClose = true
        break
      }
      // If we consumed some backticks but not enough, they're content
      // Skip to end of line
      while (!s.done && !isNewline(s.peek())) s.next()
      if (!s.done) {
        s.next()
        if (s.peek(-1) === Ch.CarriageReturn && s.peek() === Ch.Newline) s.next()
      }
    }

    if (codeEnd > codeStart) {
      children.push(new Elt(Type.RawCode, codeStart, codeEnd))
    }

    if (foundClose) {
      children.push(new Elt(Type.RawDelim, codeEnd, s.pos))
    }
  } else {
    // Inline raw: single backtick, find matching close
    const codeStart = s.pos
    let foundClose = false
    while (!s.done) {
      if (s.peek() === Ch.Backtick) {
        const codeEnd = s.pos
        s.next()
        if (codeEnd > codeStart) {
          children.push(new Elt(Type.RawCode, codeStart, codeEnd))
        }
        children.push(new Elt(Type.RawDelim, codeEnd, s.pos))
        foundClose = true
        break
      }
      s.next()
    }

    if (!foundClose) {
      // Unclosed inline raw - treat everything as code
      if (s.pos > codeStart) {
        children.push(new Elt(Type.RawCode, codeStart, s.pos))
      }
    }
  }

  return new Elt(Type.Raw, start, s.pos, children)
}

// === Equation (math mode) ===

function parseEquation(s: Scanner, ctx: TypstParseContext): Elt {
  const start = s.pos
  s.next() // consume $
  const children: Elt[] = [new Elt(Type.Dollar, start, s.pos)]

  // Determine if block or inline math
  // Block math: $ followed by space/newline, content, then $ preceded by space/newline
  // For simplicity: parse until matching $
  const mathElts = parseMathContent(s, ctx)
  children.push(...mathElts)

  if (s.eat(Ch.Dollar)) {
    children.push(new Elt(Type.Dollar, s.pos - 1, s.pos))
  }

  return new Elt(Type.Equation, start, s.pos, children)
}

// === Embedded code ===

function parseEmbeddedCode(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  s.next() // consume #

  const ch = s.peek()

  // # must be followed by an identifier start, keyword, or opening brace/bracket/paren
  if (!isIdentStart(ch) && ch !== Ch.LeftBrace && ch !== Ch.LeftBracket && ch !== Ch.LeftParen) {
    s.pos = start
    return null
  }

  const hashElt = new Elt(Type.Hash, start, start + 1)
  const codeElt = parseCodeExpr(s, ctx, true)
  if (!codeElt) return null

  // Merge the Hash into the code expression's children.
  // This gives us e.g. LetBinding(Hash, Let, Ident, ...) instead of
  // LetBinding(Hash, LetBinding(Let, Ident, ...)).
  return new Elt(codeElt.type, start, codeElt.to, [hashElt, ...codeElt.children])
}

// === Escape sequences ===

function parseEscape(s: Scanner): Elt | null {
  if (s.peek() !== Ch.Backslash) return null
  const start = s.pos
  s.next() // consume backslash

  const ch = s.peek()

  // Unicode escape: \u{hex}
  if (ch === Ch.u && s.peek(1) === Ch.LeftBrace) {
    s.next() // u
    s.next() // {
    while (!s.done && s.peek() !== Ch.RightBrace) s.next()
    s.eat(Ch.RightBrace)
    return new Elt(Type.Escape, start, s.pos)
  }

  // Any special character escape (but not newlines - those are linebreaks)
  if (!s.done && !isAlpha(s.peek()) && !isDigit(s.peek()) && !isNewline(s.peek())) {
    s.next()
    return new Elt(Type.Escape, start, s.pos)
  }

  s.pos = start
  return null
}

// === Label: <name> ===

function parseLabel(s: Scanner): Elt | null {
  const start = s.pos
  s.next() // consume <

  // Label name: letters, digits, hyphens, underscores, dots, colons
  const nameStart = s.pos
  while (!s.done && s.peek() !== Ch.Gt && !isWhitespace(s.peek())) {
    s.next()
  }

  if (s.pos === nameStart || !s.eat(Ch.Gt)) {
    s.pos = start
    return null
  }

  return new Elt(Type.Label, start, s.pos)
}

// === Reference: @name ===

function parseRef(s: Scanner, ctx: TypstParseContext): Elt | null {
  const start = s.pos
  s.next() // consume @

  const nameStart = s.pos
  while (!s.done && (isIdentChar(s.peek()) || s.peek() === Ch.Dot || s.peek() === Ch.Colon)) {
    s.next()
  }

  if (s.pos === nameStart) {
    s.pos = start
    return null
  }

  const children: Elt[] = [new Elt(Type.RefMarker, start, start + 1)]

  // Optional content block: @ref[supplement]
  if (s.peek() === Ch.LeftBracket) {
    const cbElts = parseContentBlock(s, ctx)
    if (cbElts) children.push(cbElts)
  }

  return new Elt(Type.Ref, start, s.pos, children)
}

// === Link auto-detection ===

function tryParseLink(s: Scanner): Elt | null {
  // Check for http:// or https://
  const start = s.pos
  let protocol = ""
  if (s.eatString("https://")) {
    protocol = "https://"
  } else if (s.eatString("http://")) {
    protocol = "http://"
  } else {
    return null
  }

  // Consume URL characters (everything except whitespace and certain punctuation at end)
  const urlStart = s.pos
  let depth = 0 // bracket balancing
  while (!s.done) {
    const ch = s.peek()
    if (isWhitespace(ch)) break
    if (ch === Ch.LeftParen) depth++
    else if (ch === Ch.RightParen) {
      if (depth === 0) break
      depth--
    }
    // Stop at certain trailing punctuation
    if (ch === Ch.Gt && depth === 0) break
    s.next()
  }

  // Trim trailing punctuation
  while (s.pos > urlStart) {
    const last = s.text.charCodeAt(s.pos - 1)
    if (last === Ch.Dot || last === Ch.Comma || last === Ch.Semicolon || last === Ch.Colon || last === Ch.Bang) {
      s.pos--
    } else {
      break
    }
  }

  if (s.pos === urlStart) {
    s.pos = start
    return null
  }

  return new Elt(Type.Link, start, s.pos)
}

// === Content block [...]  ===

export function parseContentBlock(s: Scanner, ctx: TypstParseContext): Elt | null {
  if (s.peek() !== Ch.LeftBracket) return null
  const start = s.pos
  s.next() // consume [

  const children: Elt[] = [new Elt(Type.LeftBracket, start, s.pos)]

  const inner = parseMarkupContent(s, ctx, Ch.RightBracket, true)
  children.push(...inner)

  if (s.eat(Ch.RightBracket)) {
    children.push(new Elt(Type.RightBracket, s.pos - 1, s.pos))
  }

  return new Elt(Type.ContentBlock, start, s.pos, children)
}

// === Comments ===

export function parseLineComment(s: Scanner): Elt {
  const start = s.pos
  s.next(); s.next() // consume //
  while (!s.done && !isNewline(s.peek())) s.next()
  return new Elt(Type.LineComment, start, s.pos)
}

export function parseBlockComment(s: Scanner): Elt {
  const start = s.pos
  s.next(); s.next() // consume /*
  let depth = 1
  while (!s.done && depth > 0) {
    if (s.peek() === Ch.Slash && s.peek(1) === Ch.Star) {
      s.next(); s.next()
      depth++
    } else if (s.peek() === Ch.Star && s.peek(1) === Ch.Slash) {
      s.next(); s.next()
      depth--
    } else {
      s.next()
    }
  }
  return new Elt(Type.BlockComment, start, s.pos)
}

// === Helper: parse markup until end of line ===

function parseMarkupUntilNewline(s: Scanner, ctx: TypstParseContext): Elt[] {
  const elts: Elt[] = []
  let textFrom = -1

  function flushText() {
    if (textFrom >= 0 && textFrom < s.pos) {
      elts.push(new Elt(Type.Text, textFrom, s.pos))
      textFrom = -1
    }
  }

  while (!s.done && !isNewline(s.peek())) {
    const ch = s.peek()
    const pos = s.pos

    if (isLineWhitespace(ch)) {
      flushText()
      const start = s.pos
      s.eatWhile(isLineWhitespace)
      elts.push(new Elt(Type.Space, start, s.pos))
      continue
    }

    // Support inline constructs within line content
    if (ch === Ch.Star) {
      flushText()
      const elt = parseStrong(s, ctx)
      if (elt) { elts.push(elt); continue }
      if (textFrom < 0) textFrom = s.pos
      s.next()
      continue
    }

    if (ch === Ch.Underscore) {
      flushText()
      const elt = parseEmph(s, ctx)
      if (elt) { elts.push(elt); continue }
      if (textFrom < 0) textFrom = s.pos
      s.next()
      continue
    }

    if (ch === Ch.Backtick) {
      flushText()
      const elt = parseRaw(s)
      if (elt) { elts.push(elt); continue }
      if (textFrom < 0) textFrom = s.pos
      s.next()
      continue
    }

    if (ch === Ch.Dollar) {
      flushText()
      elts.push(parseEquation(s, ctx))
      continue
    }

    if (ch === Ch.Hash) {
      flushText()
      const elt = parseEmbeddedCode(s, ctx)
      if (elt) { elts.push(elt); continue }
      if (textFrom < 0) textFrom = s.pos
      s.next()
      continue
    }

    if (ch === Ch.Backslash) {
      flushText()
      const elt = parseEscape(s)
      if (elt) { elts.push(elt); continue }
      // Linebreak at \<newline>
      if (isNewline(s.peek(1))) break
      if (textFrom < 0) textFrom = s.pos
      s.next()
      continue
    }

    if (ch === Ch.At) {
      flushText()
      const elt = parseRef(s, ctx)
      if (elt) { elts.push(elt); continue }
      if (textFrom < 0) textFrom = s.pos
      s.next()
      continue
    }

    if (ch === Ch.Lt) {
      flushText()
      const elt = parseLabel(s)
      if (elt) { elts.push(elt); continue }
      if (textFrom < 0) textFrom = s.pos
      s.next()
      continue
    }

    if (ch === Ch.SingleQuote || ch === Ch.DoubleQuote) {
      flushText()
      s.next()
      elts.push(new Elt(Type.SmartQuote, pos, s.pos))
      continue
    }

    // Shorthands
    if (ch === Ch.Tilde) {
      flushText()
      s.next()
      elts.push(new Elt(Type.Shorthand, pos, s.pos))
      continue
    }

    // Line comment
    if (ch === Ch.Slash && s.peek(1) === Ch.Slash) {
      flushText()
      elts.push(parseLineComment(s))
      continue
    }

    // Block comment
    if (ch === Ch.Slash && s.peek(1) === Ch.Star) {
      flushText()
      elts.push(parseBlockComment(s))
      continue
    }

    if (textFrom < 0) textFrom = s.pos
    s.next()
  }

  flushText()
  return elts
}
