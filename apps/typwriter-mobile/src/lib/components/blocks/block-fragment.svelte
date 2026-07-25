<script lang="ts">
  // A block's real compiled output: crops of the already-rendered preview
  // pages, stacked. The `<img>` URLs are the same immutable fingerprints the
  // preview overlay uses, so a document you've previewed costs zero extra IPC
  // or rasterization — the webview's HTTP cache serves them.

  import type { BlockExtent } from "$lib/ipc/types";
  import { previewUrl } from "$lib/preview-url";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { settings } from "$lib/stores/settings.svelte";

  let {
    extents,
    width,
  }: {
    extents: BlockExtent[];
    /** Column width in CSS px; fragments are scaled to fill it. */
    width: number;
  } = $props();

  const bucket = $derived(settings.previewScaleBucket);

  interface Crop {
    key: string;
    src: string;
    /** Height of the visible band, in CSS px. */
    height: number;
    /** Width the full page image is drawn at, in CSS px. */
    pageWidth: number;
    /** How far up the page image is shifted, in CSS px. */
    offset: number;
  }

  const crops = $derived.by<Crop[]>(() => {
    if (width <= 0) return [];
    const out: Crop[] = [];
    for (const extent of extents) {
      const page = compileStore.pages[extent.page];
      if (!page) continue;
      const scale = width / page.widthPt;
      out.push({
        key: `${page.fingerprint}-${extent.y0Pt}`,
        src: previewUrl(page.fingerprint, bucket),
        height: Math.max(1, (extent.y1Pt - extent.y0Pt) * scale),
        pageWidth: page.widthPt * scale,
        offset: extent.y0Pt * scale,
      });
    }
    return out;
  });
</script>

{#each crops as crop (crop.key)}
  <div class="relative overflow-hidden bg-white" style:height="{crop.height}px">
    <img
      src={crop.src}
      alt=""
      class="absolute top-0 left-0 max-w-none"
      style:width="{crop.pageWidth}px"
      style:transform="translateY(-{crop.offset}px)"
      loading="lazy"
      decoding="async"
    />
  </div>
{/each}
