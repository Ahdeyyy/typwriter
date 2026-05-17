<script lang="ts">
  // Desktop file tree. Mobile variant lives in filetree.mobile.svelte;
  // shared logic lives in filetree-controller.svelte.ts.
  import { onMount, onDestroy, tick } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    FilePlusIcon,
    FolderAddIcon,
    UnfoldLessIcon,
    FileImportIcon,
  } from "@hugeicons/core-free-icons";
  import { ChevronsUpDownIcon } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { FiletreeController } from "./filetree-controller.svelte";

  const controller = new FiletreeController({
    contextMenuTriggerMode: "right-click",
    contextMenuButtonVisibility: "when-needed",
  });

  let treeMount = $state<HTMLDivElement | null>(null);

  onMount(() => {
    if (treeMount) controller.mount(treeMount);
  });

  onDestroy(() => controller.destroy());

  // Reactive sync between workspace state and the Pierre tree instance.
  $effect(() => {
    workspace.tree;
    controller.syncPaths();
  });
  $effect(() => {
    workspace.activeFilePath;
    controller.syncActiveSelection();
  });
  $effect(() => {
    workspace.mainFile;
    controller.syncMainFileDecoration();
  });

  // ─── Toolbar: root-level inline create ───────────────────────────────

  let creatingRoot = $state<"file" | "folder" | null>(null);
  let newRootName = $state("");
  let rootCreateInputEl = $state<HTMLInputElement | null>(null);
  let blurGuardUntil = $state(0);

  async function startRootCreate(kind: "file" | "folder") {
    creatingRoot = kind;
    newRootName = "";
    await tick();
    blurGuardUntil = Date.now() + 80;
    rootCreateInputEl?.focus();
  }

  async function commitRootCreate() {
    const name = newRootName.trim();
    const kind = creatingRoot;
    creatingRoot = null;
    newRootName = "";
    if (!name || !kind) return;
    await controller.startCreateAtRoot(name, kind);
  }

  function cancelRootCreate() {
    if (Date.now() < blurGuardUntil) return;
    creatingRoot = null;
    newRootName = "";
  }

  function handleRootCreateKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRootCreate();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelRootCreate();
    }
  }
</script>

<!-- ─── Toolbar ────────────────────────────────────────────────────── -->
<div
  class="flex h-9 shrink-0 items-center justify-between border-b border-sidebar-border px-2 mb-1.5"
>
  <div class="flex items-center gap-0.5 shrink-0">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => (controller.anyFolderExpanded ? controller.collapseAll() : controller.expandAll())}
          >
            {#if controller.anyFolderExpanded}
              <HugeiconsIcon icon={UnfoldLessIcon} class="size-4" />
            {:else}
              <ChevronsUpDownIcon class="size-4" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>{controller.anyFolderExpanded ? "Collapse all" : "Expand all"}</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => startRootCreate("file")}
          >
            <HugeiconsIcon icon={FilePlusIcon} class="size-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>New file</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => startRootCreate("folder")}
          >
            <HugeiconsIcon icon={FolderAddIcon} class="size-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>New folder</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => controller.importToRoot()}
          >
            <HugeiconsIcon icon={FileImportIcon} class="size-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Import files to root</Tooltip.Content>
    </Tooltip.Root>
  </div>
</div>

<!-- ─── Inline root create input ───────────────────────────────────── -->
{#if creatingRoot}
  <div class="shrink-0 border-b border-sidebar-border px-2 py-1">
    <input
      bind:this={rootCreateInputEl}
      class="h-5 w-full rounded border border-input bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      placeholder={creatingRoot === "folder" ? "folder-name" : "file.typ"}
      bind:value={newRootName}
      onkeydown={handleRootCreateKey}
      onblur={cancelRootCreate}
    />
  </div>
{/if}

<!-- ─── Pierre tree mount ──────────────────────────────────────────── -->
<div
  bind:this={treeMount}
  class="trees-host flex-1 min-h-0"
  style:--trees-theme-sidebar-bg="var(--sidebar)"
  style:--trees-theme-sidebar-fg="var(--sidebar-foreground)"
  style:--trees-theme-sidebar-header-fg="var(--sidebar-foreground)"
  style:--trees-theme-sidebar-border="var(--sidebar-border)"
  style:--trees-theme-list-hover-bg="var(--sidebar-accent)"
  style:--trees-theme-list-active-selection-bg="var(--sidebar-accent)"
  style:--trees-theme-list-active-selection-fg="var(--sidebar-accent-foreground)"
  style:--trees-theme-focus-ring="var(--sidebar-ring)"
  style:--trees-theme-input-bg="var(--background)"
  style:--trees-font-size="12px"
  style:--trees-item-height="26px"
  style:--trees-padding-inline="8px"
  style:--trees-item-padding-x="6px"
></div>

<!-- ─── Custom context menu ────────────────────────────────────────── -->
{#if controller.menuState}
  <div
    class="fixed inset-0 z-40"
    onclick={() => controller.closeMenu()}
    oncontextmenu={(e) => {
      e.preventDefault();
      controller.closeMenu();
    }}
    role="presentation"
  ></div>
  <div
    data-file-tree-context-menu-root="true"
    class="fixed z-50 w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    style:top="{controller.menuState.rect.y + controller.menuState.rect.height}px"
    style:left="{controller.menuState.rect.x}px"
    role="menu"
  >
    {#if controller.menuIsDir}
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={() => controller.menuCreateChild("file")}
      >
        New File
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={() => controller.menuCreateChild("folder")}
      >
        New Folder
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={() => controller.menuImport()}
      >
        Import Files…
      </Button>
      <div class="-mx-1 my-1 h-px bg-border"></div>
    {:else}
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={() => controller.menuOpen()}
      >
        Open
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={() => controller.menuSave()}
      >
        Save Document
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        disabled={!controller.menuIsTyp}
        onclick={() => controller.menuFormat()}
      >
        Format Document
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        disabled={controller.menuIsMain}
        onclick={() => controller.menuSetMain()}
      >
        Set as Main File
      </Button>
      <div class="-mx-1 my-1 h-px bg-border"></div>
    {/if}
    <Button
      variant="ghost"
      class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
      onclick={() => controller.menuRename()}
    >
      Rename
    </Button>
    <Button
      variant="destructive"
      class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
      onclick={() => controller.menuDelete()}
    >
      Delete
    </Button>
  </div>
{/if}
