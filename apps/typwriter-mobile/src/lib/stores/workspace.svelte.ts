// Workspace list + open workspace + file-tree state. Every file-op method
// replaces `tree` with the root node the command returns, so the UI never
// patches the tree client-side.

import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { toast } from "svelte-sonner";
import type {
  EntryChange,
  FileNode,
  SyncStatus,
  WorkspaceFileChange,
  WorkspaceInfo,
  WorkspaceMeta,
} from "#lib/ipc/types.ts";
import * as ipc from "#lib/ipc/commands.ts";
import { onSyncStatus, onWorkspaceFilesChanged, type UnlistenFn } from "#lib/ipc/events.ts";
import { remapPath } from "#lib/paths.ts";
import { app } from "./app.svelte";
import { editor } from "./editor.svelte";
import { settings } from "./settings.svelte";
import { compileStore } from "./compile.svelte";

class WorkspaceStore {
  workspaces = $state<WorkspaceMeta[]>([]);
  /** Where "New workspace" creates folders, or null before the user chose. */
  location = $state<string | null>(null);
  /** The open workspace's id (`app:<name>` / `folder:<hex>`); empty for a
   *  standalone document. Names are not unique once workspaces can live in
   *  any folder, so everything that picks a workspace goes by this. */
  id = $state<string | null>(null);
  name = $state<string | null>(null);
  /** The open folder workspace's sync, or null when none is running. Drives
   *  the (small) sync indicator, which is on screen exactly while it runs. */
  sync = $state<SyncStatus | null>(null);
  /** The sync details sheet (`sync-details.svelte`). One flag, so the
   *  indicator, the header alert and the toast's "Details" all open it. */
  syncDetailsOpen = $state(false);
  root = $state<string | null>(null);
  tree = $state<FileNode | null>(null);
  mainFile = $state<string | null>(null);
  document = $state(false);

  private filesChangedUnlisten: UnlistenFn | null = null;
  private syncStatusUnlisten: UnlistenFn | null = null;
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
      void this.listenForSyncStatus(this.listenerGeneration);
    }
    if (!this.filesChangedUnlisten && !this.listenerPending) {
      void this.listenForExternalChanges(this.listenerGeneration);
    }
  }

  private async listenForSyncStatus(generation: number): Promise<void> {
    const result = await onSyncStatus((status) => {
      if (generation !== this.listenerGeneration) return;
      this.applySyncStatus(status);
    });
    if (result.isErr()) {
      console.error("onSyncStatus listener failed:", result.error);
      return;
    }
    if (generation === this.listenerGeneration) this.syncStatusUnlisten = result.value;
    else result.value();
  }

  /** Track a sync status. Starting, stopping and routine syncs only move the
   *  small indicator; a toast appears for just two things: the first copy of
   *  a folder (the editor isn't on screen yet, so the indicator can't show
   *  it), and the folder becoming unreachable or reachable again. */
  private applySyncStatus(status: SyncStatus) {
    const previous = this.sync?.workspaceId === status.workspaceId ? this.sync : null;
    const progressToast = `folder-sync-progress:${status.workspaceId}`;

    if (status.state === "stopped") {
      toast.dismiss(progressToast);
      if (this.sync?.workspaceId === status.workspaceId) {
        this.sync = null;
        this.syncDetailsOpen = false;
      }
      return;
    }

    const opening = app.screen !== "editor";
    if (opening && status.state === "syncing" && status.total !== null && status.total >= 3) {
      toast.loading(`Copying ${status.done ?? 0} of ${status.total} files`, {
        id: progressToast,
        description: `From ${status.location}`,
      });
    } else if (status.state !== "syncing") {
      toast.dismiss(progressToast);
    }

    if (status.state === "offline" && previous?.state !== "offline") {
      // Goes away on its own like any toast; "Details" (and the red header
      // button that stays while offline) bring the explanation back.
      toast.error(`Can't reach ${status.location}`, {
        description: "Saving fails until the folder is back.",
        action: { label: "Details", onClick: () => (this.syncDetailsOpen = true) },
      });
    } else if (previous?.state === "offline" && status.state === "synced") {
      toast.success(`${status.location} is back`, { description: "Syncing again." });
    }

    this.sync = status;
  }

  /** Stop syncing the open folder workspace — the user left it for home. */
  stopSync(): ResultAsync<void, string> {
    if (!this.sync) return okAsync(undefined);
    return ipc.stopFolderSync().map(() => undefined);
  }

  /** Pull the folder now ("Sync now", resuming, and right after opening from
   *  the last synced copy), then show what changed. */
  syncNow(): ResultAsync<void, string> {
    const generation = this.generation;
    const root = this.root;
    if (!this.ownsWorkspace(generation, root) || app.screen !== "editor") return okAsync(undefined);
    const request = ++this.treeRequest;
    return ipc.rescanWorkspace().map((tree) => {
      if (!this.ownsWorkspace(generation, root) || request !== this.treeRequest) return;
      if (app.screen !== "editor") return;
      this.replaceTree(tree);
      compileStore.onSaved();
      // A file edited elsewhere is the whole reason for this path; a clean
      // buffer should show it rather than the text from before.
      if (!editor.dirty) void editor.reloadActiveFromDisk(false);
    });
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
    this.syncStatusUnlisten?.();
    this.syncStatusUnlisten = null;
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

  refreshLocation(): ResultAsync<void, string> {
    return ipc.getWorkspaceLocation().map((label) => {
      this.location = label;
    });
  }

  /** Ask where new workspaces go. Resolves to false if the user cancelled. */
  pickLocation(): ResultAsync<boolean, string> {
    return ipc.pickWorkspaceLocation().map((label) => {
      if (label !== null) this.location = label;
      return label !== null;
    });
  }

  /** Create a workspace — in app storage, or with `inFolder` as a new folder
   *  in {@link location} that it syncs with; resolves to its id. */
  create(name: string, inFolder: boolean): ResultAsync<string, string> {
    return ipc
      .createWorkspace(name, inFolder)
      .andThen((meta) => this.refreshList().map(() => meta.id));
  }

  /** List an existing folder as a workspace; resolves to its id, or null if
   *  the user cancelled the picker. */
  addFolder(): ResultAsync<string | null, string> {
    return ipc
      .addFolderWorkspace()
      .andThen((meta) => (meta ? this.refreshList().map(() => meta.id) : okAsync(null)));
  }

  /** Delete an app-storage workspace, or take a folder workspace off the list. */
  delete(id: string): ResultAsync<void, string> {
    return ipc.deleteWorkspace(id).andThen(() => {
      if (settings.lastWorkspace === id) settings.setLastWorkspace(null);
      return this.refreshList();
    });
  }

  /** Start syncing one workspace: move it from app storage into a folder
   *  the user picks. Resolves to its new id, or null if they cancelled. */
  moveToFolder(id: string): ResultAsync<string | null, string> {
    return ipc.moveWorkspaceToFolder(id).andThen((moved) => {
      if (!moved) return okAsync(null);
      this.followMove(moved.from, moved.to);
      return this.refreshList()
        .andThen(() => this.refreshLocation())
        .map(() => moved.to);
    });
  }

  /** Stop syncing one workspace: bring it back into app storage. The folder
   *  keeps its files. Resolves to the workspace's new id. */
  moveToApp(id: string): ResultAsync<string, string> {
    return ipc.moveWorkspaceToApp(id).andThen((moved) => {
      this.followMove(moved.from, moved.to);
      return this.refreshList().map(() => moved.to);
    });
  }

  /** The reopen-on-launch hint follows its workspace to its new id (it may
   *  still be a bare name saved by an older build). */
  private followMove(from: string, to: string) {
    const last = settings.lastWorkspace;
    if (last === from || `app:${last}` === from) settings.setLastWorkspace(to);
  }

  open(id: string): ResultAsync<WorkspaceInfo, string> {
    return this.openSession(() => ipc.openWorkspace(id));
  }

  openDocument(uri: string): ResultAsync<WorkspaceInfo, string> {
    // Native document validation finishes before it replaces the session, so
    // rejected names/URIs can safely restore the saved editor tabs.
    return this.openSession(() => ipc.openDocument(uri), true);
  }

  pickDocument(): ResultAsync<WorkspaceInfo | null, string> {
    // Own navigation before Android hides the webview. Otherwise startup
    // restore and the foreground rescan can still open/read the old workspace
    // while the user is choosing its replacement.
    return this.openSession(() => ipc.pickDocument(), true);
  }

  private openSession<T extends WorkspaceInfo | null>(
    load: () => ResultAsync<T, string>,
    preserveOnFailure = false,
  ): ResultAsync<T, string> {
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
      const tabs = preserveOnFailure ? [...editor.tabs] : [];
      const active = editor.newTabOpen ? null : editor.relPath;
      const cursor = editor.view?.state.selection.main.head ?? null;
      editor.resetTabs();
      const restore = () => {
        if (preserveOnFailure && generation === this.generation) {
          this.changing = false;
          editor.seedTabs(tabs, active, cursor);
        }
      };
      return load().orTee(restore).andTee((info) => {
        if (info === null) restore();
      });
    }).andThen((info) => {
      if (generation !== this.generation) return errAsync("Workspace opening was canceled");
      if (info === null) return okAsync(info);
      this.changing = false;
      this.id = info.id || null;
      this.name = info.name;
      this.root = info.root;
      this.replaceTree(info.tree);
      this.mainFile = info.mainFile;
      this.document = info.document ?? false;
      settings.setLastWorkspace(this.document ? null : info.id);
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
      // A folder workspace opens straight from its last synced copy for speed;
      // catch up with the folder now that the editor can show what changes.
      if (info.id?.startsWith("folder:")) {
        void ipc.getSyncStatus().map((status) => {
          if (status && generation === this.generation) this.applySyncStatus(status);
        });
        void this.syncNow().mapErr((e) => console.error("folder sync:", e));
      }
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
  switchTo(id: string): ResultAsync<void, string> {
    if (!this.document && id === this.id) return okAsync(undefined);
    const opening = this.open(id);
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
      const visible = target.visibilityState === "visible";
      // A folder workspace polls nothing while the app is hidden (battery);
      // coming back resumes it and catches up at once, below.
      if (this.sync) void ipc.setSyncPaused(!visible).mapErr((e) => console.error("sync pause:", e));
      if (!visible) return;
      void this.syncNow();
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
