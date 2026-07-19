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
    MagicWand01Icon,
    FolderExportIcon,
  } from "@hugeicons/core-free-icons";
  import { toast } from "svelte-sonner";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { exportWorkspace } from "$lib/ipc/commands";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";

  let { onPreview, onExport, onFormat, exporting }: {
    onPreview: () => void;
    onExport: () => void;
    onFormat: () => void;
    exporting: boolean;
  } = $props();

  // Only typst buffers can be formatted; disable otherwise.
  const canFormat = $derived(editor.fileKind === "text" && !!editor.relPath?.endsWith(".typ"));

  // Copy the whole open workspace to a user-chosen folder. Flush pending edits
  // first so the copy contains what's on screen.
  let exportingWorkspace = $state(false);
  async function exportWorkspaceCopy() {
    const name = workspace.name;
    if (!name || exportingWorkspace) return;
    exportingWorkspace = true;
    await editor.flush();
    exportWorkspace(name).match(
      (count) => {
        exportingWorkspace = false;
        toast.success(`Exported ${count} file${count === 1 ? "" : "s"}`);
      },
      (e) => {
        exportingWorkspace = false;
        if (e !== "Export cancelled") toast.error(`Export failed: ${e}`);
      },
    );
  }

  // Larger touch targets than the default dropdown item (which is sized for a
  // mouse): taller rows, bigger gap/icon, readable text.
  const itemClass = "min-h-11 gap-3 px-3 text-sm [&_svg:not([class*='size-'])]:size-5";
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
    <DropdownMenu.Content align="end" side="top" class="w-56">
      <DropdownMenu.Item class={itemClass} disabled={!canFormat} onclick={onFormat}>
        <Icon icon={MagicWand01Icon} /> Format file
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} disabled={exporting} onclick={onExport}>
        <Icon icon={Pdf01Icon} /> Export PDF
      </DropdownMenu.Item>
      <DropdownMenu.Item
        class={itemClass}
        disabled={exportingWorkspace}
        onclick={() => void exportWorkspaceCopy()}
      >
        <Icon icon={FolderExportIcon} /> Export workspace…
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} onclick={() => app.openOverlay("diagnostics")}>
        <Icon icon={Alert02Icon} /> Diagnostics
        {#if compileStore.errors.length > 0}
          <span class="text-destructive ml-auto text-xs">{compileStore.errors.length}</span>
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} onclick={() => app.openOverlay("settings")}>
        <Icon icon={Settings01Icon} /> Settings
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item class={itemClass} onclick={() => workspace.close()}>
        <Icon icon={Logout01Icon} /> Close workspace
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
