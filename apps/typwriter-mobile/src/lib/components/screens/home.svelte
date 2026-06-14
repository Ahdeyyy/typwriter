<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import {
    Add01Icon,
    Settings01Icon,
    Folder01Icon,
    PencilEdit01Icon,
    Delete02Icon,
    ArrowRight01Icon,
    Time04Icon,
    File02Icon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Drawer from "$lib/components/ui/drawer";
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

  // Most-recent first, so "Jump back in" surfaces the freshest workspace.
  const sorted = $derived(
    [...workspace.workspaces].sort((a, b) => (b.lastOpenedMs ?? 0) - (a.lastOpenedMs ?? 0)),
  );
  const recent = $derived<WorkspaceMeta | null>(sorted[0] ?? null);
  const rest = $derived(sorted.slice(1));

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

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

<div class="bg-background flex flex-col" style="height: 100svh; padding-top: env(safe-area-inset-top);">
  <!-- Header -->
  <header class="flex shrink-0 items-center justify-between px-5 pt-4 pb-2">
    <div class="flex items-center gap-2.5">
      <div class="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl shadow-sm">
        <Icon icon={PencilEdit01Icon} class="size-5" />
      </div>
      <span class="text-base font-semibold tracking-tight">Typwriter</span>
    </div>
    <Button
      variant="ghost"
      size="icon"
      class="rounded-full"
      onclick={() => app.openOverlay("settings")}
      aria-label="Settings"
    >
      <Icon icon={Settings01Icon} class="size-5" />
    </Button>
  </header>

  <!-- Greeting -->
  <div class="shrink-0 px-5 pt-2 pb-4">
    <h1 class="text-2xl font-semibold tracking-tight">{greeting}</h1>
    <p class="text-muted-foreground mt-0.5 text-sm">
      {#if loading}
        Loading your workspaces…
      {:else if workspace.workspaces.length === 0}
        Create a workspace to start writing.
      {:else}
        {workspace.workspaces.length} workspace{workspace.workspaces.length === 1 ? "" : "s"} · pick up where you left off
      {/if}
    </p>
  </div>

  <!-- Content -->
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5" style="padding-bottom: calc(env(safe-area-inset-bottom) + 6rem);">
    {#if loading}
      <div class="flex flex-col gap-3">
        <Skeleton class="h-28 w-full rounded-3xl" />
        <Skeleton class="h-16 w-full rounded-2xl" />
        <Skeleton class="h-16 w-full rounded-2xl" />
      </div>
    {:else if workspace.workspaces.length === 0}
      <div class="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <div class="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-3xl">
          <Icon icon={File02Icon} class="size-9" />
        </div>
        <div class="flex flex-col gap-1">
          <p class="text-base font-medium">No workspaces yet</p>
          <p class="text-muted-foreground text-sm">Your Typst documents live in workspaces. Create your first one to begin.</p>
        </div>
        <Button class="mt-1 rounded-full px-6" onclick={() => (createOpen = true)}>
          <Icon icon={Add01Icon} /> New workspace
        </Button>
      </div>
    {:else}
      <!-- Jump back in -->
      {#if recent}
        {@const r = recent}
        <button
          class="bg-primary text-primary-foreground active:scale-[0.985] relative mb-6 flex w-full flex-col gap-6 overflow-hidden rounded-3xl p-5 text-left shadow-sm transition-transform"
          onclick={() => openWorkspace(r)}
          use:longpress={{ onLongpress: () => (menuTarget = r) }}
        >
          <!-- Decorative oversized glyph -->
          <Icon icon={Folder01Icon} class="pointer-events-none absolute -right-5 -bottom-6 size-36 opacity-10" />
          <span class="text-primary-foreground/70 text-xs font-medium tracking-wide uppercase">Jump back in</span>
          <div class="flex items-end justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-2xl font-semibold tracking-tight">{r.name}</div>
              <div class="text-primary-foreground/70 mt-1 flex items-center gap-1.5 text-xs">
                <Icon icon={Time04Icon} class="size-3.5" />
                opened {timeAgo(r.lastOpenedMs)}
              </div>
            </div>
            <div class="bg-primary-foreground/15 flex size-11 shrink-0 items-center justify-center rounded-full">
              <Icon icon={ArrowRight01Icon} class="size-5" />
            </div>
          </div>
        </button>
      {/if}

      <!-- All other workspaces -->
      {#if rest.length > 0}
        <h2 class="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">Workspaces</h2>
        <div class="flex flex-col gap-2">
          {#each rest as meta (meta.path)}
            <button
              class="bg-card active:bg-accent active:text-accent-foreground flex w-full items-center gap-3.5 rounded-2xl border p-3 text-left transition-colors"
              onclick={() => openWorkspace(meta)}
              use:longpress={{ onLongpress: () => (menuTarget = meta) }}
            >
              <div class="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-xl">
                <Icon icon={Folder01Icon} class="size-5" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{meta.name}</div>
                <div class="text-muted-foreground text-xs">opened {timeAgo(meta.lastOpenedMs)}</div>
              </div>
              <Icon icon={ArrowRight01Icon} class="text-muted-foreground/50 size-4 shrink-0" />
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Floating "new workspace" action -->
{#if !loading && workspace.workspaces.length > 0}
  <button
    class="bg-primary text-primary-foreground active:scale-95 fixed flex size-14 items-center justify-center rounded-2xl shadow-lg transition-transform"
    style="right: 1.25rem; bottom: calc(env(safe-area-inset-bottom) + 1.25rem);"
    onclick={() => (createOpen = true)}
    aria-label="New workspace"
  >
    <Icon icon={Add01Icon} class="size-6" />
  </button>
{/if}

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
