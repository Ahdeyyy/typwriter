<script lang="ts">
  import { untrack } from "svelte";
  import type { PageMeta } from "$lib/ipc/types";
  import { previewUrl } from "$lib/preview-url";
  import { compileStore } from "$lib/stores/compile.svelte";

  let {
    meta,
    bucket,
    index,
    onVisible,
  }: {
    meta: PageMeta;
    bucket: number;
    index: number;
    onVisible: (index: number) => void;
  } = $props();

  let host = $state<HTMLElement | null>(null);
  let near = $state(false); // <img> mounts only when near the viewport

  $effect(() => {
    if (!host) return;
    // Pre-load ~1.5 screens ahead; report which page is centered.
    const loadObserver = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          near = true;
          loadObserver.disconnect();
        }
      },
      { rootMargin: "150% 0%" },
    );
    const centerObserver = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) onVisible(index);
      },
      { threshold: 0.5 },
    );
    loadObserver.observe(host);
    centerObserver.observe(host);
    return () => {
      loadObserver.disconnect();
      centerObserver.disconnect();
    };
  });

  const src = $derived(previewUrl(meta.fingerprint, bucket));

  // A recompile or a zoom change gives the page a new URL. Swapping it straight
  // into the <img> blanks the page until the new render decodes, which flashes
  // every page on every save. Keep the old render up and swap once the new one
  // is ready to paint.
  let shown = $state<string | null>(null);
  $effect(() => {
    if (!near) return;
    const next = src;
    const prev = untrack(() => shown);
    if (prev === null || prev === next) {
      shown = next;
      return;
    }
    let current = true;
    const img = new Image();
    img.src = next;
    // A failed decode still swaps, so the <img> reports the error itself.
    img.decode().catch(() => {}).finally(() => {
      if (current) shown = next;
    });
    return () => {
      current = false;
    };
  });
</script>

<div
  bind:this={host}
  data-page-index={index}
  class="w-full max-w-[820px] bg-white shadow-md"
  style:aspect-ratio={`${meta.widthPt} / ${meta.heightPt}`}
>
  {#if shown}
    <img
      src={shown}
      alt={`Page ${index + 1}`}
      class="block h-full w-full select-none"
      loading="lazy"
      decoding="async"
      draggable="false"
      style="-webkit-touch-callout: none;"
      onerror={() => {
        // Rare 404 from a fingerprint/regeneration race → one refresh.
        if (compileStore.stale) void compileStore.run();
      }}
    />
  {/if}
</div>
