import { afterEach, describe, expect, mock, test } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "../../apps/typwriter-desktop/node_modules/neverthrow";
import type { GrammarReport, WorkspaceDiff } from "../../apps/typwriter-desktop/src/lib/types";

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, result: ResultAsync.fromSafePromise(promise) };
}

const report: GrammarReport = {
  filePath: "main.typ", format: "typst", formatLabel: "Typst", skipped: null, lints: [],
};
const checkGrammar = mock(() => okAsync(report));
const vcsDiffVsCurrent = mock(() => okAsync<WorkspaceDiff, string>({ files: [] }));
const vcsPageDiffRequest = mock(() => okAsync<number, string>(1));
const onCompileDiagnostics = mock(() => okAsync<() => void, string>(() => {}));
const getProjectSnippets = mock(() => okAsync<string | null, string>(null));
const saveFile = mock(() => okAsync<void, string>(undefined));
const workspaceState = {
  rootPath: "/workspace",
  mainFile: "main.typ",
  tree: [] as { name: string; path: string; is_dir: boolean; expanded: boolean; children: never[] }[],
  toAbs: (path: string) => `/workspace/${path}`,
  toRel: (path: string) => path.replace(/^\/workspace\//, ""),
  schedulePersistTabs: () => {}, refreshTree: () => okAsync(),
};
const reads: ReturnType<typeof pending<{ type: "text"; content: string }>>[] = [];
const readFile = mock(() => {
  const read = pending<{ type: "text"; content: string }>();
  reads.push(read);
  return read.result;
});

mock.module("$lib/ipc/commands", () => ({
  checkGrammar, vcsDiffVsCurrent, vcsPageDiffRequest, readFile,
  getProjectSnippets, getUserSnippets: () => okAsync([]),
  setProjectSnippets: () => okAsync(), setUserSnippets: () => okAsync(),
  getGrammarConfig: () => okAsync({ enabled: true, dialect: "american", rules: {}, userDictionary: [], disabledFiles: [] }),
  getGrammarRules: () => okAsync([]), setGrammarConfig: () => okAsync(),
  addGrammarDictionaryWord: () => okAsync(), setGrammarFileEnabled: () => okAsync(),
  discardShadow: () => okAsync(), formatTypstSource: () => okAsync(""),
  formatTypstSourceWithCursor: () => okAsync({ formatted: "", cursor: 0 }),
  saveFile, triggerPreview: () => okAsync(), updateFileContent: () => okAsync(),
  vcsCreateRestorePoint: () => okAsync(null), vcsCurrentId: () => okAsync(null),
  vcsDiffBetween: () => okAsync({ files: [] }), vcsListHistory: () => okAsync([]),
  vcsPageDiffCancel: () => okAsync(), vcsRestoreFile: () => okAsync(), vcsRestoreWorkspace: () => okAsync(),
}));
mock.module("$lib/ipc/events", () => ({
  onCompileDiagnostics,
  emitSnippetsChanged: () => okAsync(), emitGrammarConfigChanged: () => okAsync(),
  onSnippetsChanged: () => okAsync(() => {}),
}));
mock.module("../../apps/typwriter-desktop/src/lib/stores/workspace.svelte.ts", () => ({ workspace: workspaceState }));
mock.module("../../apps/typwriter-desktop/src/lib/stores/settings.svelte.ts", () => ({ settings: {} }));
mock.module("../../apps/typwriter-desktop/src/lib/stores/bibliography.svelte.ts", () => ({ bibliography: { refresh: async () => {} } }));
mock.module("$lib/windows", () => ({ closeDiffWindow: async () => {} }));
mock.module("$lib/logger", () => ({ logError: () => {} }));
mock.module("svelte-sonner", () => ({ toast: { error: () => {}, warning: () => {} } }));
mock.module("../../apps/typwriter-desktop/src/lib/components/pages/home.svelte", () => ({ default: () => {} }));

const listeners: { resolve: (stop: () => void) => void }[] = [];
const emit = mock(async () => {});
mock.module("@tauri-apps/api/event", () => ({
  emit,
  listen: () => new Promise<() => void>((resolve) => { listeners.push({ resolve }); }),
}));

const { editor } = await import("../../apps/typwriter-desktop/src/lib/stores/editor.svelte");
const { grammar } = await import("../../apps/typwriter-desktop/src/lib/stores/grammar.svelte");
const { vcs } = await import("../../apps/typwriter-desktop/src/lib/stores/vcs.svelte");
const { diagnostics } = await import("../../apps/typwriter-desktop/src/lib/stores/diagnostics.svelte");
const { CrossWindowState } = await import("../../apps/typwriter-desktop/src/lib/ipc/cross-window-state.svelte");
const { page, pages } = await import("../../apps/typwriter-desktop/src/lib/stores/page.svelte");
const { documentScope } = await import("../../apps/typwriter-desktop/src/lib/stores/document-scope.svelte");
const { snippets } = await import("../../apps/typwriter-desktop/src/lib/stores/snippets.svelte");
const { ListenerScope } = await import("../../apps/typwriter-desktop/src/lib/ipc/listener-scope");

describe("desktop application listener ownership", () => {
  test("late registration is released and its callback cannot run after cleanup", async () => {
    const registration = pending<() => void>();
    let callback!: (payload: number) => void;
    const handler = mock(() => {});
    const stop = mock(() => {});
    const scope = new ListenerScope();
    scope.listen<number>((fn) => { callback = fn; return registration.result; }, handler, () => {});
    scope.destroy();
    callback(1);
    registration.resolve(stop);
    await new Promise((done) => setTimeout(done, 0));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  test("registered listeners are released exactly once", async () => {
    const stop = mock(() => {});
    const scope = new ListenerScope();
    scope.listen(() => okAsync(stop), () => {}, () => {});
    await new Promise((done) => setTimeout(done, 0));
    scope.destroy();
    scope.destroy();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

afterEach(async () => {
  await editor.reset();
  grammar.destroy();
  grammar.config.enabled = true;
  vcs.destroy();
  diagnostics.destroy();
  documentScope.clear();
  snippets.reset();
  workspaceState.tree = [];
  reads.length = 0;
  saveFile.mockReset();
  saveFile.mockImplementation(() => okAsync(undefined));
});

async function openText(path: string, text = "first") {
  const opening = editor.openFile(path);
  await new Promise((done) => setTimeout(done, 0));
  reads.at(-1)!.resolve({ type: "text", content: text });
  await opening;
}

describe("desktop save ownership", () => {
  test("workspace reset cancels an open waiting for a save", async () => {
    await openText("main.typ");
    editor.handleTabContentChange("main.typ", "edited");
    const save = pending<void>();
    saveFile.mockImplementationOnce(() => save.result);
    const opening = editor.openFile("old-workspace.typ");
    await new Promise((done) => setTimeout(done, 0));
    await editor.reset();
    save.resolve();
    // Resolve any erroneous read too so the baseline fails instead of hanging.
    await new Promise((done) => setTimeout(done, 0));
    reads.at(-1)!.resolve({ type: "text", content: "wrong workspace" });
    await opening;
    expect(editor.tabs).toEqual([]);
    expect(editor.activeTabId).toBeNull();
  });
  test("concurrent saves coalesce and drain newer edits before close", async () => {
    await openText("main.typ");
    editor.handleTabContentChange("main.typ", "first edit");
    const first = pending<void>();
    const second = pending<void>();
    saveFile.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    const saving = editor.flushTab("main.typ");
    await new Promise((done) => setTimeout(done, 0));
    editor.handleTabContentChange("main.typ", "latest edit");
    const closing = editor.closeTab("main.typ");
    await new Promise((done) => setTimeout(done, 0));
    expect(saveFile).toHaveBeenCalledTimes(1);
    first.resolve();
    await new Promise((done) => setTimeout(done, 0));
    expect(editor.tabs).toHaveLength(1);
    expect(saveFile.mock.calls[1]).toEqual(["/workspace/main.typ", "latest edit"]);
    second.resolve();
    await saving;
    expect(await closing).toBe(true);
    expect(editor.tabs).toHaveLength(0);
  });

  test("closing a sibling during a save does not shift the target of close", async () => {
    await openText("a.typ");
    await openText("b.typ");
    editor.handleTabContentChange("b.typ", "edited");
    const save = pending<void>();
    saveFile.mockImplementationOnce(() => save.result);
    const closing = editor.closeTab("b.typ");
    await editor.closeTab("a.typ", { flush: false });
    save.resolve();
    await closing;
    expect(editor.tabs).toHaveLength(0);
  });

  test("a failed save retains its tab and can be retried", async () => {
    await openText("main.typ");
    editor.handleTabContentChange("main.typ", "edited");
    saveFile.mockImplementationOnce(() => errAsync("disk full"));
    expect(await editor.closeTab("main.typ")).toBe(false);
    expect(editor.hasUnsavedChanges).toBe(true);
    expect(await editor.closeTab("main.typ")).toBe(true);
  });
});

describe("desktop disk read ownership", () => {
  test("an external read cannot populate a reopened tab", async () => {
    await openText("main.typ");
    const external = editor.applyExternalChanges([{ kind: "modified", path: "/workspace/main.typ", isDir: false }]);
    const oldRead = reads.at(-1)!;
    await editor.closeTab("main.typ", { flush: false });
    await openText("main.typ", "reopened");
    oldRead.resolve({ type: "text", content: "obsolete" });
    await external;
    expect(editor.fileContent).toBe("reopened");
  });

  test("the newest external read wins even if the older one finishes last", async () => {
    await openText("main.typ");
    const change = [{ kind: "modified" as const, path: "/workspace/main.typ", isDir: false }];
    const a = editor.applyExternalChanges(change);
    const first = reads.at(-1)!;
    const b = editor.applyExternalChanges(change);
    const second = reads.at(-1)!;
    second.resolve({ type: "text", content: "newest" });
    await b;
    first.resolve({ type: "text", content: "obsolete" });
    await a;
    expect(editor.fileContent).toBe("newest");
  });

  test("typing during an explicit reload keeps the new edits", async () => {
    await openText("main.typ");
    const reloading = editor.reloadTabFromDisk("main.typ");
    editor.handleTabContentChange("main.typ", "typed during reload");
    reads.at(-1)!.resolve({ type: "text", content: "disk copy" });
    await reloading;
    expect(editor.fileContent).toBe("typed during reload");
    expect(editor.hasUnsavedChanges).toBe(true);
  });
});

describe("desktop history state", () => {
  test("out-of-order diffs cannot replace the current selection", async () => {
    const first = pending<WorkspaceDiff>();
    const second = pending<WorkspaceDiff>();
    vcsDiffVsCurrent.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    const a = vcs.selectPoint("a");
    const b = vcs.selectPoint("b");
    second.resolve({ files: [] });
    await b;
    first.resolve({ files: [{ path: "wrong.typ" } as never] });
    await a;
    expect(vcs.primaryId).toBe("b");
    expect(vcs.diff?.files).toEqual([]);
  });

  test("clearing a selection invalidates its pending diff", async () => {
    const diff = pending<WorkspaceDiff>();
    vcsDiffVsCurrent.mockImplementationOnce(() => diff.result);
    const run = vcs.selectPoint("a");
    await vcs.selectPoint("a");
    expect(vcs.diffLoading).toBe(false);
    diff.resolve({ files: [] });
    await run;
    expect(vcs.diff).toBeNull();
  });

  test("teardown invalidates a pending page-diff registration", async () => {
    const registration = pending<number>();
    await vcs.selectPoint("a");
    vcsPageDiffRequest.mockImplementationOnce(() => registration.result);
    const run = vcs.requestPageDiff();
    vcs.destroy();
    registration.resolve(42);
    await run;
    expect(vcs.pageDiffRequestId).toBeNull();
    expect(vcs.pageDiffLoading).toBe(false);
  });
});

describe("desktop grammar state", () => {
  test("disabling checks prevents an old report from returning", async () => {
    const response = pending<GrammarReport>();
    checkGrammar.mockImplementationOnce(() => response.result);
    const checking = grammar.checkNow("main.typ", "first");
    await grammar.setEnabled(false);
    response.resolve(report);
    await checking;
    expect(grammar.reports).toEqual({});
    expect(grammar.checking).toEqual([]);
  });

  test("an old check cannot clear a newer check's busy indicator", async () => {
    const first = pending<GrammarReport>();
    const second = pending<GrammarReport>();
    checkGrammar.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    const a = grammar.checkNow("main.typ", "first");
    const b = grammar.checkNow("main.typ", "second");
    first.resolve(report);
    await a;
    expect(grammar.checking).toContain("main.typ");
    second.resolve(report);
    await b;
    expect(grammar.checking).toEqual([]);
  });

  test("forgetting and reopening a file cannot reuse a stale request token", async () => {
    const first = pending<GrammarReport>();
    const second = pending<GrammarReport>();
    checkGrammar.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result);
    const a = grammar.checkNow("main.typ", "first");
    grammar.forget("main.typ");
    const b = grammar.checkNow("main.typ", "second");
    first.resolve(report);
    await a;
    expect(grammar.reports).toEqual({});
    expect(grammar.checking).toContain("main.typ");
    second.resolve(report);
    await b;
  });
});

test("a read from a closed tab cannot seed a new tab with the same path", async () => {
  const first = editor.openFile("main.typ");
  expect(reads).toHaveLength(1);
  await editor.closeTab("main.typ", { flush: false });
  const second = editor.openFile("main.typ");
  expect(reads).toHaveLength(2);
  reads[0].resolve({ type: "text", content: "stale" });
  await first;
  expect(editor.isLoading).toBe(true);
  reads[1].resolve({ type: "text", content: "fresh" });
  await second;
  expect(editor.fileContent).toBe("fresh");
});

test("late diagnostics subscriptions are released after teardown", async () => {
  const registration = pending<() => void>();
  onCompileDiagnostics.mockImplementationOnce(() => registration.result);
  const initializing = diagnostics.init();
  diagnostics.destroy();
  const stop = mock(() => {});
  registration.resolve(stop);
  await initializing;
  expect(stop).toHaveBeenCalledTimes(1);
});

test("late cross-window subscriptions are released without sending a snapshot request", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {} as Window & typeof globalThis;
  try {
    const state = new CrossWindowState("test:lifetime", 0);
    state.destroy();
    const stopValue = mock(() => {});
    const stopAsk = mock(() => {});
    listeners[0].resolve(stopValue);
    listeners[1].resolve(stopAsk);
    await new Promise((done) => setTimeout(done, 0));
    expect(stopValue).toHaveBeenCalledTimes(1);
    expect(stopAsk).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  } finally {
    globalThis.window = previousWindow;
    listeners.length = 0;
  }
});

test("returning to the visible page cancels pending navigation without ghost history", async () => {
  let finish!: (module: { default: () => void }) => void;
  pages.workspace.load = () => new Promise((resolve) => { finish = resolve; });
  page.navigate("workspace");
  expect(page.navigating).toBe(true);
  expect(page.history).toEqual([]);
  page.navigate("home");
  finish({ default: () => {} });
  await new Promise((done) => setTimeout(done, 0));
  expect(page.current.name).toBe("home");
  expect(page.navigating).toBe(false);
  expect(page.history).toEqual([]);
});

test("a stale disk scan cannot repopulate the cleared document-scope cache", async () => {
  workspaceState.tree = [{ name: "main.typ", path: "main.typ", is_dir: false, expanded: false, children: [] }];
  const refresh = documentScope.refresh();
  expect(reads).toHaveLength(1);
  documentScope.clear();
  reads[0].resolve({ type: "text", content: '#include "old.typ"' });
  await refresh;
  documentScope.recompute();
  expect(documentScope.reachableFiles.has("old.typ")).toBe(false);
});

test("resetting project snippets invalidates a pending refresh", async () => {
  const response = pending<string | null>();
  getProjectSnippets.mockImplementationOnce(() => response.result);
  const refresh = snippets.refreshProject();
  snippets.reset();
  response.resolve(JSON.stringify([{ name: "old", body: "old project" }]));
  await refresh;
  expect(snippets.projectSnippets).toEqual([]);
});
