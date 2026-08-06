<script lang="ts">
  // Header + blurb shell shared by every settings group pane.
  //
  // Also the search's group boundary: it drops out of the page when nothing
  // inside it matches, and when its *own* heading matches it forces everything
  // inside back into view — searching "grammar" should show the whole Grammar
  // pane, not only the rows that repeat the word.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import Highlight from "./highlight.svelte";
  import {
    getSettingsGroupId,
    getSettingsSearch,
    setForcedVisible,
  } from "./search.svelte";

  interface Props {
    title: string;
    description?: string;
    /** Extra words the search should match the whole group on. */
    keywords?: string[];
    /** Rendered on the header row, right-aligned (e.g. a "reloading…" hint). */
    aside?: Snippet;
    children: Snippet;
  }

  let { title, description, keywords, aside, children }: Props = $props();

  const groupId = getSettingsGroupId();
  const search = getSettingsSearch();

  const matched = $derived(search.matches(title, description, keywords));
  const visible = $derived(!search.active || matched || search.hitCount(groupId) > 0);

  $effect(() => {
    search.setGroupMatch(groupId, search.active && matched);
    return () => search.setGroupMatch(groupId, false);
  });

  setForcedVisible(() => search.groupMatched(groupId));
</script>

<!-- The id is the nav's scroll target while searching; scroll-mt keeps the
     heading clear of the top edge when it lands. -->
<section
  id="settings-group-{groupId}"
  class={cn("flex scroll-mt-4 flex-col", !visible && "hidden")}
>
  <div class="mb-1 flex items-center justify-between gap-2">
    <h2 class="text-base font-semibold"><Highlight text={title} /></h2>
    {@render aside?.()}
  </div>
  {#if description}
    <p class="mb-5 text-sm text-muted-foreground"><Highlight text={description} /></p>
  {:else}
    <div class="mb-5"></div>
  {/if}

  {@render children()}
</section>
