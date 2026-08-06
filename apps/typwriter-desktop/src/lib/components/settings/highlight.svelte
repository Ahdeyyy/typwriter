<script lang="ts">
  // Renders text with the current search words marked. Renders the plain string
  // when nothing is being searched, so it's safe to use for every label.
  import { getSettingsSearch, highlightSegments } from "./search.svelte";

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  const search = getSettingsSearch();
  const segments = $derived(
    search.active ? highlightSegments(text, search.terms) : [{ text, hit: false }],
  );
</script>

<!-- Unkeyed: segments are positional, and the same run of text can repeat. -->
{#each segments as segment}{#if segment.hit}<mark
      class="rounded-[2px] bg-primary/25 px-px text-inherit">{segment.text}</mark
    >{:else}{segment.text}{/if}{/each}
