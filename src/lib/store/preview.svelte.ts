import { SvelteMap } from "svelte/reactivity";

type Img = "png" | "jpeg" | "webp" | "gif" | "avif";
class PreviewStore {
  // the type of document being previewed
  preview_item_type: "svg" | "typ" | "html" | Img = $state("typ");
  items: HTMLImageElement[] = $state([]);
  render_cache = new SvelteMap<string, HTMLImageElement>(); // cache of rendered images for typ files
  current_position = $state({ page: 0, x: 0, y: 0 });
  zoom = $state(1); // 0 to 1
  // add fullscreen mode, if true a new window will open with the preview
  fullscreen = $state(false);
}

// const defaultPreviewStore: PreviewStore = {
//   preview_item_type: "typ",
//   items: [],
//   render_cache: new SvelteMap<string, HTMLImageElement>(),
//   current_position: { page: 0, x: 0, y: 0 },
//   zoom: 1,
//   fullscreen: false,
// };

export { PreviewStore, type Img };
