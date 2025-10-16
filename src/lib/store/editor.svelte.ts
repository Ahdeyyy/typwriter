import { compile, render, render_page } from "@/ipc";
import type { DiagnosticResponse } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { EditorView } from "codemirror";
import { ResultAsync } from "neverthrow";
import { toast } from "svelte-sonner";
import { previewStore } from "./index.svelte";
import { getFileType, murmurHash3 } from "@/utils";
import { SvelteMap } from "svelte/reactivity";

const safeReadTextFile = ResultAsync.fromThrowable(
  readTextFile,
  (e: unknown) => {
    if (e instanceof Error) {
      return { message: e.message };
    }
    return { message: String(e) };
  },
);

const toInvokeError = (e: unknown) => {
  if (e instanceof Error) {
    return { message: e.message };
  }
  return { message: String(e) };
};
const invoke_open_file = ResultAsync.fromThrowable(invoke<void>, toInvokeError);

type EditorConfig = {
  auto_save: boolean;
  auto_save_interval: number; // in milliseconds
  theme: "light" | "dark";
  font_size: number;
  show_line_numbers: boolean;
  tab_size: number;
  wrap_text: boolean;
  auto_complete: boolean;
};

class EditorStore {
  content: string = $state("");
  file_path: string | null = $state(null);
  cursor_position: number = $state(0);
  selection_range: [number, number] | null = $state(null);
  is_dirty: boolean = $state(false);
  last_saved: number | null = $state(null); // timestamp
  config: EditorConfig = $state(defaultEditorConfig);
  save_interval_id?: number = $state(undefined); // ID for the auto-save interval
  diagnostics: DiagnosticResponse[] = $state([]);
  saving: boolean = $state(false);
  editor_view: EditorView | null = $state(null);

  /** opens a file and loads the text content of the file */
  async openFile(path: string) {
    // console.log("open file with path:", path);
    const open_file_res = await invoke_open_file("open_file", {
      file_path: path,
    });

    if (open_file_res.isErr()) {
      console.error("Failed to open file:", open_file_res.error);
      toast.error("Failed to open file", {
        description: open_file_res.error.message,
        closeButton: true,
      });
      return;
    }

    const read_res = await safeReadTextFile(path);

    if (read_res.isErr()) {
      console.error("Failed to read file:", read_res.error);
      toast.error("Failed to read file", {
        description: read_res.error.message,
        closeButton: true,
      });
      return;
    }
    this.file_path = path;
    this.content = read_res.value;
    if (this.save_interval_id) {
      // console.log("clearing interval: ", this.save_interval_id);
      clearInterval(this.save_interval_id);
    }
    if (this.config.auto_save) {
      const save_callback = () => {
        // console.log("auto saving file...");
        if (this.saving) return; // prevent overlapping saves
        this.saving = true;
        this.saveFile();
      };
      this.save_interval_id = setInterval(
        save_callback,
        this.config.auto_save_interval,
      );
    }
    previewStore.render_cache = new SvelteMap();
    previewStore.items = [];
    const extension = getFileType(path);
    if (extension === "typ") {
      await Promise.all([this.compile_document(), this.render()]);
    }
    previewStore.current_position = {
      page: 0,
      x: 0,
      y: 0,
    };

    toast.success("File opened", {
      description: `Opened ${path}`,
      closeButton: true,
      duration: 800,
    });
  }

  /** saves the current content to the file */
  async saveFile() {
    this.saving = true;
    if (!this.file_path) {
      this.saving = false;
      toast.error("No file path specified", {
        description: "Cannot save file without a valid file path",
        duration: 400,
        closeButton: true,
      });
      return;
    }
    if (!this.is_dirty) {
      // No changes to save
      this.saving = false;
      return;
    }
    await writeTextFile(this.file_path, this.content);
    this.is_dirty = false;
    this.last_saved = Date.now();
    toast.success("File saved", {
      description: `Saved to ${this.file_path}`,
      duration: 800,
    });
    this.saving = false;
  }

  /** compiles the source of the file */
  async compile_document() {
    if (!this.file_path) return;
    const result = await compile(this.file_path, this.content);
    if (result.isErr()) {
      toast.error("Failed to compile the document.", {
        description: result.error.message,
        closeButton: true,
      });
    } else {
      const render_diagnostics = result.value;
      this.diagnostics = render_diagnostics;
    }
  }

  /** gets the rendered images of the document */
  async render() {
    const render_result = await render();
    if (render_result.isErr()) {
      toast.error("Failed to render the document.", {
        description: render_result.error.message,
        duration: 400,
      });
    } else {
      const pages = render_result.value;

      for (let idx = 0; idx < pages.length; idx++) {
        const page = pages[idx];
        const page_hash = `${murmurHash3(page.image)}${idx}`;
        const existing_page = previewStore.render_cache.get(page_hash);
        if (existing_page) {
          // page already exists in cache
          previewStore.items.splice(idx, 1, existing_page);
          continue;
        } else {
          // add page to cache
          const img = new Image();
          img.src = `data:image/png;base64,${page.image}`;
          img.width = page.width;
          img.height = page.height;
          previewStore.render_cache.set(page_hash, img);
          previewStore.items.splice(idx, 1, img);
        }
      }
    }
  }
  async render_page(page: number) {
    const res = await render_page(page);
    // console.log("rendering page:", page, res);
    if (res) {
      console.log("new page render");
      const img = new Image();
      img.src = `data:image/png;base64,${res.image}`;
      img.width = res.width;
      img.height = res.height;
      previewStore.items.splice(page, 1, img);
    }
  }
}

const defaultEditorConfig: EditorConfig = {
  auto_save: true,
  auto_save_interval: 2250, // 1.75 seconds
  theme: "light",
  font_size: 14,
  show_line_numbers: true,
  tab_size: 4,
  wrap_text: true,
  auto_complete: true,
};

export { type EditorConfig, EditorStore, defaultEditorConfig };
