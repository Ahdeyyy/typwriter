<script lang="ts">
  import {
    Add01Icon,
    Search01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
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
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { exportWorkspace } from "$lib/ipc/commands";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";

  let { onExport, onFormat, exporting }: {
    onExport: () => void;
    onFormat: () => void;
    exporting: boolean;
  } = $props();

  // Only typst buffers can be formatted; disable otherwise.
  const canFormat = $derived(editor.fileKind === "text" && !!editor.relPath?.endsWith(".typ"));

  // Number shown in the tab-switcher button (open tabs + a pending new tab).
  const tabCount = $derived(editor.tabs.length + (editor.newTabOpen ? 1 : 0));

  // Step to the previous/next open tab, wrapping. From an empty new tab (no
  // active file), forward lands on the first tab and back on the last.
  function cycleTab(delta: number) {
    const tabs = editor.tabs;
    const n = tabs.length;
    if (n === 0) return;
    const cur = editor.relPath ? tabs.indexOf(editor.relPath) : -1;
    const idx = cur < 0 ? (delta > 0 ? 0 : n - 1) : (cur + delta + n) % n;
    const rel = tabs[idx];
    if (rel && !editor.isActiveTab(rel)) {
      editor.loadFile(rel).mapErr((e) => toast.error(`Failed to open: ${e}`));
    }
  }

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

<!-- Floating pill dock (browser-style). Transparent wrapper keeps the pill off
     the screen edges and above the home-indicator safe area. -->
<div
  class="shrink-0 px-3 pt-1 pb-2"
  style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem);"
>
  <div class="bg-muted flex h-12 items-center justify-between gap-1 rounded-full border px-2 shadow-lg">
    <button
      class="active:bg-accent active:text-accent-foreground text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      aria-label="Previous tab"
      onclick={() => cycleTab(-1)}
    >
      <Icon icon={ArrowLeft01Icon} class="size-5" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      aria-label="Next tab"
      onclick={() => cycleTab(1)}
    >
      <Icon icon={ArrowRight01Icon} class="size-5" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      aria-label="Search files"
      onclick={() => app.openOverlay("quickswitcher")}
    >
      <Icon icon={Search01Icon} class="size-5" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      aria-label="New tab"
      onclick={() => editor.openNewTab()}
    >
      <Icon icon={Add01Icon} class="size-5" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      aria-label="Show tabs"
      onclick={() => app.openOverlay("tabswitcher")}
    >
      <span class="border-current flex h-6 min-w-6 items-center justify-center rounded-md border-2 px-1 text-xs font-semibold tabular-nums">
        {tabCount}
      </span>
    </button>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            class="active:bg-accent active:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
            aria-label="Quick actions"
            {...props}
          >
            <Icon icon={Menu01Icon} class="size-5" />
          </button>
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
</div>
