<script lang="ts">
  // Renders one settings group and tells everything inside it which group it
  // is, so rows can report their search hits to the right place. Every pane
  // goes through here — while searching the page mounts all of them at once,
  // and each one hides itself if nothing in it matches.
  import type { SettingsGroup } from "./groups";
  import { setSettingsGroupId } from "./search.svelte";

  interface Props {
    group: SettingsGroup;
  }

  let { group }: Props = $props();

  // Reading the initial value is the point: context can only be set at init,
  // and the page keys panes by id, so an instance never changes group.
  // svelte-ignore state_referenced_locally
  setSettingsGroupId(group.id);

  const Pane = $derived(group.component);
</script>

<Pane />
