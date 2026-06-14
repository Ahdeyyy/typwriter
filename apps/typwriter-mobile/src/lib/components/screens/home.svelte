<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import {
    Add01Icon,
    Settings01Icon,
    Folder01Icon,
    PencilEdit01Icon,
    Delete02Icon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Drawer from "$lib/components/ui/drawer";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { app } from "$lib/stores/app.svelte";
  import { longpress } from "$lib/actions/longpress";
  import { timeAgo } from "$lib/time";
  import type { WorkspaceMeta } from "$lib/ipc/types";

  let loading = $state(true);
  let createOpen = $state(false);
  let newName = $state("");
  let menuTarget = $state<WorkspaceMeta | null>(null);
  let confirmDelete = $state<WorkspaceMeta | null>(null);

  const INVALID = /[/\\:*?"<>|]/;

  onMount(() => {
    workspace.refreshList().match(
      () => (loading = false),
      (e) => {
        toast.error(`Failed to list workspaces: ${e}`);
        loading = false;
      },
    );
  });

  function validateName(name: string): string | null {
    const n = name.trim();
    if (!n) return "Name cannot be empty";
    if (INVALID.test(n)) return 'Name cannot contain / \\ : * ? " < > |';
    if (workspace.workspaces.some((w) => w.name === n)) return "A workspace with that name exists";
    return null;
  }

  function submitCreate() {
    const name = newName.trim();
    const err = validateName(name);
    if (err) {
      toast.error(err);
      return;
    }
    workspace.create(name).match(
      () => {
        createOpen = false;
        newName = "";
        workspace.open(name).mapErr((e) => toast.error(`Failed to open: ${e}`));
      },
      (e) => toast.error(`Failed to create: ${e}`),
    );
  }

  function openWorkspace(meta: WorkspaceMeta) {
    workspace.open(meta.name).mapErr((e) => toast.error(`Failed to open: ${e}`));
  }

  function doDelete(meta: WorkspaceMeta) {
    workspace.delete(meta.name).match(
      () => {
        toast.success(`Deleted "${meta.name}"`);
        confirmDelete = null;
      },
      (e) => toast.error(`Failed to delete: ${e}`),
    );
  }
</script>

<div class="flex min-h-svh flex-col" style="padding-top: env(safe-area-inset-top);">
  <header class="flex items-center justify-between px-4 py-3">
    <div class="flex items-center gap-2">
      <Icon icon={PencilEdit01Icon} class="text-primary size-6" />
      <h1 class="text-lg font-semibold tracking-tight">Typwriter</h1>
    </div>
    <Button variant="ghost" size="icon" onclick={() => app.openOverlay("settings")} aria-label="Settings">
      <Icon icon={Settings01Icon} />
    </Button>
  </header>

  <div class="flex-1 px-4 pb-4">
    {#if loading}
      <div class="flex flex-col gap-2">
        {#each Array(3) as _}
          <Skeleton class="h-16 w-full rounded-lg" />
        {/each}
      </div>
    {:else if workspace.workspaces.length === 0}
      <div class="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Icon icon={Folder01Icon} class="text-muted-foreground size-12" />
        <p class="text-muted-foreground text-sm">No workspaces yet.</p>
        <p class="text-muted-foreground text-xs">Create one to start writing.</p>
      </div>
    {:else}
      <ScrollArea class="h-[calc(100svh-9rem)]">
        <div class="flex flex-col gap-2">
          {#each workspace.workspaces as meta (meta.path)}
            <button
              class="bg-card active:bg-accent active:text-accent-foreground flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
              onclick={() => openWorkspace(meta)}
              use:longpress={{ onLongpress: () => (menuTarget = meta) }}
            >
              <Icon icon={Folder01Icon} class="text-muted-foreground size-5 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{meta.name}</div>
                <div class="text-muted-foreground text-xs">opened {timeAgo(meta.lastOpenedMs)}</div>
              </div>
            </button>
          {/each}
        </div>
      </ScrollArea>
    {/if}
  </div>

  <div class="px-4" style="padding-bottom: calc(env(safe-area-inset-bottom) + 3.5rem);">
    <Button class="w-full" onclick={() => (createOpen = true)}>
      <Icon icon={Add01Icon} />
      New workspace
    </Button>
  </div>
</div>

<!-- New workspace dialog -->
<Dialog.Root bind:open={createOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>New workspace</Dialog.Title>
      <Dialog.Description>Choose a name for your new Typst workspace.</Dialog.Description>
    </Dialog.Header>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        submitCreate();
      }}
    >
      <Input
        bind:value={newName}
        placeholder="My document"
        autocapitalize="off"
        autocorrect="off"
      />
      <Dialog.Footer class="mt-4">
        <Button type="submit" class="w-full">Create</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- Long-press actions -->
<Drawer.Root open={menuTarget !== null} onOpenChange={(o) => { if (!o) menuTarget = null; }}>
  <Drawer.Content>
    <Drawer.Header>
      <Drawer.Title>{menuTarget?.name}</Drawer.Title>
    </Drawer.Header>
    <div class="flex flex-col gap-1 p-2 pb-6" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem);">
      <Button
        variant="ghost"
        class="text-destructive justify-start"
        onclick={() => {
          confirmDelete = menuTarget;
          menuTarget = null;
        }}
      >
        <Icon icon={Delete02Icon} />
        Delete workspace
      </Button>
    </div>
  </Drawer.Content>
</Drawer.Root>

<!-- Delete confirmation -->
<Dialog.Root open={confirmDelete !== null} onOpenChange={(o) => { if (!o) confirmDelete = null; }}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Delete "{confirmDelete?.name}"?</Dialog.Title>
      <Dialog.Description>This permanently deletes the workspace and all its files.</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="mt-4 flex flex-col gap-2">
      <Button variant="destructive" class="w-full" onclick={() => confirmDelete && doDelete(confirmDelete)}>
        Delete
      </Button>
      <Button variant="ghost" class="w-full" onclick={() => (confirmDelete = null)}>Cancel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
