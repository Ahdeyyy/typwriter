<script lang="ts">
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
</script>

<div
  bind:this={host}
  class="w-full max-w-[820px] bg-white shadow-md"
  style:aspect-ratio={`${meta.widthPt} / ${meta.heightPt}`}
>
  {#if near}
    <img
      {src}
      alt={`Page ${index + 1}`}
      class="block h-full w-full"
      loading="lazy"
      decoding="async"
      onerror={() => {
        // Rare 404 from a fingerprint/regeneration race → one refresh.
        if (compileStore.stale) void compileStore.run();
      }}
    />
  {/if}
</div>
