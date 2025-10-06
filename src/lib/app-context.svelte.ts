import { EditorView } from "codemirror";
import { Workspace } from "./workspace/workspace.svelte";
import { RuneStore } from "@tauri-store/svelte"
import { open_workspace } from "./ipc";


class AppContext {
    isFileTreeOpen = $state<boolean>(false);
    isPreviewOpen = $state<boolean>(false);
    isDiagnosticsOpen = $state<boolean>(false);
    workspace = $state<Workspace | null>(null);
    recent_workspaces = new RuneStore("workspaces", { paths: [] as string[] });
    editorView = $state<EditorView | null>(null);

    constructor() {
        // Load the last opened workspace from the store
        const path = this.recent_workspaces.state.paths[0];
        if (path) {
            this.workspace = new Workspace(path);
            open_workspace(path);
        }
    }

    addToRecentWorkspaces(path: string) {
        const paths = this.recent_workspaces.state.paths;
        if (!paths.includes(path)) {
            paths.unshift(path);
            this.recent_workspaces.state.paths = paths.slice(0, 5); // Keep only the last 5 entries
            this.workspace = new Workspace(path);
            open_workspace(path);
        }
    }
}


export const appContext = new AppContext();