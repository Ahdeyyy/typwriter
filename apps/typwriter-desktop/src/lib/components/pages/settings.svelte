<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { RefreshIcon, Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
  import Button from "$lib/components/ui/button/button.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import SettingsNav from "$lib/components/settings/nav.svelte";
  import GroupPane from "$lib/components/settings/group-pane.svelte";
  import {
    SETTINGS_GROUPS,
    DEFAULT_SETTINGS_GROUP,
    type SettingsGroupId,
  } from "$lib/components/settings/groups";
  import { SettingsSearch, setSettingsSearch } from "$lib/components/settings/search.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { matchesCommand, shortcutLabel } from "$lib/keybindings";
  import { toast } from "svelte-sonner";

  let activeGroup = $state<SettingsGroupId>(DEFAULT_SETTINGS_GROUP);

  // Owned here and handed to every pane through context, so a row anywhere in
  // the tree can filter itself without the page knowing what settings exist.
  const search = new SettingsSearch();
  setSettingsSearch(search);

  let searchInput = $state<HTMLInputElement | null>(null);

  const activeGroupDef = $derived(
    SETTINGS_GROUPS.find((g) => g.id === activeGroup) ?? SETTINGS_GROUPS[0],
  );

  const searchPlaceholder = $derived.by(() => {
    const shortcut = shortcutLabel("settings.search");
    return shortcut ? `Search settings… (${shortcut})` : "Search settings…";
  });

  function resetSettings() {
    settings.resetToDefaults();
    toast.success("Settings reset to defaults");
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (!matchesCommand(event, "settings.search")) return;
    event.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    // First Escape clears the query, a second one gets you out of the field.
    if (search.query) search.clear();
    else searchInput?.blur();
  }

  /** While searching every group is on screen at once, so the nav scrolls to
   *  one instead of swapping the pane. */
  function selectGroup(id: SettingsGroupId) {
    if (!search.active) {
      activeGroup = id;
      return;
    }
    document
      .getElementById(`settings-group-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Rendered in its own undecorated webview window (label "settings"), so it
     carries the shared custom titlebar; there's no in-app back navigation.
     The Tooltip.Provider is explicit here — the workspace window inherits one
     from Sidebar.Provider, but this window has no sidebar context, and
     Tooltip.Root throws without a provider above it. -->
<Tooltip.Provider>
<div class="relative flex h-screen w-screen flex-col overflow-hidden">
  <Titlebar variant="minimal" title="Settings" />

  <div class="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
    <h1 class="shrink-0 text-base font-semibold">Settings</h1>

    <div class="relative ml-auto w-full max-w-xs">
      <HugeiconsIcon
        icon={Search01Icon}
        class="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        bind:ref={searchInput}
        bind:value={search.query}
        type="text"
        class="h-8 pl-8 pr-8"
        placeholder={searchPlaceholder}
        aria-label="Search settings"
        onkeydown={onSearchKeydown}
      />
      {#if search.query}
        <button
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
          onclick={() => {
            search.clear();
            searchInput?.focus();
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
        </button>
      {/if}
    </div>

    <Button variant="outline" size="sm" class="shrink-0 gap-2" onclick={resetSettings}>
      <HugeiconsIcon icon={RefreshIcon} class="size-4" />
      Reset to defaults
    </Button>
  </div>

  <div class="flex min-h-0 flex-1">
    <SettingsNav active={activeGroup} onselect={selectGroup} />

    <div class="min-w-0 flex-1">
      <ScrollArea.Root class="h-full">
        <div class="mx-auto w-full max-w-3xl px-8 py-8">
          {#if search.active}
            <!-- Every pane is mounted so it can filter its own rows; the ones
                 with no match hide themselves, gaps and all. -->
            {#if !search.hasResults}
              <div class="rounded-md border border-border px-4 py-10 text-center">
                <p class="text-sm font-medium">No settings match "{search.query}"</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  Try a shorter query, or a word from the setting's description.
                </p>
                <Button variant="outline" size="sm" class="mt-4" onclick={() => search.clear()}>
                  Clear search
                </Button>
              </div>
            {/if}
            <div class="flex flex-col gap-10">
              {#each SETTINGS_GROUPS as group (group.id)}
                <GroupPane {group} />
              {/each}
            </div>
          {:else}
            <!-- Keyed so each pane remounts on switch: panes with onMount work
                 (the Editor group re-probes tinymist) and none of them carry
                 stale local state from the previously shown group. -->
            {#key activeGroup}
              <GroupPane group={activeGroupDef} />
            {/key}
          {/if}
        </div>
      </ScrollArea.Root>
    </div>
  </div>
</div>
</Tooltip.Provider>
