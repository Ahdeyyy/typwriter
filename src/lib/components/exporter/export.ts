import { compile, export_main } from "@/commands";
import { editorStore, mainSourceStore } from "@/store/index.svelte";
import { getFileName, getFileType } from "@/utils";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "svelte-sonner";

type ExportConfig =
  | { format: "pdf" }
  | { format: "svg"; merged: true }
  | { format: "svg"; merged: false; start_page: number; end_page: number }
  | { format: "png"; start_page: number; end_page: number };

export async function export_main_source(options: ExportConfig) {
  await compile();

  if (!mainSourceStore.file_path) {
    alert("Please open a file to export.");
    return;
  }
  const ext = getFileType(mainSourceStore.file_path);
  const fileName = getFileName(mainSourceStore.file_path).replace(
    /\.[^/.]+$/,
    "",
  );
  const export_path = await save({
    title: "export to",
    defaultPath: `${fileName}`,
    filters: [
      {
        name: options.format.toUpperCase(),
        extensions: [options.format.toLowerCase()],
      },
    ],
  });

  if (export_path) {
    let res = await export_main(export_path, {
      ...options,
    });
    if (res.isErr()) {
      console.error("error exporting: ", res.error.message);
      toast.error(res.error.message);
    } else {
      toast.success(`${editorStore.file_path} exported successfully!`);
    }
  }
}
