import { SvelteMap } from "svelte/reactivity";

type Img = "png" | "jpeg" | "webp" | "gif" | "avif";
type PreviewStore = {
  // the type of document being previewed
  preview_item_type: "svg" | "typ" | "html" | Img;
  items: HTMLImageElement[];
  render_cache: SvelteMap<string, HTMLImageElement>; // cache of rendered images for typ files
  current_index: number;
  zoom: number; // 0 to 1
  // add fullscreen mode, if true a new window will open with the preview
  fullscreen: boolean;
};

const defaultPreviewStore: PreviewStore = {
  preview_item_type: "typ",
  items: [],
  render_cache: new SvelteMap<string, HTMLImageElement>(),
  current_index: 0,
  zoom: 1,
  fullscreen: false,
};

export { type PreviewStore, type Img, defaultPreviewStore };
