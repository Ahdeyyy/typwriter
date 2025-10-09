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

type EditorState = {
  content: string;
  file_path: string | null;
  cursor_position: number;
  selection_range: [number, number] | null;
  is_dirty: boolean;
  last_saved: number | null; // timestamp
  config: EditorConfig;
};

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

const defaultEditorState: EditorState = {
  content: "",
  file_path: null,
  cursor_position: 0,
  selection_range: null,
  is_dirty: false,
  last_saved: null,
  config: defaultEditorConfig,
};

export {
  type EditorState,
  type EditorConfig,
  defaultEditorState,
  defaultEditorConfig,
};
