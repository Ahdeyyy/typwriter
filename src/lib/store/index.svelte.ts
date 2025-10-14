// contains the state of each module of the app

import { EditorStore } from "./editor.svelte";
import { defaultPreviewStore } from "./preview.svelte";
import { WorkspaceStore } from "./workspace.svelte";

export const editorStore = new EditorStore();
export const previewStore = $state(defaultPreviewStore);
export const workspaceStore = new WorkspaceStore();
