import { Parser, type Input, TreeFragment, type PartialParse, Tree, NodeSet, parseMixed, type SyntaxNodeRef } from "@lezer/common"
import { Type, nodeSet } from "./types"
import { Scanner, Ch } from "./scanner"
import { parseMarkup } from "./markup"

/// Parsing mode: determines how characters are interpreted.
export type Mode = "markup" | "math" | "code"

/// An element being built in the tree.
export class Elt {
  constructor(
    readonly type: number,
    readonly from: number,
    readonly to: number,
    readonly children: Elt[] = [],
  ) {}

  /// Write this element into a flat buffer.
  writeTo(buf: number[], offset: number) {
    const startOff = buf.length
    for (const child of this.children) child.writeTo(buf, offset)
    buf.push(this.type, this.from - offset, this.to - offset, buf.length + 4 - startOff)
  }
}

/// Configuration for wrapping the parser with nested language support.
export interface TypstParserConfig {
  /// A `parseMixed`-style wrapper for nested language support.
  wrap?: ReturnType<typeof parseMixed>
  /// Override the node set (e.g. to add folding/indent props).
  nodeSet?: NodeSet
}

/// The main Typst parser. Extends Lezer's `Parser` to produce syntax trees
/// for Typst documents.
export class TypstParser extends Parser {
  readonly nodeSet: NodeSet
  private wrap: ReturnType<typeof parseMixed> | null

  constructor(nodeSet: NodeSet, wrap?: ReturnType<typeof parseMixed> | null) {
    super()
    this.nodeSet = nodeSet
    this.wrap = wrap ?? null
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    let parse: PartialParse = new TypstParseContext(this, input, fragments, ranges)
    if (this.wrap) {
      parse = this.wrap(parse, input, fragments, ranges)
    }
    return parse
  }

  /// Return a new parser with the given configuration applied.
  configure(config: TypstParserConfig): TypstParser {
    return new TypstParser(this.nodeSet, config.wrap ?? this.wrap)
  }
}

/// The incremental parse context. Drives the actual parsing work
/// and builds the tree.
export class TypstParseContext implements PartialParse {
  readonly parser: TypstParser
  readonly input: Input
  readonly scanner: Scanner
  readonly doc: string
  parsedPos: number
  stoppedAt: number | null = null

  /// Stack of elements being built
  private elts: Elt[] = []

  /// Whether the first advance() has run
  private started = false

  constructor(
    parser: TypstParser,
    input: Input,
    _fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ) {
    this.parser = parser
    this.input = input
    const from = ranges[0]?.from ?? 0
    const to = ranges[ranges.length - 1]?.to ?? input.length
    this.doc = input.read(from, to)
    this.scanner = new Scanner(this.doc)
    this.parsedPos = from
  }

  advance(): Tree | null {
    if (!this.started) {
      this.started = true
      // Parse the entire document as markup mode.
      this.elts = parseMarkup(this)
      this.parsedPos = this.doc.length
    }
    return this.finish()
  }

  stopAt(pos: number) {
    this.stoppedAt = pos
  }

  /// Build the final Tree from accumulated elements.
  private finish(): Tree {
    const buf: number[] = []
    for (const elt of this.elts) elt.writeTo(buf, 0)
    return Tree.build({
      buffer: buf,
      nodeSet: this.parser.nodeSet,
      topID: Type.Document,
      length: this.doc.length,
    })
  }
}

/// Create the default parser instance.
export const parser = new TypstParser(nodeSet)
