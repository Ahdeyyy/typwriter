import { describe, expect, test } from "bun:test"

import { parser } from "./index"

/** Every `Error` node the parser produced, as `"text"@offset`. */
function errors(src: string): string[] {
  const found: string[] = []
  parser.parse(src).iterate({
    enter(node) {
      if (node.name === "Error") found.push(`${src.slice(node.from, node.to)}@${node.from}`)
    },
  })
  return found
}

/** Whether the tree contains a node of the given type. */
function has(src: string, name: string): boolean {
  let found = false
  parser.parse(src).iterate({
    enter(node) {
      if (node.name === name) found = true
    },
  })
  return found
}

/** The source text of the first node of the given type, or null. */
function textOf(src: string, name: string): string | null {
  let text: string | null = null
  parser.parse(src).iterate({
    enter(node) {
      if (text === null && node.name === name) text = src.slice(node.from, node.to)
    },
  })
  return text
}

describe("closures", () => {
  test("parenthesized parameter list", () => {
    const src = "#table(fill: (_, row) => if row == 0 { luma(225) } else { white })"
    expect(errors(src)).toEqual([])
    expect(has(src, "Closure")).toBe(true)
    expect(has(src, "Params")).toBe(true)
  })

  test.each([
    ["#let g = (a, b) => a + b", "two parameters"],
    ["#let g = (x) => x", "one parameter"],
    ["#let g = () => none", "no parameters"],
    ["#let g = (a: 1, b: 2) => a", "default values"],
    ["#let g = (..args) => args", "sink"],
    ["#let g = x => x * 2", "bare identifier"],
    ["#((a, b) => a)(1, 2)", "called inline"],
  ])("%s (%s)", (src) => {
    expect(errors(src)).toEqual([])
    expect(has(src, "Closure")).toBe(true)
  })
})

describe("field access across lines", () => {
  test("method chain in a code block", () => {
    const src = '#let f(x) = {\n  x.map(a => a)\n  .join(", ")\n}'
    expect(errors(src)).toEqual([])
  })

  test("method chain inside an argument list", () => {
    const src = "#f(\n  items.map(g)\n    .join()\n)"
    expect(errors(src)).toEqual([])
  })

  test("a comment may sit between the receiver and the dot", () => {
    const src = "#{\n  x // note\n  .foo()\n}"
    expect(errors(src)).toEqual([])
    expect(has(src, "FieldAccess")).toBe(true)
  })

  // A newline ends an embedded `#…` expression, so the next line is markup even
  // when it starts with a dot.
  test.each([
    "#let x = 5\n.hello world",
    "#x\n.foo",
    "Some text.\n#value\n.next line",
  ])("markup does not chain across the newline: %j", (src) => {
    expect(errors(src)).toEqual([])
    expect(has(src, "FieldAccess")).toBe(false)
  })

  test("same-line field access in markup still chains", () => {
    expect(has("#value.len()", "FieldAccess")).toBe(true)
  })
})

describe("binary operators across lines", () => {
  // The value of a `#let` / `#show` ends with its line. Reaching onto the next
  // one turns markup that happens to start with an operator character into an
  // operand: `#let x = 1` followed by `= Head` used to parse as `1 = Head`.
  test.each([
    ["#show heading.where(level: 2): smallcaps\n\n= Head", "Heading"],
    ["#show heading: smallcaps\n= Head", "Heading"],
    ["#let x = 1\n\n= Head", "Heading"],
    ["#let f(x) = x\n\n= Head", "Heading"],
    ["#let x = foo\n- item", "ListItem"],
    ["#let x = foo\n+ item", "EnumItem"],
    ["#let x = foo\n/ term: def", "TermItem"],
    ["#let x = foo\n*bold*", "Strong"],
  ])("%j stays markup", (src, node) => {
    expect(errors(src)).toEqual([])
    expect(has(src, node)).toBe(true)
    expect(has(src, "Binary")).toBe(false)
  })

  test("same-line operators still bind", () => {
    expect(has("#let x = 1 + 2", "Binary")).toBe(true)
  })

  // Inside brackets and braces newlines are trivia, so an operator may start
  // the next line.
  test.each(["#f(\n  1\n  + 2\n)", "#{\n  let x = 1\n    + 2\n}"])(
    "operator on the next line still binds inside %j",
    (src) => {
      expect(errors(src)).toEqual([])
      expect(has(src, "Binary")).toBe(true)
    },
  )
})

describe("line-scoped items inside a content block", () => {
  // A heading / list / enum / term item runs to the end of its line, but the
  // enclosing `[…]` binds tighter: `#big([ 1. one], size: 36pt)` used to let the
  // enum item eat `], size: 36pt)`, so the content block never closed and every
  // bracket after it was off by one for the rest of the file.
  test.each([
    ["#big([ 1. Not sure? Do not tap.], size: 36pt)", "EnumItem", "1. Not sure? Do not tap."],
    ["#f([+ one], k: 1)", "EnumItem", "+ one"],
    ["#f([- one], k: 1)", "ListItem", "- one"],
    ["#f([= Head], k: 1)", "Heading", "= Head"],
    ["#f([/ term: def], k: 1)", "TermItem", "/ term: def"],
  ])("%j ends its item at the bracket", (src, node, text) => {
    expect(errors(src)).toEqual([])
    expect(textOf(src, node)).toBe(text)
    expect(textOf(src, "ContentBlock")).toBe(src.slice(src.indexOf("["), src.indexOf("]") + 1))
  })

  test("the bracket still closes the block the item sits in", () => {
    const src = "#slide[\n  = Two Safe Rules\n  #big([ 1. one], size: 36pt)\n]\n\n#slide[\n  = Next\n]"
    expect(errors(src)).toEqual([])
    // Two separate calls, not one swallowing the other.
    expect(textOf(src, "FuncCall")).toBe(src.slice(0, src.indexOf("\n\n")))
  })

  // At the document root a stray `]` is ordinary text, so nothing should stop.
  test("a bare bracket at the root does not cut the line short", () => {
    const src = "= Head] and more"
    expect(errors(src)).toEqual([])
    expect(textOf(src, "Heading")).toBe(src)
  })

  test("emphasis in an item does not leak past the bracket", () => {
    const src = "#f([- a *b], c: 1)"
    expect(errors(src)).toEqual([])
    expect(has(src, "Strong")).toBe(false)
    expect(textOf(src, "ListItem")).toBe("- a *b")
  })
})
