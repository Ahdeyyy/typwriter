import { typst_completion, typst_hover_tooltip, typstLinter } from "./typst";

import { yaml } from "@codemirror/lang-yaml";
import { EditorView, hoverTooltip } from "@codemirror/view";
import { typst } from "codemirror-lang-typst";
import CodeMirror from "svelte-codemirror-editor";
import { ayuLight, coolGlow } from "thememirror";

import {
  typstBlueprintHighlightStyle,
  typstMidnightHighlightStyle,
} from "./style";
import { useThrottle } from "runed";
import { editorStore, previewStore } from "@/store/index.svelte";
import { murmurHash3 } from "@/utils";
import {
  compile,
  get_cursor_position_extern,
  get_pages_len,
  render_page,
  render_pages,
  update_file,
} from "@/commands";
import { toast } from "svelte-sonner";

export const compileAndRender = async () => {
  const res = await update_file(
    editorStore.file_path || "",
    editorStore.content,
  );
  if (res.isErr()) {
    console.error(
      "failed to update the file before rendering",
      res.error.message,
    );
    toast.error("Failed to update the file before rendering");
    return;
  }

  const compile_result = await compile();
  if (compile_result.isErr()) {
    editorStore.diagnostics = compile_result.error;
    toast.error("Failed to compile the document");
    return;
  }
  editorStore.diagnostics = compile_result.value;

  await render();
};

export async function render() {
  const cursor = editorStore.editor_view
    ? editorStore.editor_view.state.selection.main.head
    : 0;
  const position = await get_cursor_position_extern(
    cursor,
    editorStore.content,
    editorStore.file_path || "",
  );
  const pages = await get_pages_len();

  if (pages.isOk()) {
    console.log(
      "Pages length:",
      pages.value,
      "Current preview items:",
      previewStore.items.length,
    );
    if (pages.value !== previewStore.items.length) {
      // rerender all the pages and return
      const render_result = await render_pages();
      //   console.log("Render result:", render_result)
      if (render_result.isErr()) {
        console.error("failed to render the pages");
        toast.error("Failed to render the pages");
      } else {
        const pages = render_result.value;
        for (let idx = 0; idx < pages.length; idx++) {
          const page = pages[idx];
          const page_hash = `${murmurHash3(page.image)}${idx}`;
          const existing_page = previewStore.render_cache.get(page_hash);
          if (existing_page) {
            previewStore.items.splice(idx, 1, existing_page);
            continue;
          } else {
            const img = new Image();
            img.src = `data:image/png;base64,${page.image}`;
            img.width = page.width;
            img.height = page.height;
            previewStore.render_cache.set(page_hash, img);
            previewStore.items.splice(idx, 1, img);
          }
        }
      }
      return;
    }
  }

  if (position.isOk()) {
    // render single page
    //
    //
    //    // use the current page to the render the exact page
    previewStore.current_position = position.value;
    console.log(position.value);
    const render_result = await render_page(position.value.page - 1);
    if (render_result.isErr()) {
      console.error("failed to render the page");
      toast.error("Failed to render the page");
    } else {
      const page = render_result.value;
      const page_hash = `${murmurHash3(page.image)}${position.value.page - 1}`;
      const existing_page = previewStore.render_cache.get(page_hash);
      if (existing_page) {
        // page already exists in cache
        previewStore.items.splice(position.value.page - 1, 1, existing_page);
      } else {
        // add page to cache

        const img = new Image();
        img.src = `data:image/png;base64,${page.image}`;
        img.width = page.width;
        img.height = page.height;
        previewStore.render_cache.set(page_hash, img);
        previewStore.items.splice(position.value.page - 1, 1, img);
      }
    }
  } else {
    if (position.isErr()) {
      console.error("failed to get cursor position:", position.error.message);
    }
    const render_result = await render_pages();
    //   console.log("Render result:", render_result)
    if (render_result.isErr()) {
      console.error("failed to render the pages");
      toast.error("Failed to render the pages");
    } else {
      const pages = render_result.value;
      for (let idx = 0; idx < pages.length; idx++) {
        const page = pages[idx];
        const page_hash = `${murmurHash3(page.image)}${idx}`;
        const existing_page = previewStore.render_cache.get(page_hash);
        if (existing_page) {
          previewStore.items.splice(idx, 1, existing_page);
          continue;
        } else {
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
}

export const throttledCompileAndRender = useThrottle(async () => {
  await compileAndRender();
}, 90);

export {
  CodeMirror,
  typst,
  typst_completion,
  ayuLight,
  coolGlow,
  typstMidnightHighlightStyle,
  typstBlueprintHighlightStyle,
  typstLinter,
  yaml,
  EditorView,
  hoverTooltip,
  typst_hover_tooltip,
};
