<script lang="ts">
  // Header + blurb shell shared by every settings group pane.
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    description?: string;
    /** Rendered on the header row, right-aligned (e.g. a "reloading…" hint). */
    aside?: Snippet;
    children: Snippet;
  }

  let { title, description, aside, children }: Props = $props();
</script>

<section class="flex flex-col">
  <div class="mb-1 flex items-center justify-between gap-2">
    <h2 class="text-base font-semibold">{title}</h2>
    {@render aside?.()}
  </div>
  {#if description}
    <p class="mb-5 text-sm text-muted-foreground">{description}</p>
  {:else}
    <div class="mb-5"></div>
  {/if}

  {@render children()}
</section>
