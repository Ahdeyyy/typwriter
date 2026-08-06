<script lang="ts">
  // A searchable block for the parts of a pane that aren't `SettingRow`s — a
  // sub-heading with its list, a picker grid, a footnote. It matches as a unit:
  // when its keywords hit, everything inside it stays visible (including any
  // rows), and when they don't, the whole block hides.
  //
  // `matched` is for blocks that do their own filtering, like the grammar rule
  // list and the keymaps table: they pass whether their filtered list still has
  // anything in it, so a search for a single rule or shortcut surfaces them.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { getForcedVisible, getSettingsSearch, reportSettingHit, setForcedVisible } from "./search.svelte";

  interface Props {
    /** Words the search matches this block on. */
    keywords?: string[];
    /** Extra condition ORed in with the keywords. */
    matched?: boolean;
    class?: string;
    children: Snippet;
  }

  let { keywords, matched = false, class: className, children }: Props = $props();

  const search = getSettingsSearch();
  const forcedFromAncestor = getForcedVisible();

  const ownMatch = $derived(search.matches(keywords) || (search.active && matched));
  const visible = $derived(!search.active || forcedFromAncestor() || ownMatch);

  reportSettingHit(() => ownMatch);
  setForcedVisible(() => forcedFromAncestor() || ownMatch);
</script>

<div class={cn(className, !visible && "hidden")}>
  {@render children()}
</div>
