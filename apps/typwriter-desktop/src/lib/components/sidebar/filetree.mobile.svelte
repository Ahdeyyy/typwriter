<script lang="ts">
  // Mobile file tree. Differences from desktop:
  //   - Persistent (always-visible) row action buttons
  //   - Long-press AND right-click both open the context menu
  //   - Create flow uses a shadcn Dialog (mobile keyboard doesn't play
  //     nicely with @pierre/trees' inline rename)
  //   - Shows an "Export workspace" toolbar button (desktop exports via
  //     the export-dialog).
  import { onMount, onDestroy } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    FilePlusIcon,
    FolderAddIcon,
    UnfoldLessIcon,
    FileImportIcon,
    FileExportIcon,
  } from "@hugeicons/core-free-icons";
  import { ChevronsUpDownIcon } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { toast } from "svelte-sonner";
  import { FiletreeController } from "./filetree-controller.svelte";

  // Mobile dialog state.
  let dialogOpen = $state(false);
  let dialogKind = $state<"file" | "folder">("file");
  let dialogParent = $state(""); // "" = workspace root
  let dialogName = $state("");
  let dialogSubmitting = $state(false);

  function openDialog(parent: string, kind: "file" | "folder") {
    dialogKind = kind;
    dialogParent = parent;
    dialogName = "";
    dialogOpen = true;
  }

  const controller = new FiletreeController({
    contextMenuTriggerMode: "both",
    contextMenuButtonVisibility: "always",
    onRequestCreate: openDialog,
  });

  let treeMount = $state<HTMLDivElement | null>(null);

  onMount(() => {
    if (treeMount) controller.mount(treeMount);
  });

  onDestroy(() => controller.destroy());

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

  // ─── Toolbar root create ─────────────────────────────────────────────

  function startRootCreate(kind: "file" | "folder") {
    openDialog("", kind);
  }

  // ─── Dialog submit ───────────────────────────────────────────────────

  async function submitDialogCreate() {
    if (dialogSubmitting) return;
    const trimmed = dialogName.trim();
    if (!trimmed) return;
    dialogSubmitting = true;
    const result = await controller.submitDialogCreate(
      dialogParent,
      trimmed,
      dialogKind,
    );
    dialogSubmitting = false;
    if (!result) return;
    result.match(
      () => {
        dialogOpen = false;
        dialogName = "";
      },
      (err) => toast.error(`Create failed: ${err}`),
    );
  }

  function handleDialogKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitDialogCreate();
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
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => controller.exportWorkspace()}
            disabled={controller.exportingWorkspace}
          >
            <HugeiconsIcon icon={FileExportIcon} class="size-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Export workspace…</Tooltip.Content>
    </Tooltip.Root>
  </div>
</div>

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
    class="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
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

<!-- ─── Mobile create dialog ───────────────────────────────────────── -->
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        {dialogKind === "folder" ? "New Folder" : "New File"}
      </Dialog.Title>
      <Dialog.Description>
        {dialogParent
          ? `Inside ${dialogParent}`
          : "At workspace root"}
      </Dialog.Description>
    </Dialog.Header>

    <div class="py-2">
      <Input
        autofocus
        placeholder={dialogKind === "folder" ? "folder-name" : "file.typ"}
        bind:value={dialogName}
        onkeydown={handleDialogKey}
        disabled={dialogSubmitting}
      />
    </div>

    <Dialog.Footer>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" disabled={dialogSubmitting}>
            Cancel
          </Button>
        {/snippet}
      </Dialog.Close>
      <Button
        onclick={submitDialogCreate}
        disabled={dialogSubmitting || !dialogName.trim()}
      >
        {dialogSubmitting ? "Creating…" : "Create"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
