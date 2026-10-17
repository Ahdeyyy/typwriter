import { afterEach, describe, expect, mock, test } from 'bun:test';
import { errAsync, okAsync } from '../../apps/typwriter-desktop/node_modules/neverthrow';

const saved = new Map<string, [string[], string | null, Record<string, string>, number | null]>();
let backendKey: string | null = null;
let watcher: ((payload: { changes: unknown[] }) => void) | null = null;
let activation: (() => void) | null = null;
let queuedPaths: string[] = [];
const calls: string[] = [];
const saveTabs = mock((tabs: string[], active: string | null, unsaved: Record<string, string>, cursor: number | null, key: string) => {
  calls.push(`persist:${key}`);
  saved.set(key, [[...tabs], active, { ...unsaved }, cursor]);
  return okAsync();
});
const openDocument = mock((path: string, root?: string) => {
  calls.push(`open:${path}`);
  backendKey = path;
  const sourceRoot = root ?? path.slice(0, path.lastIndexOf('/'));
  const prefix = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
  return okAsync({ path, root: sourceRoot, mainFile: path.slice(prefix.length), sessionKey: path });
});
const getTabs = mock((key: string) => okAsync(saved.get(key) ?? null));
const getRequests = mock(() => {
  calls.push('drain');
  const paths = queuedPaths;
  queuedPaths = [];
  return okAsync(paths);
});
const editor = {
  tabs: [] as { id: string; relPath: string; content: string; dirty: boolean }[],
  activeTab: null as { relPath: string } | null,
  activeTabId: null as string | null,
  flushAllTabs: mock(async () => { calls.push('flush'); }),
  reset: mock(async () => { editor.tabs = []; editor.activeTab = null; editor.activeTabId = null; }),
  getTabState: () => ({
    tabs: editor.tabs.map((tab) => tab.relPath), activeTabId: editor.activeTabId, cursor: null,
    unsaved: Object.fromEntries(editor.tabs.filter((tab) => tab.dirty).map((tab) => [tab.relPath, tab.content])),
  }),
  restoreTabs: mock(async (paths: string[], active: string | null) => {
    editor.tabs = paths.map((path) => ({ id: path, relPath: path, content: '', dirty: false }));
    editor.activeTabId = active;
    editor.activeTab = active ? { relPath: active } : null;
  }),
  openFile: (path: string) => {
    editor.tabs.push({ id: path, relPath: path, content: '', dirty: false });
    editor.activeTabId = path;
    editor.activeTab = { relPath: path };
    return okAsync();
  },
  applyExternalChanges: async () => {},
};

mock.module('$lib/ipc/commands', () => ({
  openDocument, saveWorkspaceTabs: saveTabs, getWorkspaceTabs: getTabs,
  takeOpenRequests: getRequests,
  openFolder: () => okAsync(null), closeSession: () => { backendKey = null; return okAsync(); },
  getFileTree: () => okAsync([]), triggerPreview: () => okAsync(), syncPreview: () => okAsync(),
  createFile: () => okAsync(), createFolder: () => okAsync(), deleteFile: () => okAsync(),
  deleteFolder: () => okAsync(), moveFile: () => okAsync(), moveFolder: () => okAsync(),
  renameFile: () => okAsync(), setMainFile: () => okAsync(),
}));
mock.module('$lib/ipc/events', () => ({
  onWorkspaceFilesChanged: (handler: typeof watcher) => { watcher = handler; return okAsync(() => { watcher = null; }); },
  onDocumentDependenciesChanged: () => okAsync(() => {}),
  onAppOpenFiles: (handler: () => void) => {
    calls.push('subscribe'); activation = handler; return okAsync(() => { activation = null; });
  },
}));
mock.module('../../apps/typwriter-desktop/src/lib/stores/editor.svelte.ts', () => ({ editor }));
mock.module('../../apps/typwriter-desktop/src/lib/stores/preview.svelte.ts', () => ({ preview: { clear: () => {} } }));
mock.module('../../apps/typwriter-desktop/src/lib/stores/bibliography.svelte.ts', () => ({ bibliography: { clear: () => {}, refresh: async () => {} } }));
mock.module('../../apps/typwriter-desktop/src/lib/stores/document-scope.svelte.ts', () => ({ documentScope: { clear: () => {}, refresh: async () => {} } }));
mock.module('../../apps/typwriter-desktop/src/lib/stores/snippets.svelte.ts', () => ({ snippets: { reset: () => {}, refresh: async () => {} } }));
const navigate = mock(() => {});
const pageState = { current: { name: 'home' }, navigate };
mock.module('../../apps/typwriter-desktop/src/lib/stores/page.svelte.ts', () => ({ page: pageState }));
const finishTutorial = mock(() => { calls.push('finish-tutorial'); return okAsync(); });
mock.module('../../apps/typwriter-desktop/src/lib/stores/onboarding.svelte.ts', () => ({ onboarding: { finish: finishTutorial } }));
mock.module('$lib/services/workspace-file-service', () => ({ importFilesToWorkspace: async () => {} }));
mock.module('$lib/services/drop-import', () => ({ importDroppedFiles: async () => [] }));
mock.module('@tauri-apps/plugin-dialog', () => ({ open: async () => null }));
mock.module('$lib/windows', () => ({ closeDiffWindow: async () => {} }));
mock.module('$lib/logger', () => ({ logError: () => {} }));
const showError = mock(() => {});
mock.module('svelte-sonner', () => ({ toast: { error: showError } }));

const { workspace } = await import('../../apps/typwriter-desktop/src/lib/stores/workspace.svelte');
const { openDocumentPath, initializeDocumentOpening, destroyDocumentOpening } = await import('../../apps/typwriter-desktop/src/lib/services/document-opening');

afterEach(async () => {
  destroyDocumentOpening();
  await workspace.leave();
  saved.clear(); queuedPaths = []; calls.length = 0;
  pageState.current.name = 'home'; finishTutorial.mockClear();
  openDocument.mockClear(); saveTabs.mockClear(); getTabs.mockClear(); getRequests.mockClear();
  navigate.mockClear(); showError.mockClear(); editor.restoreTabs.mockClear();
});

describe('standalone document sessions', () => {
  test('two documents in one folder persist and restore under separate identities', async () => {
    expect((await workspace.openDocument('/docs/a.typ')).isOk()).toBe(true);
    editor.tabs[0].content = 'unsaved A'; editor.tabs[0].dirty = true;
    expect((await workspace.openDocument('/docs/b.typ')).isOk()).toBe(true);
    expect(saved.get('/docs/a.typ')?.[2]).toEqual({ 'a.typ': 'unsaved A' });
    expect(saved.get('/docs/b.typ')?.[0]).toEqual(['b.typ']);
    expect(getTabs.mock.calls.map(([key]) => key)).toEqual(['/docs/a.typ', '/docs/b.typ']);
    expect(workspace.documentPath).toBe('/docs/b.typ');
    expect(workspace.rootPath).toBe('/docs');
    expect(backendKey).toBe('/docs/b.typ');
  });

  test('a failed flush leaves the current document and buffers intact', async () => {
    await workspace.openDocument('/docs/a.typ');
    editor.flushAllTabs.mockImplementationOnce(async () => { throw new Error('read-only source'); });
    const result = await workspace.openDocument('/docs/b.typ');
    expect(result.isErr()).toBe(true);
    expect(workspace.documentPath).toBe('/docs/a.typ');
    expect(backendKey).toBe('/docs/a.typ');
    expect(editor.tabs[0].relPath).toBe('a.typ');
    expect(workspace.hydrating).toBe(false);
    expect(openDocument).toHaveBeenCalledTimes(1);
  });

  test('failed recovery persistence prevents switching away from the current document', async () => {
    await workspace.openDocument('/docs/a.typ');
    editor.tabs[0].content = 'important edits'; editor.tabs[0].dirty = true;
    saveTabs.mockImplementationOnce(() => errAsync('Storage is full'));
    const result = await workspace.openDocument('/docs/b.typ');
    expect(result.isErr()).toBe(true);
    expect(workspace.documentPath).toBe('/docs/a.typ');
    expect(backendKey).toBe('/docs/a.typ');
    expect(editor.tabs[0].content).toBe('important edits');
    expect(openDocument).toHaveBeenCalledTimes(1);
  });

  test('a root change flushes old paths and opens the main source relative to the new root', async () => {
    await workspace.openDocument('/docs/chapter/main.typ');
    await workspace.openDocument('/docs/chapter/main.typ', '/docs');
    expect(workspace.mainFile).toBe('chapter/main.typ');
    expect(editor.tabs.map((tab) => tab.relPath)).toEqual(['chapter/main.typ']);
    expect(saved.get('/docs/chapter/main.typ')?.[0]).toEqual(['chapter/main.typ']);
    expect(getTabs).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('flush')).toBeLessThan(calls.indexOf('open:/docs/chapter/main.typ'));
  });

  test('invalid open requests preserve the active session', async () => {
    await workspace.openDocument('/docs/a.typ');
    openDocument.mockImplementationOnce(() => errAsync('File does not exist'));
    await openDocumentPath('/docs/missing.typ');
    expect(workspace.documentPath).toBe('/docs/a.typ');
    expect(editor.tabs[0].relPath).toBe('a.typ');
    expect(showError).toHaveBeenCalledTimes(1);
  });

  test('duplicate activations coalesce and startup subscribes before draining', async () => {
    queuedPaths = ['/docs/a.typ', '/docs/a.typ'];
    expect(await initializeDocumentOpening()).toBe(true);
    expect(calls[0]).toBe('subscribe');
    expect(calls[1]).toBe('drain');
    expect(openDocument).toHaveBeenCalledTimes(1);
    const first = openDocumentPath('/docs/b.typ');
    const second = openDocumentPath('/docs/b.typ');
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(openDocument).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  test('a standalone main removal retains the compilation target', async () => {
    await workspace.openDocument('/docs/a.typ');
    watcher?.({ changes: [{ kind: 'removed', path: '/docs/a.typ', isDir: false }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workspace.mainFile).toBe('a.typ');
    expect(workspace.documentPath).toBe('/docs/a.typ');
  });

  test('documents in drive and filesystem roots resolve without duplicate separators', async () => {
    await workspace.openDocument('C:/file.typ', 'C:/');
    expect(workspace.mainFile).toBe('file.typ');
    expect(workspace.toAbs('file.typ')).toBe('C:/file.typ');
    expect(workspace.toRel('C:/file.typ')).toBe('file.typ');
    await workspace.openDocument('/file.typ', '/');
    expect(workspace.mainFile).toBe('file.typ');
    expect(workspace.toAbs('file.typ')).toBe('/file.typ');
    expect(workspace.toRel('/file.typ')).toBe('file.typ');
  });

  test('OS activation finishes the tutorial before replacing its compiler world', async () => {
    pageState.current.name = 'onboarding';
    await openDocumentPath('/docs/a.typ');
    expect(finishTutorial).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('finish-tutorial')).toBeLessThan(calls.indexOf('open:/docs/a.typ'));
    expect(workspace.documentPath).toBe('/docs/a.typ');
  });
});
