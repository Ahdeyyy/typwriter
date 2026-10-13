import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { canReuseCompletions, completionScope, type CompletionSnapshot } from "./completion-context";
import { autoTriggerApplies } from "./completion-logic";

function stateAt(doc: string, cursor = doc.length) {
  return EditorState.create({ doc, selection: { anchor: cursor } });
}

describe("syntax-aware completion triggers", () => {
  test.each([
    ['#set text(font: "', "string"],
    ['#set text(font: "Times ', "string"],
    ['#set text(font: ("Arial", "fi', "string"],
    ['#set text(weight: ', "code"],
    ['#set par(justify: ', "code"],
    ['#sym.', "code"],
    ['#image("images/', "string"],
    ['#image("https://host/', "string"],
    ['#import "@preview/', "string"],
    ['#let café = 1\n#caf', "code"],
    ['$alpha.', "math"],
    ['See @fi', "reference"],
    ['#figure[fi', "markup"],
    ['/* ``` */ fi', "markup"],
    ['`// /*` fi', "markup"],
    ['```', "raw-language"],
    ['```py', "raw-language"],
    ['````typ', "raw-language"],
    ['#set text(font: "/* literal // text', "string"],
    ['#set text(font: /* // closed */ ', "code"],
  ] as const)("requests appropriate completions in %s", (doc, scope) => {
    const state = stateAt(doc);
    expect(completionScope(state)).toBe(scope);
    expect(autoTriggerApplies(doc, completionScope(state))).toBe(true);
  });

  test.each(['// #im', '/* outer /* inner */ #im', '`#im', '```typst\n#im', '```py ', '```\n', 'https://host/fi'])
  ("suppresses Typst requests in %s", (doc) => {
    const state = stateAt(doc);
    expect(autoTriggerApplies(doc, completionScope(state))).toBe(false);
  });

  test.each(['#set text(font: /* #im', '#set text(font: // im', '#let x = /* outer /* inner */ im'])
  ("recognizes comments omitted by parser recovery in %s", (doc) => {
    expect(completionScope(stateAt(doc))).toBe("comment");
  });

  test("recognizes an omitted comment in the middle of a complete argument", () => {
    const doc = '#set text(font: /* font hint */ "Noto")';
    expect(completionScope(stateAt(doc, doc.indexOf('hint') + 2))).toBe("comment");
    expect(completionScope(stateAt(doc, doc.indexOf('Noto') + 2))).toBe("string");
  });
});

describe("completion cache context", () => {
  function snapshot(doc: string, prefix: string): CompletionSnapshot {
    const from = doc.indexOf(prefix);
    const to = from + prefix.length;
    return { text: doc, from, to, scope: completionScope(stateAt(doc, to)) };
  }

  test("reuses a code prefix while typing the same identifier", () => {
    const cached = snapshot('#im', 'im');
    expect(canReuseCompletions(cached, stateAt('#ima'))).toBe(true);
    expect(canReuseCompletions(cached, stateAt('#image.'))).toBe(false);
  });

  test("retains font candidates across spaces and Unicode", () => {
    const cached = snapshot('#set text(font: "Noto")', 'Noto');
    const doc = '#set text(font: "Noto Sans 中文")';
    expect(canReuseCompletions(cached, stateAt(doc, doc.indexOf('\")')))).toBe(true);
  });

  test("retains the opening quote in the IDE's font and path replacement ranges", () => {
    for (const [doc, prefix, next] of [
      ['#set text(font: "Noto")', '"Noto', '#set text(font: "Noto Sans")'],
      ['#image("images/fi")', '"images/fi', '#image("images/figure")'],
    ]) {
      const cached = snapshot(doc, prefix);
      expect(canReuseCompletions(cached, stateAt(next, next.indexOf('\")')))).toBe(true);
    }
  });

  test("a new leading sigil changes the query rather than the identifier", () => {
    const cached = snapshot('#im', 'im');
    expect(canReuseCompletions(cached, stateAt('#.im'))).toBe(false);
  });

  test("keeps path candidates within a segment, requests anew at a slash", () => {
    const cached = snapshot('#image("images/fi")', 'images/fi');
    expect(canReuseCompletions(cached, stateAt(cached.text, cached.to))).toBe(true);
    const next = '#image("images/fig")';
    expect(canReuseCompletions(cached, stateAt(next, next.indexOf('\")')))).toBe(true);
    const subdir = '#image("images/fig/")';
    expect(canReuseCompletions(cached, stateAt(subdir, subdir.indexOf('\")')))).toBe(false);
  });

  test("invalidates when the argument key changes at the same cursor offset", () => {
    const cached = snapshot('#set text(font: "fi")', 'fi');
    const next = '#set text(fill: "fi")';
    expect(canReuseCompletions(cached, stateAt(next, cached.to))).toBe(false);
  });

  test("invalidates when markup becomes a string or a comment", () => {
    const cached = snapshot('fi', 'fi');
    expect(canReuseCompletions(cached, stateAt('#let x = "fi'))).toBe(false);
    expect(canReuseCompletions(cached, stateAt('// fi'))).toBe(false);
  });

  test("invalidates edits outside the replacement region", () => {
    const cached = snapshot('#image("fi")', 'fi');
    const next = '#image("fi", width: 1cm)';
    expect(canReuseCompletions(cached, stateAt(next, cached.to))).toBe(false);
  });

  test("does not reuse during a range selection", () => {
    const cached = snapshot('#im', 'im');
    const state = EditorState.create({ doc: '#im', selection: { anchor: 1, head: 3 } });
    expect(canReuseCompletions(cached, state)).toBe(false);
  });
});
