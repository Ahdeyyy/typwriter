type Img = "png" | "jpeg" | "webp" | "gif" | "avif";
type PreviewState = {
  // the type of document being previewed
  preview_item_type: "svg" | "typ" | "html" | Img;
  items: HTMLImageElement[] | string[];
  current_index: number;
  zoom: number; // 0 to 1
  // add fullscreen mode, if true a new window will open with the preview
  fullscreen: boolean;
};

const defaultPreviewState: PreviewState = {
  preview_item_type: "typ",
  items: [],
  current_index: 0,
  zoom: 1,
  fullscreen: false,
};

export { type PreviewState, type Img, defaultPreviewState };
