<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { RefreshIcon, Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
  import Button from "#lib/components/ui/button/button.svelte";
  import { Input } from "#lib/components/ui/input/index.ts";
  import Titlebar from "#lib/components/titlebar/titlebar.svelte";
  import * as ScrollArea from "#lib/components/ui/scroll-area/index.ts";
  import * as Tooltip from "#lib/components/ui/tooltip/index.ts";
  import SettingsNav from "#lib/components/settings/nav.svelte";
  import GroupPane from "#lib/components/settings/group-pane.svelte";
  import {
    SETTINGS_GROUPS,
    DEFAULT_SETTINGS_GROUP,
    type SettingsGroupId,
  } from "#lib/components/settings/groups.ts";
  import { SettingsSearch, setSettingsSearch } from "#lib/components/settings/search.svelte.ts";
  import { settings } from "#lib/stores/settings.svelte.ts";
  import { matchesCommand, shortcutLabel } from "#lib/keybindings/index.ts";
  import { toast } from "svelte-sonner";

  interface Props {
    /** Pane to open on, seeded from the URL by whoever opened the window.
     *  An unknown id falls back to the default rather than showing nothing. */
    initialGroup?: string | null;
  }

  let { initialGroup = null }: Props = $props();

  const requestedGroup = SETTINGS_GROUPS.find((g) => g.id === initialGroup)?.id;
  let activeGroup = $state<SettingsGroupId>(requestedGroup ?? DEFAULT_SETTINGS_GROUP);

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
<div class="relative flex h-screen w-screen overflow-hidden">
  <SettingsNav active={activeGroup} onselect={selectGroup} />

  <div class="flex min-w-0 flex-1 flex-col">
    <!-- The window title is the nav's header; search and reset sit centred in
         the titlebar row beside it. -->
    <Titlebar variant="minimal" hideMacControls>
      {#snippet actions()}
      <div class="relative w-96">
        <HugeiconsIcon
          icon={Search01Icon}
          class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          bind:ref={searchInput}
          bind:value={search.query}
          type="text"
          class="h-7 pl-7 pr-7 text-xs"
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

      <Button variant="ghost" size="sm" class="h-7 shrink-0 gap-1.5 text-xs" onclick={resetSettings}>
        <HugeiconsIcon icon={RefreshIcon} class="size-3.5" />
        Reset to defaults
      </Button>
      {/snippet}
    </Titlebar>

    <main id="main-content" tabindex="-1" class="min-h-0 flex-1">
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
    </main>
  </div>
</div>
</Tooltip.Provider>
