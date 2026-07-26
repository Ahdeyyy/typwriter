<script lang="ts">
  // Fixed, always-expanded group list down the left edge of the settings
  // window. Deliberately not the shadcn Sidebar — there's nothing to collapse.
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import { SETTINGS_GROUPS, type SettingsGroupId } from "./groups";
  import UpdateButton from "./update-button.svelte";

  interface Props {
    active: SettingsGroupId;
    onselect: (id: SettingsGroupId) => void;
  }

  let { active, onselect }: Props = $props();
</script>

<nav class="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar" aria-label="Settings">
  <ScrollArea.Root class="min-h-0 flex-1">
    <ul class="flex flex-col gap-0.5 p-2">
      {#each SETTINGS_GROUPS as group (group.id)}
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground {active ===
            group.id
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground'}"
            aria-current={active === group.id ? "page" : undefined}
            onclick={() => onselect(group.id)}
          >
            <HugeiconsIcon icon={group.icon} class="size-4 shrink-0" />
            <span class="truncate">{group.label}</span>
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
