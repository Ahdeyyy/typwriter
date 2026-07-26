<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { RefreshIcon } from "@hugeicons/core-free-icons";
  import Button from "$lib/components/ui/button/button.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import SettingsNav from "$lib/components/settings/nav.svelte";
  import {
    SETTINGS_GROUPS,
    DEFAULT_SETTINGS_GROUP,
    type SettingsGroupId,
  } from "$lib/components/settings/groups";
  import { settings } from "$lib/stores/settings.svelte";
  import { toast } from "svelte-sonner";

  let activeGroup = $state<SettingsGroupId>(DEFAULT_SETTINGS_GROUP);

  const ActiveGroup = $derived(
    (SETTINGS_GROUPS.find((g) => g.id === activeGroup) ?? SETTINGS_GROUPS[0]).component,
  );

  function resetSettings() {
    settings.resetToDefaults();
    toast.success("Settings reset to defaults");
  }
</script>

<!-- Rendered in its own undecorated webview window (label "settings"), so it
     carries the shared custom titlebar; there's no in-app back navigation.
     The Tooltip.Provider is explicit here — the workspace window inherits one
     from Sidebar.Provider, but this window has no sidebar context, and
     Tooltip.Root throws without a provider above it. -->
<Tooltip.Provider>
<div class="relative flex h-screen w-screen flex-col overflow-hidden">
  <Titlebar variant="minimal" title="Settings" />

  <div class="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
    <h1 class="text-base font-semibold">Settings</h1>
    <Button variant="outline" size="sm" class="ml-auto gap-2" onclick={resetSettings}>
      <HugeiconsIcon icon={RefreshIcon} class="size-4" />
      Reset to defaults
    </Button>
  </div>

  <div class="flex min-h-0 flex-1">
    <SettingsNav active={activeGroup} onselect={(id) => (activeGroup = id)} />

    <div class="min-w-0 flex-1">
      <ScrollArea.Root class="h-full">
        <div class="mx-auto w-full max-w-3xl px-8 py-8">
          <!-- Keyed so each pane remounts on switch: panes with onMount work
               (the Editor group re-probes tinymist) and none of them carry
               stale local state from the previously shown group. -->
          {#key activeGroup}
            <ActiveGroup />
          {/key}
        </div>
      </ScrollArea.Root>
    </div>
  </div>
</div>
</Tooltip.Provider>
