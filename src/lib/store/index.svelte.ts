// contains the state of each module of the app

import { page_click } from "@/ipc";
import { EditorStore } from "./editor.svelte";
import { PreviewStore } from "./preview.svelte";
import { WorkspaceStore } from "./workspace.svelte";
import { toast } from "svelte-sonner";
import { openUrl } from "@tauri-apps/plugin-opener";

export const editorStore = new EditorStore();
export const previewStore = new PreviewStore();
export const workspaceStore = new WorkspaceStore();

export async function previewPageClick(x: number, y: number, page: number) {
  let result = await page_click(page, editorStore.content, x, y);
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
      toast.info("no jump target from click");
      console.log("no jump");
      break;
  }
}
