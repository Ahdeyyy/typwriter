// Workspace list + open workspace + file-tree state. Every file-op method
// replaces `tree` with the root node the command returns, so the UI never
// patches the tree client-side.

import { ResultAsync, okAsync } from "neverthrow";
import type { FileNode, WorkspaceInfo, WorkspaceMeta } from "$lib/ipc/types";
import * as ipc from "$lib/ipc/commands";
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
  renameEntry(relPath: string, newName: string): ResultAsync<void, string> {
    return ipc.renameEntry(relPath, newName).map((t) => this.replaceTree(t));
  }
  moveEntry(relPath: string, newParentRel: string): ResultAsync<void, string> {
    return ipc.moveEntry(relPath, newParentRel).map((t) => this.replaceTree(t));
  }
  deleteEntry(relPath: string): ResultAsync<void, string> {
    return ipc.deleteEntry(relPath).map((t) => this.replaceTree(t));
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
