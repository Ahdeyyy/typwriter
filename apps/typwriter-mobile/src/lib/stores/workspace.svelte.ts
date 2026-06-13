// Workspace list + open workspace + file-tree state. Every file-op method
// replaces `tree` with the root node the command returns, so the UI never
// patches the tree client-side.

import { ResultAsync } from "neverthrow";
import type { FileNode, WorkspaceInfo, WorkspaceMeta } from "$lib/ipc/types";
import * as ipc from "$lib/ipc/commands";
import { app } from "./app.svelte";
import { editor } from "./editor.svelte";

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
      app.openEditor();
      const initial = info.lastFile ?? info.mainFile;
      if (initial) void editor.loadFile(initial);
      return info;
    });
  }

  setMain(relPath: string): ResultAsync<void, string> {
    return ipc.setMainFile(relPath).map(() => {
      this.mainFile = relPath;
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
