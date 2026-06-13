<script lang="ts">
  import type { PageMeta } from "$lib/ipc/types";
  import Page from "./page.svelte";

  let {
    pages,
    bucket,
    onVisible,
  }: {
    pages: PageMeta[];
    bucket: number;
    onVisible: (index: number) => void;
  } = $props();
</script>

<div class="flex flex-col items-center gap-3 p-3">
  {#each pages as meta, i (meta.fingerprint + "-" + i)}
    <Page {meta} {bucket} index={i} {onVisible} />
  {/each}
</div>
