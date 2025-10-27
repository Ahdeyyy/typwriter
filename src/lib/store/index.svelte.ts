// contains the state of each module of the app

import { EditorStore } from "./editor.svelte";
import { PreviewStore } from "./preview.svelte";
import { WorkspaceStore } from "./workspace.svelte";
import { toast } from "svelte-sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { compile, render_pages, set_main_file, page_click } from "@/commands";
import { getFileType, murmurHash3 } from "@/utils";
import { RuneStore } from "@tauri-store/svelte";
import { SvelteMap } from "svelte/reactivity";

// store to persist the last opened main source file for each workspace
// the key is the workspace path, the value is the main source file path
// example: { "/path/to/workspace": "/path/to/workspace/main.typ" , ... }
export const persistentMainSourceStore = new RuneStore(
  "last-main-source",
  {
    main_sources: {} as Record<string, string>,
  },
  {
    autoStart: true,
    saveOnChange: true,
  },
);

export function getMainSourcePath(workspace_path: string): string | undefined {
  const s = persistentMainSourceStore.state.main_sources[workspace_path];
  return s;
}

export function setMainSourcePath(
  workspace_path: string,
  main_source_path: string,
) {
  persistentMainSourceStore.state.main_sources[workspace_path] =
    main_source_path;
}

class MainSourceStore {
  file_path = $state("");

  constructor() {
    const last_main_source = getMainSourcePath(workspaceStore.path);
    if (last_main_source) this.setMainSource(last_main_source);
  }

  reset() {
    this.file_path = "";
  }

  async setMainSource(path: string) {
    if (path === this.file_path) return;
    if (getFileType(path) !== "typ") {
      toast.info("can only set .typ files as the main source");
      return;
    }

    this.file_path = path;

    setMainSourcePath(workspaceStore.path, path);

    const res = await set_main_file(path);
    if (res.isErr()) {
      console.error("failed to set main file:", res.error.message);
      toast.error("failed to set main file", {
        description: res.error.message,
        closeButton: true,
      });
      return;
    }
    toast.loading("compiling main source");

    // compile and render the main source file
    const compile_result = await compile();
    if (compile_result.isErr()) {
      editorStore.diagnostics = compile_result.error;

      toast.error("failed to compile main file", {
        closeButton: true,
      });
      return;
    }

    editorStore.diagnostics = compile_result.value;
    toast.success("Main file set and compiled successfully");

    const render_result = await render_pages();
    if (render_result.isErr()) {
      console.error("failed to render pages:", render_result.error.message);
      toast.error("failed to render pages", {
        description: render_result.error.message,
        closeButton: true,
      });
      return;
    }
    previewStore.render_cache.clear();
    previewStore.items = render_result.value.map((page, idx) => {
      const page_hash = `${murmurHash3(page.image)}${idx}`;

      const img = new Image();
      img.width = page.width;
      img.height = page.height;
      img.src = `data:image/png;base64,${page.image}`;
      previewStore.render_cache.set(page_hash, img);

      return img;
    });
  }
}

class PaneStore {
  isPreviewPaneOpen = $state(true);
  isDiagnosticsPaneOpen = $state(false);
  isFileTreePaneOpen = $state(true);
}

export const editorStore = new EditorStore();
export const previewStore = new PreviewStore();
export const workspaceStore = new WorkspaceStore();
export const paneStore = new PaneStore();
export const mainSourceStore = new MainSourceStore();

export async function previewPageClick(x: number, y: number, page: number) {
  let result = await page_click(editorStore.content, page, x, y);
  if (result.isErr()) {
    toast.error("error", { description: result.error.message });
    console.error(result.error);
    return;
  }
  const view = editorStore.editor_view;
  if (!view) return;
  switch (result.value.type) {
    case "FileJump":
      //   appState.moveEditorCursor(result.value.position)
      // update the currently opened file according too
      //
      if (editorStore.file_path !== result.value.file) {
        editorStore.openFile(result.value.file);
      }

      if (view) {
        const transaction = view.state.update({
          selection: {
            anchor: result.value.position,
            head: result.value.position,
          },
          scrollIntoView: true,
        });
        view.dispatch(transaction);
        view.focus();
      }
      break;
    case "PositionJump":
      // this.previewPosition = {
      //   page: result.value.page,
      //   x: result.value.x,
      //   y: result.value.y,
      // };
      previewStore.current_position = {
        page: result.value.page,
        x: result.value.x,
        y: result.value.y,
      };
      break;
    case "UrlJump":
      openUrl(result.value.url);
      break;
    case "NoJump":
      break;
  }
}
