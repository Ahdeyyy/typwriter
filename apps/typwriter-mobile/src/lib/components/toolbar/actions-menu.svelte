<script lang="ts">
  import {
    Pdf01Icon,
    Alert02Icon,
    Settings01Icon,
    Logout01Icon,
    Menu01Icon,
    MagicWand01Icon,
    FolderExportIcon,
  } from "@hugeicons/core-free-icons";
  import { toast } from "svelte-sonner";
  import Icon from "$lib/components/icon.svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { exportWorkspace } from "$lib/ipc/commands";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";

  // The editor's quick-actions menu. The phone dock opens it upwards from the
  // bottom edge; the tablet header opens it downwards.
  let {
    onFormat,
    side = "top",
    triggerClass = "",
  }: { onFormat: () => void; side?: "top" | "bottom"; triggerClass?: string } = $props();

  // Only typst buffers can be formatted; disable otherwise.
  const canFormat = $derived(editor.fileKind === "text" && !!editor.relPath?.endsWith(".typ"));

  // Copy the whole open workspace to a user-chosen folder. Flush pending edits
  // first so the copy contains what's on screen.
  let exportingWorkspace = $state(false);
  async function exportWorkspaceCopy() {
    const name = workspace.name;
    if (!name || exportingWorkspace) return;
    exportingWorkspace = true;
    const version = workspace.version;
    try {
      const saved = await editor.flush();
      if (saved.isErr()) {
        toast.error(`Export failed: ${saved.error}`);
        return;
      }
      if (version !== workspace.version || workspace.isOpening) return;
      const result = await exportWorkspace(name);
      result.match(
        (count) => toast.success(`Exported ${count} file${count === 1 ? "" : "s"}`),
        (e) => {
          if (e !== "Export cancelled") toast.error(`Export failed: ${e}`);
        },
      );
    } finally {
      exportingWorkspace = false;
    }
  }

  // Larger touch targets than the default dropdown item (which is sized for a
  // mouse): taller rows, bigger gap/icon, readable text.
  const itemClass = "min-h-12 gap-3.5 px-3.5 text-[15px] [&_svg:not([class*='size-'])]:size-6";
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <button
        class="aria-expanded:bg-foreground/10 text-foreground flex size-11 shrink-0 items-center justify-center rounded-full {triggerClass}"
        aria-label="Quick actions"
        {...props}
      >
        <Icon icon={Menu01Icon} class="size-6" />
      </button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" {side} class="w-56">
    <DropdownMenu.Item class={itemClass} disabled={!canFormat} onclick={onFormat}>
      <Icon icon={MagicWand01Icon} /> Format file
    </DropdownMenu.Item>
    <DropdownMenu.Item class={itemClass} onclick={() => app.openOverlay("export")}>
      <Icon icon={Pdf01Icon} /> Export…
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
