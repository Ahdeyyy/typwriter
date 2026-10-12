// Workspace list + open workspace + file-tree state. Every file-op method
// replaces `tree` with the root node the command returns, so the UI never
// patches the tree client-side.

import { ResultAsync, errAsync, okAsync } from "neverthrow";
import type {
  EntryChange,
  FileNode,
  WorkspaceFileChange,
  WorkspaceInfo,
  WorkspaceMeta,
} from "$lib/ipc/types";
import * as ipc from "$lib/ipc/commands";
import { onWorkspaceFilesChanged, type UnlistenFn } from "$lib/ipc/events";
import { remapPath } from "$lib/paths";
import { app } from "./app.svelte";
import { editor } from "./editor.svelte";
import { settings } from "./settings.svelte";
import { compileStore } from "./compile.svelte";

class WorkspaceStore {
  workspaces = $state<WorkspaceMeta[]>([]);
  name = $state<string | null>(null);
  root = $state<string | null>(null);
  tree = $state<FileNode | null>(null);
  mainFile = $state<string | null>(null);

  private filesChangedUnlisten: UnlistenFn | null = null;
  private foregroundUnlisten: (() => void) | null = null;
  private initialized = false;
  private listenerPending = false;
  private listenerGeneration = 0;
  private generation = 0;
  private treeRequest = 0;
  private listRequest = 0;
  private changing = false;
  private pendingOpens = 0;
  private openQueue: Promise<void> = Promise.resolve();

  /** Own the native and foreground listeners for the mounted application. */
  init() {
    if (typeof document === "undefined") return;
    if (!this.initialized) {
      this.initialized = true;
      this.listenerGeneration++;
      this.watchForeground();
    }
    if (!this.filesChangedUnlisten && !this.listenerPending) {
      void this.listenForExternalChanges(this.listenerGeneration);
    }
  }

  destroy() {
    this.initialized = false;
    this.listenerGeneration++;
    this.listenerPending = false;
    this.generation++;
    this.treeRequest++;
    this.listRequest++;
    this.filesChangedUnlisten?.();
    this.filesChangedUnlisten = null;
    this.foregroundUnlisten?.();
    this.foregroundUnlisten = null;
  }

  get isOpening(): boolean {
    return this.changing;
  }

  /** Startup captures this so user navigation can supersede auto-restore. */
  get version(): number {
    return this.generation;
  }

  private ownsWorkspace(generation: number, root: string | null): boolean {
    return !this.changing && !!root && generation === this.generation && root === this.root;
  }

  refreshList(): ResultAsync<void, string> {
    const request = ++this.listRequest;
    return ipc.listWorkspaces().map((list) => {
      if (request === this.listRequest) this.workspaces = list;
    });
  }

  create(name: string): ResultAsync<void, string> {
    return ipc.createWorkspace(name).andThen(() => this.refreshList());
  }

  delete(name: string): ResultAsync<void, string> {
    return ipc.deleteWorkspace(name).andThen(() => this.refreshList());
  }

  open(name: string): ResultAsync<WorkspaceInfo, string> {
    const generation = ++this.generation;
    this.treeRequest++;
    this.changing = true;
    this.pendingOpens++;
    // Native workspace commands share one root. Finish an already dispatched
    // open before starting the next, even if its UI owner has been destroyed.
    const run = ResultAsync.fromSafePromise(this.openQueue).andThen(() => {
      if (generation !== this.generation) return errAsync("Workspace opening was canceled");
      return editor.flush();
    }).andThen(() => {
      if (generation !== this.generation) return errAsync("Workspace opening was canceled");
      editor.resetTabs();
      return ipc.openWorkspace(name);
    }).andThen((info) => {
      if (generation !== this.generation) return errAsync("Workspace opening was canceled");
      this.changing = false;
      this.name = info.name;
      this.root = info.root;
      this.replaceTree(info.tree);
      this.mainFile = info.mainFile;
      settings.setLastWorkspace(info.name);
      app.openEditor();
      // Seed open tabs (persisted), falling back to last/main file.
      const initialTabs = info.openTabs?.length
        ? info.openTabs
        : [info.lastFile ?? info.mainFile].filter((f): f is string => !!f);
      const active = info.activeTab ?? info.lastFile ?? info.mainFile ?? initialTabs[0] ?? null;
      // The caret belongs to `activeTab`; if we had to fall back to another
      // file, open it at the top.
      const cursor = active && active === info.activeTab ? info.cursor : null;
      editor.seedTabs(initialTabs, active, cursor);
      // The preview must never show a previous workspace's pages.
      compileStore.onWorkspaceOpened(!!info.mainFile);
      // Retry a failed native subscription on the next workspace open.
      this.init();
      return okAsync(info);
    }).andTee(() => this.finishOpen()).orTee(() => this.finishOpen());
    this.openQueue = Promise.resolve(run).then(() => undefined);
    return run;
  }

  private finishOpen() {
    this.pendingOpens--;
    if (!this.pendingOpens) this.changing = false;
  }

  /**
   * Switch to another workspace without going home. The pending buffer is
   * written *before* the backend switches roots (a flush afterwards would save
   * the old file's text at the same relative path inside the new workspace),
   * and the tab state is dropped for the same reason.
   */
  switchTo(name: string): ResultAsync<void, string> {
    if (name === this.name) return okAsync(undefined);
    const opening = this.open(name);
    const generation = this.generation;
    return opening
      .map(() => undefined)
      .mapErr((e) => {
        // `open_workspace` swaps the backend root *before* it can still fail
        // (resolving the main file, writing metadata), so a failure leaves us
        // unable to say which workspace we are in. Restoring the old tabs would
        // then re-read — and later save — the previous workspace's paths against
        // the new root, which is exactly the corruption `resetTabs` in `open` exists
        // to prevent. Home is the only root-agnostic screen; drop to it and let
        // the user pick again. `lastWorkspace` is deliberately left alone, so a
        // relaunch re-opens it and re-syncs the backend either way.
        if (generation === this.generation) app.goHome();
        return e;
      });
  }

  /** Close the current workspace and return home, clearing the auto-open hint. */
  close() {
    this.generation++;
    this.treeRequest++;
    settings.setLastWorkspace(null);
    app.goHome();
  }

  // ─── External (on-disk) changes ─────────────────────────────────────────

  /** A registration resolving after teardown must release itself immediately. */
  private async listenForExternalChanges(generation: number): Promise<void> {
    this.listenerPending = true;
    const result = await onWorkspaceFilesChanged((payload) => {
      if (generation !== this.listenerGeneration) return;
      this.applyExternalChanges(payload.changes);
    });
    if (generation === this.listenerGeneration) this.listenerPending = false;
    if (result.isOk()) {
      if (generation === this.listenerGeneration) this.filesChangedUnlisten = result.value;
      else result.value();
    } else {
      console.error("onWorkspaceFilesChanged listener failed:", result.error);
    }
  }

  private applyExternalChanges(changes: WorkspaceFileChange[]) {
    if (!changes.length) return;
    // The backend keeps polling the last root it was given, including after the
    // user has gone home — where there is no tree on screen, no open buffer, and
    // possibly no workspace any more (they may have just deleted it). Opening
    // one rebuilds all of this from scratch, so there is nothing to reconcile.
    if (this.changing || !this.root || app.screen !== "editor") return;
    void this.refreshTree();

    // A main file deleted out from under us would otherwise leave every compile
    // failing on a document that no longer exists.
    for (const change of changes) {
      if (change.kind !== "removed" || !this.mainFile) continue;
      if (remapPath(this.mainFile, change.relPath, null).kind === "gone") {
        this.mainFile = null;
        compileStore.clear();
      }
    }

    editor.applyExternalChanges(changes);
    // Disk is what the compiler reads, so anything that changed there makes the
    // current render stale — whether or not a buffer was involved.
    compileStore.onSaved();
  }

  /** Re-read the tree whenever the app comes back to the foreground.
   *
   *  Android is free to freeze a backgrounded process, so the poll watcher may
   *  simply not have been running while the user was in their file manager —
   *  and the snapshot it resumes from is the one it took before the freeze.
   *  Coming back is also exactly when a user expects to see what they just did
   *  elsewhere, so asking outright is worth one round-trip. */
  private watchForeground() {
    const target = document;
    const onVisibility = () => {
      if (target.visibilityState !== "visible") return;
      const generation = this.generation;
      const root = this.root;
      if (!this.ownsWorkspace(generation, root) || app.screen !== "editor") return;
      const request = ++this.treeRequest;
      void ipc.rescanWorkspace().map((tree) => {
        if (!this.ownsWorkspace(generation, root) || request !== this.treeRequest) return;
        if (app.screen !== "editor") return;
        this.replaceTree(tree);
        compileStore.onSaved();
        // A file the user edited elsewhere is the whole reason for this path;
        // a clean buffer should show it rather than the text from before.
        if (!editor.dirty) void editor.reloadActiveFromDisk(false);
      });
    };
    target.addEventListener("visibilitychange", onVisibility);
    this.foregroundUnlisten = () => target.removeEventListener("visibilitychange", onVisibility);
  }

  refreshTree(): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root)) return okAsync(undefined);
    const request = ++this.treeRequest;
    return ipc.getFileTree().map((tree) => {
      if (this.ownsWorkspace(generation, root) && request === this.treeRequest) this.replaceTree(tree);
    });
  }

  setMain(relPath: string): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace is not ready");
    return editor.flush().andThen(() => {
      if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace changed");
      return ipc.setMainFile(relPath);
    }).andThen(() => {
      if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace changed");
      this.mainFile = relPath;
      // A new main file is a new document identity. Persist any pending edits
      // first (the compiler reads from disk), then drop the stale render and
      // rebuild the preview in the background so it's ready when next opened.
      compileStore.onMainChanged();
      return okAsync(undefined);
    });
  }

  private replaceTree(next: FileNode) {
    this.treeRequest++;
    this.tree = next;
  }

  createFile(relPath: string): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace is not ready");
    return ipc.createFile(relPath).andThen((tree) => {
      if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace changed");
      this.replaceTree(tree);
      return okAsync(undefined);
    });
  }
  createFolder(relPath: string): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace is not ready");
    return ipc.createFolder(relPath).andThen((tree) => {
      if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace changed");
      this.replaceTree(tree);
      return okAsync(undefined);
    });
  }

  /**
   * Rename an entry, then move everything that referenced it by path.
   *
   * The buffer is flushed *first*: a flush afterwards would still be aimed at
   * the old path (recreating the file the rename just removed), and the renamed
   * file would keep the pre-edit text.
   */
  renameEntry(relPath: string, newName: string): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace is not ready");
    return editor
      .flush()
      .andThen(() => this.ownsWorkspace(generation, root)
        ? ipc.renameEntry(relPath, newName) : errAsync("Workspace changed"))
      .andThen((change) => {
        if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace changed");
        this.applyEntryChange(change);
        return okAsync(undefined);
      });
  }

  /** Move an entry into another folder. Flushes first, for the same reason as
   *  {@link renameEntry}. */
  moveEntry(relPath: string, newParentRel: string): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace is not ready");
    return editor
      .flush()
      .andThen(() => this.ownsWorkspace(generation, root)
        ? ipc.moveEntry(relPath, newParentRel) : errAsync("Workspace changed"))
      .andThen((change) => {
        if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace changed");
        this.applyEntryChange(change);
        return okAsync(undefined);
      });
  }

  /**
   * Delete an entry.
   *
   * Deliberately does *not* flush — saving a file that is about to be removed
   * would only recreate it. But not *starting* a write isn't the same as not
   * having one in flight, and a save already crossing IPC can land after the
   * unlink. `abandonWrites` drops the buffer up front and waits for any such
   * write to settle, so the delete is always the last word on that path.
   */
  deleteEntry(relPath: string): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace is not ready");
    return editor
      .abandonWrites(relPath)
      .andThen(() => this.ownsWorkspace(generation, root)
        ? ipc.deleteEntry(relPath) : errAsync("Workspace changed"))
      .andThen((change) => {
        if (!this.ownsWorkspace(generation, root)) return errAsync("Workspace changed");
        this.applyEntryChange(change);
        return okAsync(undefined);
      });
  }

  /**
   * Fan a rename / move / delete out across everything that holds a path: the
   * tree, the main file, the open tabs, and the preview.
   *
   * The backend has already rewritten the persisted metadata and resynced the
   * compiler's main file; this brings the live UI state in line with it.
   */
  private applyEntryChange(change: EntryChange) {
    this.replaceTree(change.tree);

    const main = this.mainFile ? remapPath(this.mainFile, change.from, change.to) : null;
    if (main?.kind === "moved") this.mainFile = main.to;
    else if (main?.kind === "gone") this.mainFile = null;

    editor.applyEntryChange(change.from, change.to);

    if (main?.kind === "gone") {
      // Nothing left to compile; the old pages describe a document that no
      // longer exists.
      compileStore.clear();
    } else if (main?.kind === "moved") {
      // Same content, new identity — rebuild so the preview's spans point at
      // the file under its new name.
      compileStore.onMainChanged();
    } else if (main) {
      // Some other file changed. It may well be one the document imports, so
      // treat it like a save: mark stale, refresh if the preview is open.
      compileStore.onSaved();
    }
    // `main === null`: no main file is set at all, so there is nothing to
    // compile — scheduling one here could only fail.
  }

  /** Flat list of all directory relPaths (for the "Move to…" picker). */
  allFolders(): { name: string; relPath: string }[] {
    const out: { name: string; relPath: string }[] = [{ name: "/ (root)", relPath: "" }];
    const walk = (node: FileNode) => {
      for (const child of node.children) {
        if (child.isDir) {
          out.push({ name: child.relPath, relPath: child.relPath });
          walk(child);
        }
      }
    };
    if (this.tree) walk(this.tree);
    return out;
  }
}

export const workspace = new WorkspaceStore();
