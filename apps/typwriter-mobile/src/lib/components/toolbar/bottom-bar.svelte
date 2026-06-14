<script lang="ts">
  import {
    Add01Icon,
    Search01Icon,
    ViewIcon,
    Pdf01Icon,
    Alert02Icon,
    Settings01Icon,
    Logout01Icon,
    MenuTwoLineIcon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";

  let { onPreview, onExport, exporting }: {
    onPreview: () => void;
    onExport: () => void;
    exporting: boolean;
  } = $props();
</script>

<div
  class="bg-background flex shrink-0 items-center gap-2 border-t px-3 py-2"
  style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem);"
>
  <Button variant="secondary" size="icon" aria-label="New tab" onclick={() => editor.openNewTab()}>
    <Icon icon={Add01Icon} />
  </Button>
  <Button variant="secondary" class="flex-1 justify-start" onclick={() => app.openOverlay("quickswitcher")}>
    <Icon icon={Search01Icon} /> Search files…
  </Button>
  <Button variant="secondary" size="icon" aria-label="Preview" onclick={onPreview}>
    <Icon icon={ViewIcon} />
  </Button>

  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button variant="secondary" size="icon" aria-label="Quick actions" {...props}>
          <Icon icon={MenuTwoLineIcon} />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" side="top">
      <DropdownMenu.Item disabled={exporting} onclick={onExport}>
        <Icon icon={Pdf01Icon} /> Export PDF
      </DropdownMenu.Item>
      <DropdownMenu.Item onclick={() => app.openOverlay("diagnostics")}>
        <Icon icon={Alert02Icon} /> Diagnostics
        {#if compileStore.errors.length > 0}
          <span class="text-destructive ml-auto text-xs">{compileStore.errors.length}</span>
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Item onclick={() => app.openOverlay("settings")}>
        <Icon icon={Settings01Icon} /> Settings
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item onclick={() => workspace.close()}>
        <Icon icon={Logout01Icon} /> Close workspace
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
