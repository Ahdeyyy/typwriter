// import { compile, render, render_page } from "@/ipc";
import { compile, render_page, render_pages } from "@/commands";

import type { DiagnosticResponse } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { EditorView } from "codemirror";
import { ResultAsync } from "neverthrow";
import { toast } from "svelte-sonner";
import { mainSourceStore, previewStore } from "./index.svelte";
import { getFileType, murmurHash3 } from "@/utils";
import { SvelteMap } from "svelte/reactivity";

const toInvokeError = (e: unknown) => {
  if (e instanceof Error) {
    return { message: e.message };
  }
  return { message: String(e) };
};
const safeReadTextFile = ResultAsync.fromThrowable(readTextFile, toInvokeError);

const safeReadFile = ResultAsync.fromThrowable(readFile, toInvokeError);

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
  binary_content = $state<Uint8Array | undefined>();

  async reset() {
    this.content = "";
    this.file_path = null;
    this.cursor_position = 0;
    this.selection_range = null;
    this.is_dirty = false;
    this.last_saved = null;
    if (this.save_interval_id) {
      clearInterval(this.save_interval_id);
      this.save_interval_id = undefined;
    }
    this.diagnostics = [];
    this.saving = false;
    this.editor_view = null;
  }

  /** opens a file and loads the text content of the file */
  async openFile(path: string) {
    // console.log("open file with path:", path);

    if (this.file_path) {
      this.saveFile();
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

    const read_bin_res = await safeReadFile(path);

    if (
      read_bin_res.isOk() &&
      !["typ", "yaml", "yml", "bib"].includes(getFileType(path))
    ) {
      const bin = read_bin_res.value as Uint8Array;
      this.binary_content = bin;
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
  }

  /** saves the current content to the file */
  async saveFile(explicit: boolean = false) {
    this.saving = true;
    if (!this.file_path) {
      this.saving = false;
      toast.error("No file path specified", {
        description: "Cannot save file without a valid file path",
        duration: 500,
        closeButton: true,
      });
      return;
    }
    if (!this.is_dirty) {
      // No changes to save

      if (explicit) {
        toast.info("No changes to save", {
          duration: 800,
        });
      }

      this.saving = false;
      return;
    }
    await writeTextFile(this.file_path, this.content);
    this.is_dirty = false;
    this.last_saved = Date.now();
    toast.success("File saved", {
      description: `Saved to ${this.file_path}`,
      duration: 500,
    });
    this.saving = false;
  }
}

const defaultEditorConfig: EditorConfig = {
  auto_save: true,
  auto_save_interval: 3500, // 1.75 seconds
  theme: "light",
  font_size: 14,
  show_line_numbers: true,
  tab_size: 4,
  wrap_text: true,
  auto_complete: true,
};

export { type EditorConfig, EditorStore, defaultEditorConfig };
