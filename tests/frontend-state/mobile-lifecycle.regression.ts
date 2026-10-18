import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "../../apps/typwriter-mobile/node_modules/neverthrow";
import type { EntryChange, FileNode, WorkspaceFilesChangedPayload, WorkspaceInfo, WorkspaceMeta } from "../../apps/typwriter-mobile/src/lib/ipc/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject, result: ResultAsync.fromPromise(promise, String) };
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0));
const tree = (name: string): FileNode => ({ name, relPath: "", isDir: true, children: [] });
const info = (name: string): WorkspaceInfo => ({
  name, root: `/workspaces/${name}`, tree: tree(name), mainFile: null,
  lastFile: null, openTabs: [], activeTab: null, cursor: null,
});
const getFileTree = mock(() => okAsync<FileNode, string>(tree("default")));
const rescanWorkspace = mock(() => okAsync<FileNode, string>(tree("rescan")));
const openWorkspace = mock((name: string) => okAsync<WorkspaceInfo, string>(info(name)));
const openDocument = mock((uri: string) => okAsync<WorkspaceInfo, string>({
  ...info(uri), name: "notes.typ", mainFile: "notes.typ", document: true,
  openTabs: ["notes.typ"], activeTab: "notes.typ",
}));
const createFile = mock(() => okAsync<FileNode, string>(tree("created")));
const renameEntry = mock(() => okAsync<EntryChange, string>({ tree: tree("renamed"), from: "main.typ", to: "new.typ" }));
const listWorkspaces = mock(() => okAsync<WorkspaceMeta[], string>([]));
const setMainFile = mock(() => okAsync<void, string>(undefined));
const editorMock = {
  tabs: ["main.typ"], relPath: "main.typ", newTabOpen: false,
  view: null as null | { state: { selection: { main: { head: number } } } },
  dirty: false,
  flush: mock(() => okAsync<void, string>(undefined)),
  resetTabs: mock(() => {}), seedTabs: mock(() => {}),
  reloadActiveFromDisk: mock(() => okAsync<void, string>(undefined)),
  applyEntryChange: mock(() => {}), applyExternalChanges: mock(() => {}),
  abandonWrites: mock(() => okAsync<void, string>(undefined)),
};
const compileMock = {
  onSaved: mock(() => {}), onWorkspaceOpened: mock(() => {}),
  onMainChanged: mock(() => {}), clear: mock(() => {}),
};
type Listener = {
  handler: (payload: WorkspaceFilesChangedPayload) => void;
  registration: ReturnType<typeof deferred<() => void>>;
};
const registrations: Listener[] = [];
const onWorkspaceFilesChanged = mock((handler: Listener["handler"]) => {
  const registration = deferred<() => void>();
  registrations.push({ handler, registration });
  return registration.result;
});
const loadStore = mock(async () => ({
  get: async () => null, set: async () => {}, save: async () => {},
}));

mock.module("$lib/ipc/commands", () => ({
  getFileTree, rescanWorkspace, openWorkspace, openDocument, createFile, renameEntry, listWorkspaces, setMainFile,
}));
mock.module("$lib/ipc/events", () => ({ onWorkspaceFilesChanged }));
mock.module("../../apps/typwriter-mobile/src/lib/stores/editor.svelte.ts", () => ({ editor: editorMock }));
mock.module("../../apps/typwriter-mobile/src/lib/stores/compile.svelte.ts", () => ({ compileStore: compileMock }));
mock.module("@tauri-apps/plugin-store", () => ({ load: loadStore }));

// EventTarget is enough for listener ownership tests; no renderer or Tauri runs.
class Surface extends EventTarget {
  handlers = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (callback) {
      const handlers = this.handlers.get(type) ?? new Set();
      handlers.add(callback);
      this.handlers.set(type, handlers);
    }
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (callback) this.handlers.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  count(type: string) { return this.handlers.get(type)?.size ?? 0; }
}
const windowSurface = new Surface();
const documentSurface = Object.assign(new Surface(), {
  visibilityState: "visible",
  body: { style: { pointerEvents: "", overflow: "", removeProperty: mock(() => {}) } },
  querySelectorAll: () => [],
});
const historyMock = {
  state: { screen: "home", overlay: "none" },
  replaceState: mock((state: typeof historyMock.state) => { historyMock.state = state; }),
  pushState: mock((state: typeof historyMock.state) => { historyMock.state = state; }),
  back: mock(() => {}), go: mock(() => {}),
};
const observers: { disconnect: ReturnType<typeof mock> }[] = [];
class Observer {
  disconnect = mock(() => {});
  observe() {}
  constructor() { observers.push(this); }
}
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: windowSurface, document: documentSurface, history: historyMock, MutationObserver: Observer })) {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}

const { settings, SettingsStore } = await import("../../apps/typwriter-mobile/src/lib/stores/settings.svelte");
const { app } = await import("../../apps/typwriter-mobile/src/lib/stores/app.svelte");
const { workspace } = await import("../../apps/typwriter-mobile/src/lib/stores/workspace.svelte");
const { scheduleBodyLockRelease } = await import("../../apps/typwriter-mobile/src/lib/body-lock");
const setLastWorkspace = spyOn(settings, "setLastWorkspace").mockImplementation(() => {});

beforeEach(() => {
  workspace.destroy();
  app.destroy();
  workspace.name = "a";
  workspace.root = "/workspaces/a";
  workspace.tree = tree("a");
  workspace.mainFile = "main.typ";
  workspace.document = false;
  workspace.workspaces = [];
  app.screen = "editor";
  app.overlay = "none";
  historyMock.state = { screen: "editor", overlay: "none" };
  documentSurface.visibilityState = "visible";
  documentSurface.body.style.pointerEvents = "";
  documentSurface.body.style.overflow = "";
  documentSurface.body.style.removeProperty.mockClear();
  for (const fn of [getFileTree, rescanWorkspace, openWorkspace, openDocument, createFile, renameEntry, listWorkspaces,
    setMainFile, onWorkspaceFilesChanged, loadStore, setLastWorkspace,
    ...Object.values(editorMock).filter((value) => typeof value === "function"),
    ...Object.values(compileMock)]) fn.mockClear();
});

afterEach(async () => {
  workspace.destroy();
  app.destroy();
  for (const { registration } of registrations) registration.resolve(() => {});
  registrations.length = 0;
  await tick();
});

afterAll(() => {
  setLastWorkspace.mockRestore();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("workspace request ownership", () => {
  test("a rejected document restores the saved editor without replacing the session", async () => {
    openDocument.mockImplementationOnce(() => errAsync("Choose a .typ document"));
    expect((await workspace.openDocument("content://provider/notes.txt")).isErr()).toBe(true);
    expect(workspace.root).toBe("/workspaces/a");
    expect(editorMock.seedTabs).toHaveBeenCalledWith(["main.typ"], "main.typ", null);
    expect(compileMock.onWorkspaceOpened).not.toHaveBeenCalled();
  });
  test("opening a document waits for unsaved edits and clears workspace restore", async () => {
    const saving = deferred<void>();
    editorMock.flush.mockImplementationOnce(() => saving.result);
    const opening = workspace.openDocument("content://provider/42");
    await tick();
    expect(openDocument).not.toHaveBeenCalled();
    expect(editorMock.resetTabs).not.toHaveBeenCalled();
    saving.resolve();
    expect((await opening).isOk()).toBe(true);
    expect(workspace.document).toBe(true);
    expect(workspace.mainFile).toBe("notes.typ");
    expect(setLastWorkspace).toHaveBeenLastCalledWith(null);
    expect(editorMock.seedTabs).toHaveBeenCalledWith(["notes.typ"], "notes.typ", null);
  });

  test("a failed save prevents an OS document open without dropping the buffer", async () => {
    editorMock.flush.mockImplementationOnce(() => errAsync("write permission denied"));
    expect((await workspace.openDocument("content://provider/42")).isErr()).toBe(true);
    expect(openDocument).not.toHaveBeenCalled();
    expect(editorMock.resetTabs).not.toHaveBeenCalled();
    expect(workspace.root).toBe("/workspaces/a");
    expect(workspace.isOpening).toBe(false);
  });

  test("workspace and document opens share the native session queue", async () => {
    const old = deferred<WorkspaceInfo>();
    openWorkspace.mockImplementationOnce(() => old.result);
    const first = workspace.open("obsolete");
    await tick();
    const second = workspace.openDocument("content://provider/42");
    await tick();
    expect(openDocument).not.toHaveBeenCalled();
    old.resolve(info("obsolete"));
    expect((await first).isErr()).toBe(true);
    await second;
    expect(workspace.document).toBe(true);
    expect(editorMock.seedTabs).toHaveBeenCalledTimes(1);
    await workspace.switchTo("notes.typ");
    expect(openWorkspace).toHaveBeenLastCalledWith("notes.typ");
    expect(workspace.document).toBe(false);
  });

  test("an old tree cannot replace a reopened workspace with the same root", async () => {
    const old = deferred<FileNode>();
    getFileTree.mockImplementationOnce(() => old.result);
    const refresh = workspace.refreshTree();
    await workspace.open("b");
    await workspace.open("a");
    old.resolve(tree("obsolete"));
    await refresh;
    expect(workspace.tree?.name).toBe("a");
  });

  test("a newer tree refresh wins when responses arrive out of order", async () => {
    const old = deferred<FileNode>();
    const newer = deferred<FileNode>();
    getFileTree.mockImplementationOnce(() => old.result).mockImplementationOnce(() => newer.result);
    const first = workspace.refreshTree();
    const second = workspace.refreshTree();
    newer.resolve(tree("newer"));
    await second;
    old.resolve(tree("older"));
    await first;
    expect(workspace.tree?.name).toBe("newer");
  });

  test("a stale foreground rescan cannot reload or compile a new workspace", async () => {
    const old = deferred<FileNode>();
    rescanWorkspace.mockImplementationOnce(() => old.result);
    workspace.init();
    documentSurface.dispatchEvent(new Event("visibilitychange"));
    await workspace.open("b");
    old.resolve(tree("obsolete"));
    await tick();
    expect(workspace.tree?.name).toBe("b");
    expect(editorMock.reloadActiveFromDisk).not.toHaveBeenCalled();
    expect(compileMock.onSaved).not.toHaveBeenCalled();
  });

  test("a completed file operation invalidates an older tree snapshot", async () => {
    const old = deferred<FileNode>();
    getFileTree.mockImplementationOnce(() => old.result);
    const refresh = workspace.refreshTree();
    await workspace.createFile("new.typ");
    old.resolve(tree("before creation"));
    await refresh;
    expect(workspace.tree?.name).toBe("created");
  });

  test("an old rename response cannot remap the new workspace's editor", async () => {
    const old = deferred<EntryChange>();
    renameEntry.mockImplementationOnce(() => old.result);
    const rename = workspace.renameEntry("main.typ", "new.typ");
    await tick();
    await workspace.open("b");
    old.resolve({ tree: tree("obsolete"), from: "main.typ", to: "new.typ" });
    expect((await rename).isErr()).toBe(true);
    expect(workspace.tree?.name).toBe("b");
    expect(editorMock.applyEntryChange).not.toHaveBeenCalled();
    expect(compileMock.onMainChanged).not.toHaveBeenCalled();
  });

  test("a stale creation fails instead of running the caller's file-opening callback", async () => {
    const old = deferred<FileNode>();
    createFile.mockImplementationOnce(() => old.result);
    const onCreated = mock(() => {});
    const creating = workspace.createFile("new.typ").andTee(onCreated);
    await workspace.open("b");
    old.resolve(tree("obsolete"));
    expect((await creating).isErr()).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    expect(workspace.tree?.name).toBe("b");
  });

  test("a file operation waiting for a flush cannot start against a new root", async () => {
    const saving = deferred<void>();
    editorMock.flush.mockImplementationOnce(() => saving.result);
    const rename = workspace.renameEntry("main.typ", "new.typ");
    const opening = workspace.open("b");
    saving.resolve();
    expect((await rename).isErr()).toBe(true);
    await opening;
    expect(renameEntry).not.toHaveBeenCalled();
  });

  test("a delayed main-file change cannot compile a new workspace", async () => {
    const old = deferred<void>();
    setMainFile.mockImplementationOnce(() => old.result);
    const changing = workspace.setMain("chapter.typ");
    await tick();
    await workspace.open("b");
    old.resolve();
    expect((await changing).isErr()).toBe(true);
    expect(workspace.mainFile).toBeNull();
    expect(compileMock.onMainChanged).not.toHaveBeenCalled();
  });

  test("teardown invalidates pending tree and workspace-list reads", async () => {
    const oldTree = deferred<FileNode>();
    const oldList = deferred<WorkspaceMeta[]>();
    getFileTree.mockImplementationOnce(() => oldTree.result);
    listWorkspaces.mockImplementationOnce(() => oldList.result);
    const refresh = workspace.refreshTree();
    const list = workspace.refreshList();
    workspace.destroy();
    oldTree.resolve(tree("obsolete"));
    oldList.resolve([{ name: "obsolete" } as WorkspaceMeta]);
    await Promise.all([refresh, list]);
    expect(workspace.tree?.name).toBe("a");
    expect(workspace.workspaces).toEqual([]);
  });

  test("a remounted app's open waits for the obsolete native open to finish", async () => {
    const old = deferred<WorkspaceInfo>();
    openWorkspace.mockImplementationOnce(() => old.result);
    const first = workspace.open("obsolete");
    await tick();
    workspace.destroy();
    const second = workspace.open("b");
    await tick();
    expect(openWorkspace).toHaveBeenCalledTimes(1);
    old.resolve(info("obsolete"));
    expect((await first).isErr()).toBe(true);
    await second;
    expect(openWorkspace.mock.calls).toEqual([["obsolete"], ["b"]]);
    expect(workspace.name).toBe("b");
    expect(editorMock.seedTabs).toHaveBeenCalledTimes(1);
    expect(workspace.isOpening).toBe(false);
  });
});

describe("settings hydration", () => {
  test("concurrent init callers share hydration through the settings read", async () => {
    const saved = deferred<{ editorFontSize: number }>();
    const get = mock(() => saved.promise);
    loadStore.mockImplementationOnce(async () => ({ get, set: async () => {}, save: async () => {} } as never));
    const store = new SettingsStore();
    const first = store.init();
    const second = store.init();
    let finished = false;
    void second.then(() => { finished = true; });
    await tick();
    expect(first).toBe(second);
    expect(loadStore).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    saved.resolve({ editorFontSize: 19 });
    await Promise.all([first, second]);
    expect(store.editorFontSize).toBe(19);
    await store.init();
    expect(loadStore).toHaveBeenCalledTimes(1);
  });

  test("a failed store load can be retried", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    try {
      loadStore.mockImplementationOnce(async () => { throw new Error("unavailable"); });
      const store = new SettingsStore();
      await store.init();
      await store.init();
      expect(loadStore).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally { errorLog.mockRestore(); }
  });

  test("a failed settings read can be retried and hydrated", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    try {
      loadStore.mockImplementationOnce(async () => ({ get: async () => { throw new Error("read failed"); } } as never));
      loadStore.mockImplementationOnce(async () => ({ get: async () => ({ editorFontSize: 20 }) } as never));
      const store = new SettingsStore();
      await store.init();
      await store.init();
      expect(loadStore).toHaveBeenCalledTimes(2);
      expect(store.editorFontSize).toBe(20);
    } finally { errorLog.mockRestore(); }
  });
});

describe("application listener ownership", () => {
  test("a failed native registration can retry without duplicating foreground handlers", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    try {
      workspace.init();
      registrations[0].registration.reject("offline");
      await tick();
      workspace.init();
      expect(onWorkspaceFilesChanged).toHaveBeenCalledTimes(2);
      expect(documentSurface.count("visibilitychange")).toBe(1);
    } finally { errorLog.mockRestore(); }
  });

  test("duplicate init is idempotent and late native registration releases itself", async () => {
    workspace.init();
    workspace.init();
    expect(onWorkspaceFilesChanged).toHaveBeenCalledTimes(1);
    expect(documentSurface.count("visibilitychange")).toBe(1);
    const first = registrations[0];
    workspace.destroy();
    workspace.init();
    const stop = mock(() => {});
    first.registration.resolve(stop);
    await tick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(documentSurface.count("visibilitychange")).toBe(1);
    first.handler({ changes: [{ relPath: "main.typ", kind: "modified", isDir: false }] });
    expect(editorMock.applyExternalChanges).not.toHaveBeenCalled();
  });

  test("teardown releases registered native listeners and foreground handlers", async () => {
    workspace.init();
    const stop = mock(() => {});
    registrations[0].registration.resolve(stop);
    await tick();
    workspace.destroy();
    workspace.destroy();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(documentSurface.count("visibilitychange")).toBe(0);
    documentSurface.dispatchEvent(new Event("visibilitychange"));
    expect(rescanWorkspace).not.toHaveBeenCalled();
  });

  test("app remount releases window listeners and body-lock observers without resetting navigation", async () => {
    app.init();
    app.init();
    expect(windowSurface.count("popstate")).toBe(1);
    expect(windowSurface.count("pointerdown")).toBe(1);
    expect(documentSurface.count("visibilitychange")).toBe(1);
    const observer = observers.at(-1)!;
    app.destroy();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(windowSurface.count("popstate")).toBe(0);
    expect(windowSurface.count("pointerdown")).toBe(0);
    expect(documentSurface.count("visibilitychange")).toBe(0);
    app.init();
    expect(app.screen).toBe("editor");
    expect(windowSurface.count("popstate")).toBe(1);
  });

  test("app teardown settles pending history waits and removes their temporary listeners", async () => {
    app.init();
    app.overlay = "preview";
    const closing = app.closeOverlayAsync();
    expect(windowSurface.count("popstate")).toBe(2);
    app.destroy();
    await closing;
    expect(windowSurface.count("popstate")).toBe(0);
  });

  test("app teardown cancels queued body-lock recovery checks", async () => {
    app.init();
    documentSurface.body.style.pointerEvents = "none";
    scheduleBodyLockRelease();
    app.destroy();
    await new Promise((done) => setTimeout(done, 350));
    expect(documentSurface.body.style.removeProperty).not.toHaveBeenCalled();
  });
});
