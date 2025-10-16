import { getFolderName, joinFsPath } from "@/utils";
import { create, mkdir, readDir } from "@tauri-apps/plugin-fs";
import { open as OpenDialog, confirm } from "@tauri-apps/plugin-dialog";
import { toast } from "svelte-sonner";
import { RuneStore } from "@tauri-store/svelte";
import { create_file, open_workspace } from "@/ipc";

export class WorkspaceStore {
  files: FileTreeNode[] = $state([]);
  /** path to the root of the workspace */
  path: string = $state("");
  name: string = $state("");

  /** recently opened workspaces */
  recent_workspaces: RuneStore<{ paths: Set<string> }> = new RuneStore(
    "recent_workspaces",
    { paths: new Set<string>() },
    { autoStart: true, saveOnChange: true },
  );

  async refresh() {
    if (!this.path) {
      toast.error("No workspace opened");
      return;
    }
    this.files = await buildFileTree(this.path);
    // toast.success("Workspace refreshed");
  }

  async createFile(path: string, isDirectory: boolean) {
    if (!this.path) {
      toast.error("No workspace opened");
      return;
    }
    const fullPath = joinFsPath(this.path, path);
    if (!isDirectory) {
      const res = await create_file(fullPath);
      if (res.isErr()) {
        toast.error("Error creating file", {
          description: res.error.message,
          closeButton: true,
          duration: 400,
        });
        return;
      }
      let file = await create(fullPath);

      this.refresh();
      await file.close();
      toast.success("File created", {
        description: `Created file at ${fullPath}`,
      });
      return;
    } else {
      const dir = await confirm(
        `Are you sure you want to create directory at ${fullPath}?`,
        {
          title: "Create Directory",
          kind: "info",
          okLabel: "Create",
          cancelLabel: "Cancel",
        },
      );
      if (!dir) {
        toast.error("Directory creation cancelled");
        return;
      }
      try {
        await mkdir(fullPath);
      } catch (e) {
        toast.error("Error creating directory", { description: String(e) });
        return;
      }
      this.refresh();
      toast.success("Directory created", {
        description: `Created directory at ${fullPath}`,
      });
    }
  }
  async openWorkspace(path?: string) {
    if (!path) {
      const selected_path = await OpenDialog({
        directory: true,
        multiple: false,
      });
      if (!selected_path) {
        toast.error("No path selected");
        return;
      }
      path = selected_path;
      this.recent_workspaces.state.paths.add(path);
    }

    this.path = path;
    this.name = getFolderName(path);
    this.files = await buildFileTree(path);
    await open_workspace(path);
    toast.success("Workspace opened", {
      description: `opened workspace at ${this.path}`,
    });
  }
}

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
  /** whether the directory is expanded or not   */
  open: boolean;
};
async function buildFileTree(path: string): Promise<FileTreeNode[]> {
  const tree: FileTreeNode[] = [];
  const entries = await readDir(path);
  for (const entry of entries) {
    if (entry.isDirectory) {
      const children = await buildFileTree(joinFsPath(path, entry.name));
      tree.push({
        name: entry.name,
        path: joinFsPath(path, entry.name),
        type: "directory",
        open: false,
        children,
      });
    } else {
      tree.push({
        name: entry.name,
        path: joinFsPath(path, entry.name),
        open: false,
        type: "file",
      });
    }
  }
  return tree;
}
