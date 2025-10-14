import type { DiagnosticResponse } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { ResultAsync } from "neverthrow";
import { toast } from "svelte-sonner";

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

  /** opens a file and loads the text content of the file */
  async openFile(path: string) {
    const open_file_res = await invoke_open_file("open_file", {
      file_path: path,
    });

    if (open_file_res.isErr()) {
      console.error("Failed to open file:", open_file_res.error);
      toast.error("Failed to open file", {
        description: open_file_res.error.message,
      });
      return;
    }

    const read_res = await safeReadTextFile(path);

    if (read_res.isErr()) {
      console.error("Failed to read file:", read_res.error);
      toast.error("Failed to read file", {
        description: read_res.error.message,
      });
      return;
    }
    this.file_path = path;
    this.content = read_res.value;
  }
}

const defaultEditorConfig: EditorConfig = {
  auto_save: true,
  auto_save_interval: 30000, // 30 seconds
  theme: "light",
  font_size: 14,
  show_line_numbers: true,
  tab_size: 4,
  wrap_text: true,
  auto_complete: true,
};

export { type EditorConfig, EditorStore, defaultEditorConfig };
