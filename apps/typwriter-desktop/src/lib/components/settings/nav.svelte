<script lang="ts">
  // Fixed, always-expanded group list down the left edge of the settings
  // window. Deliberately not the shadcn Sidebar — there's nothing to collapse.
  //
  // While a search is running it doubles as a result summary: each group shows
  // how many settings matched, groups with none are greyed out, and selecting
  // one jumps to its section in the stacked results rather than switching pane.
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import { SETTINGS_GROUPS, type SettingsGroupId } from "./groups";
  import { getSettingsSearch } from "./search.svelte";
  import UpdateButton from "./update-button.svelte";

  interface Props {
    active: SettingsGroupId;
    onselect: (id: SettingsGroupId) => void;
  }

  let { active, onselect }: Props = $props();

  const search = getSettingsSearch();
</script>

<nav class="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar" aria-label="Settings">
  <ScrollArea.Root class="min-h-0 flex-1">
    <ul class="flex flex-col gap-0.5 p-2">
      {#each SETTINGS_GROUPS as group (group.id)}
        {@const hits = search.hitCount(group.id)}
        {@const hasResults = search.groupVisible(group.id)}
        {@const current = !search.active && active === group.id}
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground {current
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground'} {hasResults ? '' : 'opacity-40'}"
            aria-current={current ? "page" : undefined}
            onclick={() => onselect(group.id)}
          >
            <HugeiconsIcon icon={group.icon} class="size-4 shrink-0" />
            <span class="truncate">{group.label}</span>
            {#if search.active && hits > 0}
              <span
                class="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 text-[11px] font-medium tabular-nums text-foreground"
              >
                {hits}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </ScrollArea.Root>

  <!-- Pinned below the group list: the app's whole update flow in one button. -->
  <div class="shrink-0 border-t border-border p-2">
    <UpdateButton />
  </div>
</nav>
