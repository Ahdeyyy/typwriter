<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import {
    Add01Icon,
    Settings01Icon,
    Folder01Icon,
    FolderExportIcon,
    Package01Icon,
    Delete02Icon,
    ArrowRight01Icon,
    Time04Icon,
    File02Icon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import appIcon from "$lib/assets/app-icon.png";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Drawer from "$lib/components/ui/drawer";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { layout } from "$lib/stores/layout.svelte";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { app } from "$lib/stores/app.svelte";
  import { pathDisplay } from "$lib/stores/path-display.svelte";
  import { longpress } from "$lib/actions/longpress";
  import { openedAgo } from "$lib/time";
  import { exportWorkspace } from "$lib/ipc/commands";
  import { scheduleBodyLockRelease } from "$lib/body-lock";
  import { pickDocument } from "$lib/document-opening";
  import type { WorkspaceMeta } from "$lib/ipc/types";
  import { screen } from "$lib/motion";
  import { fixtureWorkspaces } from "$lib/dev/workspace-fixtures";

  let loading = $state(true);
  let createOpen = $state(false);
  let newName = $state("");
  let menuTarget = $state<WorkspaceMeta | null>(null);
  let confirmingDelete = $state(false);
  let exporting = $state(false);
  let pickingDocument = $state(false);
  let createMenuOpen = $state(false);

  const fabClass =
    "bg-primary text-primary-foreground active:scale-95 fixed flex h-14 items-center justify-center gap-2 rounded-2xl shadow-lg transition-transform duration-150 ease-(--ease-out)";
  // Same touch-sized rows as the editor's quick-actions menu.
  const menuItemClass = "min-h-12 gap-3.5 px-3.5 text-[15px] [&_svg:not([class*='size-'])]:size-6";

  async function openDocument() {
    if (pickingDocument) return;
    pickingDocument = true;
    try {
      await pickDocument();
    } finally {
      pickingDocument = false;
    }
  }

  const INVALID = /[/\\:*?"<>|]/;

  // User workspaces only, most-recent first ("Jump back in" surfaces the
  // freshest one). App-managed entries (the Typst package store) are rendered
  // in their own section below.
  // Dev builds can swap in a fixture list here (see `lib/dev/`).
  const workspaces = $derived(fixtureWorkspaces(workspace.workspaces));
  const sorted = $derived(
    workspaces
      .filter((w) => !w.system)
      .sort((a, b) => (b.lastOpenedMs ?? 0) - (a.lastOpenedMs ?? 0)),
  );
  const recent = $derived<WorkspaceMeta | null>(sorted[0] ?? null);
  const rest = $derived(sorted.slice(1));
  const systemEntries = $derived(workspaces.filter((w) => w.system));
  const userCount = $derived(sorted.length);

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
        scheduleBodyLockRelease();
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
        menuTarget = null;
        confirmingDelete = false;
        scheduleBodyLockRelease();
      },
      (e) => toast.error(`Failed to delete: ${e}`),
    );
  }

  function doExport(meta: WorkspaceMeta) {
    if (exporting) return;
    exporting = true;
    menuTarget = null;
    exportWorkspace(meta.name).match(
      (count) => {
        exporting = false;
        toast.success(`Exported ${count} file${count === 1 ? "" : "s"} from "${meta.name}"`);
      },
      (e) => {
        exporting = false;
        if (e !== "Export cancelled") toast.error(`Export failed: ${e}`);
      },
    );
  }
</script>

<div in:screen={{ scale: 0.98 }} class="bg-background flex flex-col" style="height: 100svh; padding-top: env(safe-area-inset-top);">
  <!-- Tablets centre everything in one reading column and move "Open file" up
       into the header, next to settings. -->
  <header class="flex shrink-0 items-center justify-between gap-2 px-5 pt-4 pb-2 tablet:mx-auto tablet:w-full tablet:max-w-5xl tablet:px-10 tablet:pt-8 tablet:pb-4">
    <div class="flex min-w-0 flex-1 items-center gap-2.5 tablet:gap-3">
      <img src={appIcon} alt="" class="size-9 shrink-0 rounded-xl shadow-sm tablet:size-11" />
      <span class="text-base font-semibold tracking-tight tablet:text-xl">Typwriter</span>
    </div>
    <Button
      variant="secondary"
      class="hidden rounded-full px-5 tablet:inline-flex"
      disabled={pickingDocument}
      onclick={openDocument}
    >
      <Icon icon={File02Icon} /> {pickingDocument ? "Opening…" : "Open file"}
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="rounded-full"
      onclick={() => app.openOverlay("settings")}
      aria-label="Settings"
    >
      <Icon icon={Settings01Icon} class="size-6" />
    </Button>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 tablet:px-10 tablet:pt-2" style="padding-bottom: calc(env(safe-area-inset-bottom) + 6rem);">
    <div class="tablet:mx-auto tablet:max-w-[59rem]">
      {#if loading}
        <div class="flex flex-col gap-3">
          <Skeleton class="h-28 w-full rounded-3xl" />
          <Skeleton class="h-16 w-full rounded-2xl" />
          <Skeleton class="h-16 w-full rounded-2xl" />
        </div>
      {:else if userCount === 0}
        <div class="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <div class="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-3xl">
            <Icon icon={File02Icon} class="size-9" />
          </div>
          <div class="flex flex-col gap-1">
            <p class="text-base font-medium">No workspaces yet</p>
            <p class="text-muted-foreground text-sm">Open a .typ file, or create a workspace for documents with multiple files.</p>
          </div>
          <div class="mt-1 flex flex-col items-center gap-2">
            <Button class="rounded-full px-6" onclick={() => (createOpen = true)}>
              <Icon icon={Add01Icon} /> New workspace
            </Button>
            <!-- No FAB without workspaces, so phones open files from here
                 (tablets keep it in the header). -->
            <Button variant="ghost" class="rounded-full px-6 tablet:hidden" disabled={pickingDocument} onclick={openDocument}>
              <Icon icon={File02Icon} /> {pickingDocument ? "Opening…" : "Open file"}
            </Button>
          </div>
        </div>
      {:else}
        <!-- Jump back in -->
        {#if recent}
          {@const r = recent}
          <button
            class="bg-primary text-primary-foreground active:scale-[0.985] relative mb-6 flex w-full flex-col gap-6 overflow-hidden rounded-3xl p-5 text-left tablet:mb-8 tablet:gap-12 tablet:p-8 shadow-sm transition-transform duration-150 ease-(--ease-out)"
            onclick={() => openWorkspace(r)}
            use:longpress={{ onLongpress: () => (menuTarget = r) }}
          >
            <!-- Decorative oversized glyph -->
            <Icon icon={Folder01Icon} class="pointer-events-none absolute -right-5 -bottom-6 size-36 opacity-10 tablet:-right-8 tablet:-bottom-10 tablet:size-60" />
            <span class="text-primary-foreground/70 text-xs font-medium tracking-wide uppercase">Jump back in</span>
            <div class="flex items-end justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-2xl font-semibold tracking-tight tablet:text-4xl">{r.name}</div>
                {#if pathDisplay.location(r.path)}
                  <div class="text-primary-foreground/70 mt-1 truncate text-xs">{pathDisplay.location(r.path)}</div>
                {/if}
                <div class="text-primary-foreground/70 mt-1 flex items-center gap-1.5 text-xs">
                  <Icon icon={Time04Icon} class="size-4" />
                  {openedAgo(r.lastOpenedMs)}
                </div>
              </div>
              <div class="bg-primary-foreground/15 flex size-11 shrink-0 items-center justify-center rounded-full tablet:size-14">
                <Icon icon={ArrowRight01Icon} class="size-6" />
              </div>
            </div>
          </button>
        {/if}

        <!-- All other workspaces -->
        {#if rest.length > 0}
          <h2 class="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">Workspaces</h2>
          <div class="flex flex-col gap-2 tablet:grid tablet:grid-cols-2 tablet:gap-3 wide:grid-cols-3">
            {#each rest as meta (meta.path)}
              <button
                class="bg-card flex w-full items-center gap-3.5 rounded-2xl border p-3 text-left transition-colors tablet:p-4"
                onclick={() => openWorkspace(meta)}
                use:longpress={{ onLongpress: () => (menuTarget = meta) }}
              >
                <div class="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <Icon icon={Folder01Icon} class="size-6" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[15px] font-medium">{meta.name}</div>
                  <div class="text-muted-foreground truncate text-xs">
                    {#if pathDisplay.location(meta.path)}{pathDisplay.location(meta.path)} · {/if}{openedAgo(meta.lastOpenedMs)}
                  </div>
                </div>
                <Icon icon={ArrowRight01Icon} class="text-muted-foreground/50 size-5 shrink-0" />
              </button>
            {/each}
          </div>
        {/if}
      {/if}

      <!-- App-managed storage (the Typst package store) — clearly not a user
           workspace: its own section, package icon, explanatory subtitle. -->
      {#if !loading && systemEntries.length > 0}
        <h2 class="text-muted-foreground mt-6 mb-2 px-1 text-xs font-medium tracking-wide uppercase">App storage</h2>
        <div class="flex flex-col gap-2 tablet:grid tablet:grid-cols-2 tablet:gap-3 wide:grid-cols-3">
          {#each systemEntries as meta (meta.path)}
            <button
              class="bg-muted/40 flex w-full items-center gap-3.5 rounded-2xl border border-dashed p-3 text-left transition-colors tablet:p-4"
              onclick={() => openWorkspace(meta)}
              use:longpress={{ onLongpress: () => (menuTarget = meta) }}
            >
              <div class="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                <Icon icon={Package01Icon} class="size-6" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium">{meta.name}</span>
                  <span class="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-medium">Managed by app</span>
                </div>
                <div class="text-muted-foreground text-xs">Downloaded Typst packages — not one of your workspaces</div>
              </div>
              <Icon icon={ArrowRight01Icon} class="text-muted-foreground/50 size-5 shrink-0" />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Floating create action. Tablets get an extended "New workspace" FAB (their
     header already has "Open file"); phones get one + that opens both choices,
     so the home screen carries no second full-width button. -->
{#if !loading && userCount > 0}
  {#if layout.tablet}
    <button
      class="{fabClass} right-10 w-auto px-5"
      style="bottom: calc(env(safe-area-inset-bottom) + 1.25rem);"
      onclick={() => (createOpen = true)}
      aria-label="New workspace"
    >
      <Icon icon={Add01Icon} class="size-6" />
      <span class="text-[15px] font-medium">New workspace</span>
    </button>
  {:else}
    <DropdownMenu.Root bind:open={createMenuOpen}>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            class="{fabClass} right-5 size-14"
            style="bottom: calc(env(safe-area-inset-bottom) + 1.25rem);"
            aria-label="Create"
            {...props}
          >
            <!-- + turns into × while the menu is open. -->
            <Icon
              icon={Add01Icon}
              class="size-6 transition-transform duration-200 ease-(--ease-out) {createMenuOpen ? 'rotate-45' : ''}"
            />
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" side="top" sideOffset={12} class="w-56">
        <DropdownMenu.Item class={menuItemClass} disabled={pickingDocument} onclick={openDocument}>
          <Icon icon={File02Icon} /> Open file
        </DropdownMenu.Item>
        <DropdownMenu.Item class={menuItemClass} onclick={() => (createOpen = true)}>
          <Icon icon={Folder01Icon} /> New workspace
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
{/if}

<!-- New workspace dialog -->
<Dialog.Root
  bind:open={createOpen}
  onOpenChange={(o) => {
    if (!o) scheduleBodyLockRelease();
  }}
>
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

<!-- Long-press actions & delete confirmation -->
<Drawer.Root
  open={menuTarget !== null}
  onOpenChange={(o) => {
    if (!o) {
      menuTarget = null;
      confirmingDelete = false;
      scheduleBodyLockRelease();
    }
  }}
>
  <Drawer.Content>
    {#if confirmingDelete && menuTarget}
      <Drawer.Header>
        <Drawer.Title>Delete "{menuTarget.name}"?</Drawer.Title>
        <Drawer.Description>This permanently deletes the workspace and all its files.</Drawer.Description>
      </Drawer.Header>
      <div class="flex flex-col gap-2 p-4 pt-2" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem);">
        <Button
          variant="destructive"
          class="w-full"
          onclick={() => menuTarget && doDelete(menuTarget)}
        >
          <Icon icon={Delete02Icon} />
          Delete workspace
        </Button>
        <Button
          variant="ghost"
          class="w-full"
          onclick={() => (confirmingDelete = false)}
        >
          Cancel
        </Button>
      </div>
    {:else}
      <Drawer.Header>
        <Drawer.Title>{menuTarget?.name}</Drawer.Title>
      </Drawer.Header>
      <div class="flex flex-col gap-1 p-2 pb-6" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem);">
        <Button
          variant="ghost"
          class="justify-start"
          disabled={exporting}
          onclick={() => menuTarget && doExport(menuTarget)}
        >
          <Icon icon={FolderExportIcon} />
          Export to folder…
        </Button>
        {#if !menuTarget?.system}
          <Button
            variant="ghost"
            class="text-destructive justify-start"
            onclick={() => (confirmingDelete = true)}
          >
            <Icon icon={Delete02Icon} />
            Delete workspace
          </Button>
        {/if}
      </div>
    {/if}
  </Drawer.Content>
</Drawer.Root>
