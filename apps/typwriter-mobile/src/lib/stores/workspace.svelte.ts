// Workspace list + open workspace + file-tree state. Every file-op method
// replaces `tree` with the root node the command returns, so the UI never
// patches the tree client-side.

import { ResultAsync, okAsync } from "neverthrow";
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
  private rescanBound = false;

  refreshList(): ResultAsync<void, string> {
    return ipc.listWorkspaces().map((list) => {
      this.workspaces = list;
    });
  }

  create(name: string): ResultAsync<void, string> {
    return ipc.createWorkspace(name).andThen(() => this.refreshList());
  }

  delete(name: string): ResultAsync<void, string> {
    return ipc.deleteWorkspace(name).andThen(() => this.refreshList());
  }

  open(name: string): ResultAsync<WorkspaceInfo, string> {
    return ipc.openWorkspace(name).map((info) => {
      this.name = info.name;
      this.root = info.root;
      this.tree = info.tree;
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
      void this.listenForExternalChanges();
      this.watchForeground();
      return info;
    });
  }

  /**
   * Switch to another workspace without going home. The pending buffer is
   * written *before* the backend switches roots (a flush afterwards would save
   * the old file's text at the same relative path inside the new workspace),
   * and the tab state is dropped for the same reason.
   */
  switchTo(name: string): ResultAsync<void, string> {
    if (name === this.name) return okAsync(undefined);
    return editor
      .flush()
      .andThen(() => {
        editor.resetTabs();
        return this.open(name).map(() => undefined);
      })
      .mapErr((e) => {
        // `open_workspace` swaps the backend root *before* it can still fail
        // (resolving the main file, writing metadata), so a failure leaves us
        // unable to say which workspace we are in. Restoring the old tabs would
        // then re-read — and later save — the previous workspace's paths against
        // the new root, which is exactly the corruption `resetTabs` above exists
        // to prevent. Home is the only root-agnostic screen; drop to it and let
        // the user pick again. `lastWorkspace` is deliberately left alone, so a
        // relaunch re-opens it and re-syncs the backend either way.
        app.goHome();
        return e;
      });
  }

  /** Close the current workspace and return home, clearing the auto-open hint. */
  close() {
    settings.setLastWorkspace(null);
    app.goHome();
  }

  // ─── External (on-disk) changes ─────────────────────────────────────────

  /** Subscribe to the backend watcher. Idempotent: re-opening a workspace keeps
   *  the one listener, since the event carries no workspace of its own and the
   *  backend only ever watches the current root. */
  private async listenForExternalChanges(): Promise<void> {
    if (this.filesChangedUnlisten) return;
    const result = await onWorkspaceFilesChanged((payload) => {
      this.applyExternalChanges(payload.changes);
    });
    if (result.isOk()) {
      this.filesChangedUnlisten = result.value;
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
    if (!this.root || app.screen !== "editor") return;
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
    if (this.rescanBound || typeof document === "undefined") return;
    this.rescanBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (!this.root || app.screen !== "editor") return;
      void ipc.rescanWorkspace().map((tree) => {
        this.replaceTree(tree);
        compileStore.onSaved();
        // A file the user edited elsewhere is the whole reason for this path;
        // a clean buffer should show it rather than the text from before.
        if (!editor.dirty) void editor.reloadActiveFromDisk();
      });
    });
  }

  refreshTree(): ResultAsync<void, string> {
    return ipc.getFileTree().map((tree) => this.replaceTree(tree));
  }

  setMain(relPath: string): ResultAsync<void, string> {
    return ipc.setMainFile(relPath).andThen(() => {
      this.mainFile = relPath;
      // A new main file is a new document identity. Persist any pending edits
      // first (the compiler reads from disk), then drop the stale render and
      // rebuild the preview in the background so it's ready when next opened.
      return editor.flush().map(() => compileStore.onMainChanged());
    });
  }

  private replaceTree(next: FileNode) {
    this.tree = next;
  }

  createFile(relPath: string): ResultAsync<void, string> {
    return ipc.createFile(relPath).map((t) => this.replaceTree(t));
  }
  createFolder(relPath: string): ResultAsync<void, string> {
    return ipc.createFolder(relPath).map((t) => this.replaceTree(t));
  }

  /**
   * Rename an entry, then move everything that referenced it by path.
   *
   * The buffer is flushed *first*: a flush afterwards would still be aimed at
   * the old path (recreating the file the rename just removed), and the renamed
   * file would keep the pre-edit text.
   */
  renameEntry(relPath: string, newName: string): ResultAsync<void, string> {
    return editor
      .flush()
      .andThen(() => ipc.renameEntry(relPath, newName))
      .map((change) => this.applyEntryChange(change));
  }

  /** Move an entry into another folder. Flushes first, for the same reason as
   *  {@link renameEntry}. */
  moveEntry(relPath: string, newParentRel: string): ResultAsync<void, string> {
    return editor
      .flush()
      .andThen(() => ipc.moveEntry(relPath, newParentRel))
      .map((change) => this.applyEntryChange(change));
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
    return editor
      .abandonWrites(relPath)
      .andThen(() => ipc.deleteEntry(relPath))
      .map((change) => this.applyEntryChange(change));
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
