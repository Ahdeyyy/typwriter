import { EditorView } from "codemirror";
import { Workspace } from "./workspace/workspace.svelte";
import { RuneStore } from "@tauri-store/svelte";
import { open_workspace } from "./ipc";

class AppContext {
  isFileTreeOpen = $state<boolean>(false);
  isPreviewOpen = $state<boolean>(false);
  isDiagnosticsOpen = $state<boolean>(false);
  workspace = $state<Workspace | null>(null);
  editorView = $state<EditorView | null>(null);
  loaded = $state(false);
  recent_workspaces: RuneStore<{ paths: string[] }>;

  constructor() {
    // Load the last opened workspace from the store
    // (async () => {
    //     await this.recent_workspaces.start()
    //     this.loaded = true
    // })()
    this.recent_workspaces = new RuneStore(
      "workspaces",
      { paths: [] as string[] },
      { autoStart: true, saveOnChange: true },
    );
    const path = this.recent_workspaces.state.paths[0];
    // console.log($state.snapshot(this.recent_workspaces.state));
    if (path) {
      console.log(path);

      (async () => {
        this.workspace = new Workspace(path);
        await open_workspace(path);
        this.addToRecentWorkspaces(path);
      })();
    }
  }

  addToRecentWorkspaces(path: string) {
    const paths = this.recent_workspaces.state.paths;
    // console.log(this.recent_workspaces)
    if (!paths.includes(path)) {
      paths.unshift(path);
      this.recent_workspaces.state.paths = paths.slice(0, 5); // Keep only the last 5 entries
      this.workspace = new Workspace(path);
      open_workspace(path);
    }
  }
}

export const appContext = new AppContext();
