import { EditorView } from "codemirror";
import { Workspace } from "./workspace/workspace.svelte";
import { RuneStore } from "@tauri-store/svelte";
import { open_workspace } from "./ipc";
import { toast } from "svelte-sonner";

type AppState = {
  active_tab: string;
  tabs: string[];
};
const appState = new RuneStore<AppState>(
  "app-state",
  {
    active_tab: "",
    tabs: [],
  },
  { autoStart: true, saveOnChange: true },
);

class AppContext {
  isFileTreeOpen = $state<boolean>(false);
  isPreviewOpen = $state<boolean>(false);
  isDiagnosticsOpen = $state<boolean>(false);
  workspace = $state<Workspace | null>(null);
  editorView = $state<EditorView | null>(null);
  loaded = $state(false);
  recent_workspaces: RuneStore<{ paths: string[]; opened: string }>;

  constructor() {
    this.recent_workspaces = new RuneStore(
      "workspaces",
      { paths: [] as string[], opened: "" },
      { autoStart: true, saveOnChange: true },
    );
    const path = this.recent_workspaces.state.opened;
    if (path !== "") {
      (async () => {
        this.workspace = new Workspace(path);
        const result = await open_workspace(path);
        if (result.isErr()) {
          console.error("Failed to open workspace:", result.error);
          toast.error("Failed to open workspace", {
            description: result.error.message,
          });
        }

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
