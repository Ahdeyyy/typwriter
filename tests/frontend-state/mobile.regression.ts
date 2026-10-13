import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { errAsync, ResultAsync } from "../../apps/typwriter-mobile/node_modules/neverthrow";
import type { EditorView } from "../../apps/typwriter-mobile/node_modules/@codemirror/view";
import { EditorState } from "../../apps/typwriter-mobile/node_modules/@codemirror/state";
import type { CompileResult, FileContent } from "../../apps/typwriter-mobile/src/lib/ipc/types";

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, result: ResultAsync.fromSafePromise(promise) };
}

const saveFile = mock(() => ResultAsync.fromSafePromise(Promise.resolve(undefined)));
const readFile = mock(() => ResultAsync.fromSafePromise(Promise.resolve<FileContent>({ type: "text", content: "" })));
const compile = mock(() => ResultAsync.fromSafePromise(Promise.resolve<CompileResult>({ generation: 1, pages: [], errors: [], warnings: [], compileMs: 0 })));
const getCompletions = mock(() => ResultAsync.fromSafePromise(Promise.resolve({ from: 0, completions: [] })));

mock.module("$lib/ipc/commands", () => ({
  saveFile, readFile, compile, getCompletions,
  setLastFile: () => ResultAsync.fromSafePromise(Promise.resolve()),
  setOpenTabs: () => ResultAsync.fromSafePromise(Promise.resolve()),
}));
mock.module("../../apps/typwriter-mobile/src/lib/stores/settings.svelte.ts", () => ({ settings: { autosaveMs: 60_000 } }));
mock.module("../../apps/typwriter-mobile/src/lib/stores/app.svelte.ts", () => ({ app: { overlay: "none" } }));

const { editor } = await import("../../apps/typwriter-mobile/src/lib/stores/editor.svelte");
const { compileStore } = await import("../../apps/typwriter-mobile/src/lib/stores/compile.svelte");
const { completions } = await import("../../apps/typwriter-mobile/src/lib/editor/completion-controller.svelte");
const { prepareExport } = await import("../../apps/typwriter-mobile/src/lib/services/prepare-export");

let text = "first";
const view = {
  state: {
    doc: { toString: () => text },
    selection: { main: { head: 0 } },
  },
} as unknown as EditorView;

beforeEach(() => {
  editor.resetTabs();
  editor.view = view;
  editor.relPath = "main.typ";
  editor.fileKind = "text";
  editor.tabs = ["main.typ"];
  text = "first";
  compileStore.clear();
  compileStore.lastGeneration = 0;
  saveFile.mockClear();
  readFile.mockClear();
  compile.mockClear();
  getCompletions.mockClear();
});

afterEach(() => {
  editor.resetTabs();
  editor.view = null;
  completions.clear();
});

describe("mobile editor state", () => {
  test("closing an active tab keeps it reachable if its save fails", async () => {
    editor.dirty = true;
    saveFile.mockImplementationOnce(() => errAsync("disk full"));
    expect((await editor.closeTab("main.typ")).isErr()).toBe(true);
    expect(editor.tabs).toEqual(["main.typ"]);
    expect(editor.relPath).toBe("main.typ");
    expect(editor.dirty).toBe(true);
  });

  test("close others retains the active tab when switching cannot save", async () => {
    editor.tabs = ["main.typ", "keep.typ"];
    editor.dirty = true;
    saveFile.mockImplementationOnce(() => errAsync("disk full"));
    expect((await editor.closeOtherTabs("keep.typ")).isErr()).toBe(true);
    expect(editor.tabs).toEqual(["main.typ", "keep.typ"]);
    expect(readFile).not.toHaveBeenCalled();
  });
  test("a disk conflict blocks autosave until the user keeps the buffer", async () => {
    editor.dirty = true;
    editor.externallyChanged = true;
    expect((await editor.flush()).isErr()).toBe(true);
    expect(saveFile).not.toHaveBeenCalled();
    expect(editor.dirty).toBe(true);
    await editor.keepMyChanges();
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(editor.dirty).toBe(false);
    expect(editor.externallyChanged).toBe(false);
  });

  test("a failed explicit reload retains the dirty buffer and conflict", async () => {
    editor.dirty = true;
    editor.externallyChanged = true;
    readFile.mockImplementationOnce(() => errAsync("read failed"));
    expect((await editor.reloadActiveFromDisk()).isErr()).toBe(true);
    expect(editor.dirty).toBe(true);
    expect(editor.externallyChanged).toBe(true);
  });
  test("a failed file switch keeps the previous file and its saved buffer", async () => {
    text = "latest saved text";
    editor.dirty = true;
    readFile.mockImplementationOnce(() => errAsync("missing file"));
    expect((await editor.loadFile("missing.typ")).isErr()).toBe(true);
    expect(editor.relPath).toBe("main.typ");
    expect(editor.loadedText).toBe("latest saved text");
    expect(editor.loading).toBe(false);
    expect(editor.tabs).toEqual(["main.typ"]);
  });

  test("remapping a file during a read prevents old-path results from seeding it", async () => {
    const read = pending<FileContent>();
    readFile.mockImplementationOnce(() => read.result);
    const reload = editor.reloadActiveFromDisk(false);
    await new Promise((done) => setTimeout(done, 0));
    editor.applyEntryChange("main.typ", "renamed.typ");
    read.resolve({ type: "text", content: "old-path text" });
    await reload;
    expect(editor.relPath).toBe("renamed.typ");
    expect(editor.loadedText).not.toBe("old-path text");
  });
  test("a flush drains edits typed during an in-flight save", async () => {
    const first = pending<void>();
    const second = pending<void>();
    saveFile.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    editor.dirty = true;
    const saving = editor.flush();
    text = "newer edits";
    first.resolve();
    await new Promise((done) => setTimeout(done, 0));
    expect(editor.dirty).toBe(true);
    expect(saveFile.mock.calls).toEqual([["main.typ", "first"], ["main.typ", "newer edits"]]);
    second.resolve();
    expect((await saving).isOk()).toBe(true);
    expect(editor.dirty).toBe(false);
  });

  test("an empty tab waits for the latest buffer to be saved", async () => {
    const first = pending<void>();
    const second = pending<void>();
    saveFile.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    editor.dirty = true;
    void editor.flush();
    text = "newer edits";
    const opening = editor.openNewTab();
    expect(editor.relPath).toBe("main.typ");
    first.resolve();
    await new Promise((done) => setTimeout(done, 0));
    expect(editor.relPath).toBe("main.typ");
    second.resolve();
    await opening;
    expect(editor.newTabOpen).toBe(true);
    expect(editor.relPath).toBeNull();
  });

  test("newer edits still drain after the editor view unmounts", async () => {
    const first = pending<void>();
    const second = pending<void>();
    saveFile.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    editor.dirty = true;
    const saving = editor.flush();
    text = "typed before going home";
    editor.handleDocChanged();
    editor.view = null;
    first.resolve();
    await new Promise((done) => setTimeout(done, 0));
    expect(saveFile.mock.calls[1]).toEqual(["main.typ", "typed before going home"]);
    second.resolve();
    await saving;
    expect(editor.dirty).toBe(false);
  });

  test("out-of-order file reads cannot replace a newer selection", async () => {
    const first = pending<FileContent>();
    const second = pending<FileContent>();
    readFile.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    const a = editor.loadFile("a.typ");
    await new Promise((done) => setTimeout(done, 0));
    const b = editor.loadFile("b.typ");
    await new Promise((done) => setTimeout(done, 0));
    second.resolve({ type: "text", content: "B" });
    await b;
    first.resolve({ type: "text", content: "A" });
    await a;
    expect(editor.relPath).toBe("b.typ");
    expect(editor.loadedText).toBe("B");
    expect(editor.tabs).not.toContain("a.typ");
  });

  test("resetting tabs invalidates a pending file read", async () => {
    const read = pending<FileContent>();
    readFile.mockImplementationOnce(() => read.result);
    const loading = editor.loadFile("a.typ");
    await new Promise((done) => setTimeout(done, 0));
    editor.resetTabs();
    read.resolve({ type: "text", content: "old workspace" });
    await loading;
    expect(editor.relPath).toBeNull();
    expect(editor.loadedText).toBe("");
    expect(editor.tabs).toEqual([]);
    expect(editor.loading).toBe(false);
  });

  test("an automatic reload never overwrites typing across the read", async () => {
    const read = pending<FileContent>();
    readFile.mockImplementationOnce(() => read.result);
    const reload = editor.reloadActiveFromDisk(false);
    text = "typed while reading";
    editor.handleDocChanged();
    read.resolve({ type: "text", content: "external edit" });
    await reload;
    expect(editor.dirty).toBe(true);
    expect(editor.externallyChanged).toBe(true);
    expect(text).toBe("typed while reading");
  });
});

describe("mobile compile state", () => {
  test("a save invalidates a compile that started before the disk changed", async () => {
    const response = pending<CompileResult>();
    compile.mockImplementationOnce(() => response.result);
    const run = compileStore.run();
    compileStore.onSaved();
    response.resolve({ generation: 15, pages: [], errors: [], warnings: [], compileMs: 0 });
    await run;
    expect(compileStore.stale).toBe(true);
    expect(compileStore.status).toBe("idle");
  });
  test("clearing the document invalidates an in-flight compile", async () => {
    const response = pending<CompileResult>();
    compile.mockImplementationOnce(() => response.result);
    const run = compileStore.run();
    compileStore.clear();
    response.resolve({ generation: 12, pages: [], errors: [], warnings: [], compileMs: 0 });
    await run;
    expect(compileStore.status).toBe("idle");
    expect(compileStore.stale).toBe(true);
  });

  test("a transport error settles the compiling status", async () => {
    compile.mockImplementationOnce(() => errAsync("offline"));
    expect((await compileStore.run()).isErr()).toBe(true);
    expect(compileStore.status).toBe("error");
    expect(compileStore.stale).toBe(true);
  });
});

describe("mobile export preparation", () => {
  test("dirty text is saved before deciding whether the compile is fresh", async () => {
    editor.dirty = true;
    compileStore.stale = false;
    compileStore.pages = [{ index: 0, widthPt: 100, heightPt: 100, fingerprint: "page" } as never];
    compile.mockImplementationOnce(() => ResultAsync.fromSafePromise(Promise.resolve({ generation: 20, pages: [...compileStore.pages], errors: [], warnings: [], compileMs: 0 })));
    expect((await prepareExport("pdf", () => true)).isOk()).toBe(true);
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  test("save errors stop export preparation without compiling", async () => {
    editor.dirty = true;
    saveFile.mockImplementationOnce(() => errAsync("disk full"));
    const result = await prepareExport("pdf", () => true);
    expect(result.isErr() && result.error).toBe("disk full");
    expect(compile).not.toHaveBeenCalled();
  });

  test("transport errors stop preparation even if a previous render exists", async () => {
    compileStore.pages = [{} as never];
    compile.mockImplementationOnce(() => errAsync("offline"));
    const result = await prepareExport("pdf", () => true);
    expect(result.isErr() && result.error).toBe("offline");
  });

  test("canceling during a save prevents a subsequent compile", async () => {
    const save = pending<void>();
    saveFile.mockImplementationOnce(() => save.result);
    editor.dirty = true;
    let owns = true;
    const run = prepareExport("pdf", () => owns);
    owns = false;
    save.resolve();
    const result = await run;
    expect(result.isErr() && result.error).toBe("Export cancelled");
    expect(compile).not.toHaveBeenCalled();
  });

  test("HTML can export without a paged document", async () => {
    expect((await prepareExport("html", () => true)).isOk()).toBe(true);
    expect(compile).not.toHaveBeenCalled();
  });

  test("a failed compile with no previous pages cannot be exported", async () => {
    compile.mockImplementationOnce(() => ResultAsync.fromSafePromise(Promise.resolve({ generation: 20, pages: null, errors: [{} as never], warnings: [], compileMs: 0 })));
    const result = await prepareExport("pdf", () => true);
    expect(result.isErr() && result.error).toBe("No compiled document to export");
  });
});

test("clearing completions cancels the queued request", async () => {
  // Auto-trigger schedules the request without creating a DOM scroll pin.
  text = "#im";
  completions.onCursorActivity({
    docChanged: true,
    state: EditorState.create({ doc: "#im", selection: { anchor: 3 } }),
    view,
  } as never);
  completions.clear();
  await new Promise((done) => setTimeout(done, 175));
  expect(getCompletions).not.toHaveBeenCalled();
  expect(completions.items).toEqual([]);
});

test("clearing completions invalidates a response already in flight", async () => {
  const response = pending<{ from: number; completions: never[] }>();
  getCompletions.mockImplementationOnce(() => response.result);
  const completionView = { state: EditorState.create({ doc: "#im", selection: { anchor: 3 } }) } as EditorView;
  editor.view = completionView;
  completions.onCursorActivity({ docChanged: true, state: completionView.state, view: completionView } as never);
  await new Promise((done) => setTimeout(done, 175));
  expect(getCompletions).toHaveBeenCalledTimes(1);
  completions.clear();
  response.resolve({ from: 1, completions: [{ kind: "func", label: "image", apply: "image()", detail: null } as never] });
  await new Promise((done) => setTimeout(done, 0));
  expect(completions.items).toEqual([]);
});

function completionViewFor(doc: string, head = doc.length) {
  const completionView = { state: EditorState.create({ doc, selection: { anchor: head } }) } as EditorView;
  editor.view = completionView;
  return completionView;
}

function completionActivity(completionView: EditorView, docChanged = true, selectionSet = false) {
  completions.onCursorActivity({ docChanged, selectionSet, state: completionView.state, view: completionView } as never);
}

function completionResponse(from: number, labels: string[], kind = "Font") {
  return ResultAsync.fromSafePromise(Promise.resolve({
    from, completions: labels.map((label) => ({ kind, label, apply: label, detail: null })),
  })) as ReturnType<typeof getCompletions>;
}

test("mobile completions trigger on an opening quote and rank candidates beyond 256", async () => {
  const doc = '#set text(font: "';
  const completionView = completionViewFor(doc);
  getCompletions.mockImplementationOnce(() => completionResponse(doc.length,
    [...Array.from({ length: 300 }, (_, i) => `Font ${i}`), 'Zebra Sans']));
  completionActivity(completionView);
  await new Promise((done) => setTimeout(done, 175));
  expect(getCompletions).toHaveBeenCalledWith('main.typ', doc, doc.length, false);
  (completionView as { state: EditorState }).state = EditorState.create({ doc: doc + 'Zebra', selection: { anchor: doc.length + 5 } });
  completionActivity(completionView);
  expect(completions.items.map((item) => item.label)).toEqual(['Zebra Sans']);
});

test("mobile completions preserve a multiword font anchor and reuse across spaces", async () => {
  const doc = '#set text(font: "Times N';
  const from = doc.indexOf('"');
  const completionView = completionViewFor(doc);
  getCompletions.mockImplementationOnce(() => completionResponse(from, ['"Times New Roman"', '"Noto Sans"']));
  completionActivity(completionView);
  await new Promise((done) => setTimeout(done, 175));
  expect(completions.from).toBe(from);
  expect(completions.items.map((item) => item.label)).toEqual(['"Times New Roman"']);
  const next = doc + 'e ';
  (completionView as { state: EditorState }).state = EditorState.create({ doc: next, selection: { anchor: next.length } });
  completionActivity(completionView);
  expect(completions.items.map((item) => item.label)).toEqual(['"Times New Roman"']);
});

test.each(['view', 'path'])("cached mobile completions belong to the requesting %s", async (owner) => {
  const original = completionViewFor('#im');
  getCompletions.mockImplementationOnce(() => completionResponse(1, ['image'], 'Func'));
  completionActivity(original);
  await new Promise((done) => setTimeout(done, 175));
  const item = completions.items[0];
  const active = owner === 'view' ? completionViewFor('#im') : original;
  if (owner === 'path') editor.relPath = 'chapter.typ';
  const focus = mock(() => {});
  const dispatch = mock(() => {});
  Object.assign(active, { focus, dispatch });
  completions.accept(active, item);
  expect(focus).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(completions.items).toEqual([]);
});

test("accepts a cached quoted font immediately after typing a space", async () => {
  const doc = '#set text(font: "Noto';
  const completionView = completionViewFor(doc);
  getCompletions.mockImplementationOnce(() => completionResponse(doc.indexOf('"'), ['"Noto Sans"']));
  completionActivity(completionView);
  await new Promise((done) => setTimeout(done, 175));
  const next = doc + ' ';
  (completionView as { state: EditorState }).state = EditorState.create({ doc: next, selection: { anchor: next.length } });
  completionActivity(completionView);
  const focus = mock(() => {});
  const dispatch = mock(() => {});
  Object.assign(completionView, { focus, dispatch });
  expect(completions.items).toHaveLength(1);
  completions.accept(completionView, completions.items[0]);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][0].changes.apply(completionView.state.doc).toString()).toBe('#set text(font: "Noto Sans"');
});

test("changing an argument clears cached values at the same cursor offset", async () => {
  const doc = '#set text(font: "No';
  const completionView = completionViewFor(doc);
  getCompletions.mockImplementationOnce(() => completionResponse(doc.indexOf('No'), ['Noto Sans']));
  completionActivity(completionView);
  await new Promise((done) => setTimeout(done, 175));
  expect(completions.items).toHaveLength(1);
  const next = doc.replace('font:', 'fill:');
  (completionView as { state: EditorState }).state = EditorState.create({ doc: next, selection: { anchor: next.length } });
  completionActivity(completionView);
  expect(completions.items).toEqual([]);
});

test("moving away and back invalidates an in-flight mobile completion response", async () => {
  const response = pending<{ from: number; completions: never[] }>();
  getCompletions.mockImplementationOnce(() => response.result);
  const completionView = completionViewFor('#im');
  completionActivity(completionView);
  await new Promise((done) => setTimeout(done, 175));
  (completionView as { state: EditorState }).state = EditorState.create({ doc: '#im', selection: { anchor: 0 } });
  completionActivity(completionView, false, true);
  (completionView as { state: EditorState }).state = EditorState.create({ doc: '#im', selection: { anchor: 3 } });
  completionActivity(completionView, false, true);
  response.resolve({ from: 1, completions: [{ kind: 'Func', label: 'image', apply: 'image()', detail: null } as never] });
  await new Promise((done) => setTimeout(done, 0));
  expect(completions.items).toEqual([]);
});

test("raw blocks, comments, selections and non-Typst files never queue mobile completions", async () => {
  for (const doc of ['`#im', '// #im', '/* #im', '```\n#im']) {
    completionActivity(completionViewFor(doc));
  }
  const selected = completionViewFor('#im');
  (selected as { state: EditorState }).state = EditorState.create({ doc: '#im', selection: { anchor: 1, head: 3 } });
  completionActivity(selected);
  editor.relPath = 'notes.md';
  completionActivity(completionViewFor('#im'));
  await new Promise((done) => setTimeout(done, 175));
  expect(getCompletions).not.toHaveBeenCalled();
});
