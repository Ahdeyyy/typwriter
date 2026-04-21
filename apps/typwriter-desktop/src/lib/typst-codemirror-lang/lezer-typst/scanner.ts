/// Character codes used frequently throughout the parser.
export const enum Ch {
  Newline = 10,
  CarriageReturn = 13,
  Space = 32,
  Tab = 9,
  Hash = 35,
  Dollar = 36,
  Star = 42,
  Plus = 43,
  Comma = 44,
  Minus = 45,
  Dot = 46,
  Slash = 47,
  Colon = 58,
  Semicolon = 59,
  Lt = 60,
  Eq = 61,
  Gt = 62,
  At = 64,
  LeftBracket = 91,
  Backslash = 92,
  RightBracket = 93,
  Hat = 94,
  Underscore = 95,
  Backtick = 96,
  LeftBrace = 123,
  RightBrace = 125,
  LeftParen = 40,
  RightParen = 41,
  Bang = 33,
  DoubleQuote = 34,
  SingleQuote = 39,
  Tilde = 126,
  Ampersand = 38,
  Percent = 37,
  Zero = 48,
  Nine = 57,
  a = 97,
  b = 98,
  e = 101,
  f = 102,
  n = 110,
  o = 111,
  r = 114,
  t = 116,
  u = 117,
  x = 120,
  z = 122,
  A = 65,
  F = 70,
  Z = 90,
  EOF = -1,
  h = 104 ,
}

/// Low-level character scanner for reading through a document.
export class Scanner {
  /// Current read position.
  pos: number

  constructor(
    readonly text: string,
    pos = 0,
  ) {
    this.pos = pos
  }

  /// Look at the character at the current position (or offset from it)
  /// without consuming.
  peek(offset = 0): number {
    const i = this.pos + offset
    return i < this.text.length ? this.text.charCodeAt(i) : Ch.EOF
  }

  /// Return the character at the current position and advance.
  next(): number {
    if (this.pos >= this.text.length) return Ch.EOF
    return this.text.charCodeAt(this.pos++)
  }

  /// Consume the character at the current position if it matches,
  /// returning true on success.
  eat(ch: number): boolean {
    if (this.peek() === ch) {
      this.pos++
      return true
    }
    return false
  }

  /// Consume characters while the predicate returns true.
  /// Returns the number of characters consumed.
  eatWhile(pred: (ch: number) => boolean): number {
    let start = this.pos
    while (this.pos < this.text.length && pred(this.text.charCodeAt(this.pos)))
      this.pos++
    return this.pos - start
  }

  /// Try to consume an exact string. Returns true on success.
  eatString(str: string): boolean {
    if (this.text.startsWith(str, this.pos)) {
      this.pos += str.length
      return true
    }
    return false
  }

  /// Whether the scanner has reached the end of the text.
  get done(): boolean {
    return this.pos >= this.text.length
  }

  /// Read a slice of the text from `from` to current pos.
  sliceFrom(from: number): string {
    return this.text.slice(from, this.pos)
  }

  /// Read a slice between two positions.
  slice(from: number, to: number): string {
    return this.text.slice(from, to)
  }

  /// The total length of the text.
  get length(): number {
    return this.text.length
  }
}

// Character classification helpers.

export function isAlpha(ch: number): boolean {
  return (ch >= Ch.a && ch <= Ch.z) || (ch >= Ch.A && ch <= Ch.Z)
}

export function isDigit(ch: number): boolean {
  return ch >= Ch.Zero && ch <= Ch.Nine
}

export function isHexDigit(ch: number): boolean {
  return isDigit(ch) || (ch >= Ch.a && ch <= Ch.f) || (ch >= Ch.A && ch <= Ch.F)
}

export function isIdentStart(ch: number): boolean {
  return isAlpha(ch) || ch === Ch.Underscore || ch > 127
}

export function isIdentChar(ch: number): boolean {
  return isAlpha(ch) || isDigit(ch) || ch === Ch.Underscore || ch === Ch.Minus || ch > 127
}

export function isWhitespace(ch: number): boolean {
  return ch === Ch.Space || ch === Ch.Tab || ch === Ch.Newline || ch === Ch.CarriageReturn
}

export function isNewline(ch: number): boolean {
  return ch === Ch.Newline || ch === Ch.CarriageReturn
}

export function isLineWhitespace(ch: number): boolean {
  return ch === Ch.Space || ch === Ch.Tab
}
