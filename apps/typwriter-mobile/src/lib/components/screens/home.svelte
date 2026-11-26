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
    FolderOpenIcon,
    FolderSyncIcon,
    Location01Icon,
    Cancel01Icon,
    Unlink02Icon,
  } from "@hugeicons/core-free-icons";
  import Icon from "#lib/components/icon.svelte";
  import appIcon from "#lib/assets/app-icon.png";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import * as Dialog from "#lib/components/ui/dialog/index.ts";
  import * as Drawer from "#lib/components/ui/drawer/index.ts";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.ts";
  import { layout } from "#lib/stores/layout.svelte.ts";
  import { Skeleton } from "#lib/components/ui/skeleton/index.ts";
  import { workspace } from "#lib/stores/workspace.svelte.ts";
  import { app } from "#lib/stores/app.svelte.ts";
  import { dismissOnBack } from "#lib/back-dismiss.svelte.ts";
  import { pathDisplay } from "#lib/stores/path-display.svelte.ts";
  import { longpress } from "#lib/actions/longpress.ts";
  import { openedAgo } from "#lib/time.ts";
  import { exportWorkspace } from "#lib/ipc/commands.ts";
  import { scheduleBodyLockRelease } from "#lib/body-lock.ts";
  import { pickDocument } from "#lib/document-opening.ts";
  import type { WorkspaceMeta } from "#lib/ipc/types.ts";
  import { screen } from "#lib/motion.ts";
  import { Switch } from "#lib/components/ui/switch/index.ts";
  import FolderStorageDialog from "#lib/components/folder-storage-dialog.svelte";
  import SyncTradeoffs from "#lib/components/sync-tradeoffs.svelte";

  // Syncing with a folder is a per-workspace choice, and every way into it
  // (new workspace, open folder, move a workspace) shows what it costs first.
  /** What the sync confirmation is about to do, or null when it is closed. */
  let syncConfirm = $state<{ kind: "open" } | { kind: "move"; meta: WorkspaceMeta } | null>(null);
  let syncBusy = $state(false);
  /** "New workspace": sync this one with a folder. Off by default. */
  let newSyncs = $state(false);

  let loading = $state(true);
  let createOpen = $state(false);
  dismissOnBack(() => createOpen, () => (createOpen = false));
  let newName = $state("");
  let menuTarget = $state<WorkspaceMeta | null>(null);
  dismissOnBack(() => menuTarget !== null, () => (menuTarget = null));
  let confirmingDelete = $state(false);
  let exporting = $state(false);
  let pickingDocument = $state(false);
  let createMenuOpen = $state(false);
  dismissOnBack(() => createMenuOpen, () => (createMenuOpen = false));
  let creating = $state(false);
  let addingFolder = $state(false);
  let confirmingStop = $state(false);

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
  const sorted = $derived(
    workspace.workspaces
      .filter((w) => !w.system)
      .sort((a, b) => (b.lastOpenedMs ?? 0) - (a.lastOpenedMs ?? 0)),
  );
  const recent = $derived<WorkspaceMeta | null>(sorted[0] ?? null);
  const rest = $derived(sorted.slice(1));
  const systemEntries = $derived(workspace.workspaces.filter((w) => w.system));
  const userCount = $derived(sorted.length);

  onMount(() => {
    // Home is where the user goes after leaving a workspace: a folder
    // workspace stops syncing here rather than polling a folder nobody is
    // looking at.
    workspace.stopSync().mapErr((e) => console.error("stop sync:", e));
    workspace.refreshLocation().mapErr((e) => console.error("workspace location:", e));
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
    return null;
  }

  function changeLocation() {
    workspace.pickLocation().mapErr((e) => toast.error(`Couldn't use that folder: ${e}`));
  }

  async function submitCreate() {
    const name = newName.trim();
    const err = validateName(name);
    if (err) {
      toast.error(err);
      return;
    }
    if (creating) return;
    creating = true;
    try {
      // The first synced workspace asks where to put it; later ones reuse it.
      if (newSyncs && !workspace.location) {
        const picked = await workspace.pickLocation();
        if (picked.isErr()) {
          toast.error(`Couldn't use that folder: ${picked.error}`);
          return;
        }
        if (!picked.value) return;
      }
      const created = await workspace.create(name, newSyncs);
      if (created.isErr()) {
        toast.error(`Failed to create: ${created.error}`);
        return;
      }
      createOpen = false;
      newName = "";
      newSyncs = false;
      scheduleBodyLockRelease();
      workspace.open(created.value).mapErr((e) => toast.error(`Failed to open: ${e}`));
    } finally {
      creating = false;
    }
  }

  async function addFolder() {
    if (addingFolder) return;
    addingFolder = true;
    try {
      const added = await workspace.addFolder();
      if (added.isErr()) toast.error(`Couldn't open that folder: ${added.error}`);
      else if (added.value) {
        closeSyncConfirm();
        workspace.open(added.value).mapErr((e) => toast.error(`Failed to open: ${e}`));
      }
    } finally {
      addingFolder = false;
    }
  }

  function closeSyncConfirm() {
    syncConfirm = null;
    scheduleBodyLockRelease();
  }

  /** "Sync with a folder…" on one workspace: copy it into a folder the user
   *  picks, then it syncs with it. */
  async function moveToFolder(meta: WorkspaceMeta) {
    if (syncBusy) return;
    syncBusy = true;
    try {
      const result = await workspace.moveToFolder(meta.id);
      if (result.isErr()) {
        toast.error(`Couldn't move "${meta.name}"`, { description: result.error });
        return;
      }
      if (!result.value) return;
      closeSyncConfirm();
      toast.success(`"${meta.name}" now syncs with ${workspace.location ?? "the folder"}`);
    } finally {
      syncBusy = false;
    }
  }

  function confirmSync() {
    const action = syncConfirm;
    if (!action) return;
    if (action.kind === "open") void addFolder();
    else void moveToFolder(action.meta);
  }

  /** "Stop syncing": bring a folder workspace back into the app. */
  async function stopSyncing(meta: WorkspaceMeta) {
    if (syncBusy) return;
    syncBusy = true;
    try {
      const result = await workspace.moveToApp(meta.id);
      if (result.isErr()) {
        toast.error(`Couldn't stop syncing "${meta.name}"`, { description: result.error });
        return;
      }
      menuTarget = null;
      confirmingStop = false;
      scheduleBodyLockRelease();
      toast.success(`"${meta.name}" is now stored in the app`, {
        description: `Its folder in ${meta.path} was left as it is.`,
      });
    } finally {
      syncBusy = false;
    }
  }

  function openWorkspace(meta: WorkspaceMeta) {
    workspace.open(meta.id).mapErr((e) => toast.error(`Failed to open: ${e}`));
  }

  function doDelete(meta: WorkspaceMeta) {
    workspace.delete(meta.id).match(
      () => {
        toast.success(meta.kind === "folder" ? `Removed "${meta.name}" from the list` : `Deleted "${meta.name}"`);
        menuTarget = null;
        confirmingDelete = false;
        scheduleBodyLockRelease();
      },
      (e) => toast.error(`Failed to ${meta.kind === "folder" ? "remove" : "delete"}: ${e}`),
    );
  }

  function doExport(meta: WorkspaceMeta) {
    if (exporting) return;
    exporting = true;
    menuTarget = null;
    exportWorkspace(meta.id).match(
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

<div in:screen={{ scale: 0.98 }} class="bg-background flex flex-col" style="height: 100svh; padding-top: var(--safe-top);">
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
      variant="secondary"
      class="hidden rounded-full px-5 tablet:inline-flex"
      disabled={addingFolder}
      onclick={() => (syncConfirm = { kind: "open" })}
    >
      <Icon icon={FolderOpenIcon} /> Open folder
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

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 tablet:px-10 tablet:pt-2" style="padding-bottom: calc(var(--safe-bottom) + 6rem);">
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
            <Button variant="ghost" class="rounded-full px-6" disabled={addingFolder} onclick={() => (syncConfirm = { kind: "open" })}>
              <Icon icon={FolderOpenIcon} /> Open folder
            </Button>
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
                {#if r.kind === "folder"}
                  <div class="text-primary-foreground/70 mt-1 flex items-center gap-1.5 text-xs">
                    <Icon icon={FolderSyncIcon} class="size-4 shrink-0" />
                    <span class="truncate">{r.path}</span>
                  </div>
                {:else if pathDisplay.location(r.path)}
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
            {#each rest as meta (meta.id)}
              <button
                class="bg-card flex w-full items-center gap-3.5 rounded-2xl border p-3 text-left transition-colors tablet:p-4"
                onclick={() => openWorkspace(meta)}
                use:longpress={{ onLongpress: () => (menuTarget = meta) }}
              >
                <div class="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <!-- A synced workspace is told apart by its icon alone. -->
                  <Icon icon={meta.kind === "folder" ? FolderSyncIcon : Folder01Icon} class="size-6" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[15px] font-medium">{meta.name}</div>
                  <div class="text-muted-foreground truncate text-xs">
                    {#if meta.kind === "folder"}{meta.path} · {:else if pathDisplay.location(meta.path)}{pathDisplay.location(meta.path)} · {/if}{openedAgo(meta.lastOpenedMs)}
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
          {#each systemEntries as meta (meta.id)}
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
      style="bottom: calc(var(--safe-bottom) + 1.25rem);"
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
            style="bottom: calc(var(--safe-bottom) + 1.25rem);"
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
        <DropdownMenu.Item class={menuItemClass} disabled={addingFolder} onclick={() => (syncConfirm = { kind: "open" })}>
          <Icon icon={FolderOpenIcon} /> Open folder
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
        void submitCreate();
      }}
    >
      <Input
        bind:value={newName}
        placeholder="My document"
        autocapitalize="off"
        autocorrect="off"
      />
      <!-- Per workspace, off by default: the costs show as soon as it's on. -->
      <label class="mt-4 flex items-center justify-between gap-3">
        <span class="flex min-w-0 flex-col">
          <span class="text-sm font-medium">Sync with a folder</span>
          <span class="text-muted-foreground text-xs">For a sync app like Syncthing</span>
        </span>
        <Switch bind:checked={newSyncs} aria-label="Sync with a folder" />
      </label>
      {#if newSyncs}
        <div class="bg-muted/50 mt-3 flex flex-col gap-3 rounded-xl p-3">
          <SyncTradeoffs />
          <div class="border-border/60 flex items-center gap-3 border-t pt-2.5">
            <Icon icon={Location01Icon} class="text-muted-foreground size-5 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="text-muted-foreground text-xs">Folder</div>
              <div class="truncate text-sm">{workspace.location ?? "Not chosen yet"}</div>
            </div>
            <Button type="button" variant="ghost" size="sm" onclick={changeLocation}>
              {workspace.location ? "Change" : "Choose"}
            </Button>
          </div>
        </div>
      {/if}
      <Dialog.Footer class="mt-4">
        <Button type="submit" class="w-full" disabled={creating}>{creating ? "Creating…" : "Create"}</Button>
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
      confirmingStop = false;
      scheduleBodyLockRelease();
    }
  }}
>
  <Drawer.Content>
    {#if confirmingStop && menuTarget}
      <Drawer.Header>
        <Drawer.Title>Stop syncing "{menuTarget.name}"?</Drawer.Title>
        <Drawer.Description>
          It moves back into the app. The folder in {menuTarget.path} keeps its files.
        </Drawer.Description>
      </Drawer.Header>
      <div class="flex flex-col gap-2 p-4 pt-2" style="padding-bottom: calc(var(--safe-bottom) + 1rem);">
        <Button class="w-full" disabled={syncBusy} onclick={() => menuTarget && void stopSyncing(menuTarget)}>
          {syncBusy ? "Moving…" : "Stop syncing"}
        </Button>
        <Button variant="ghost" class="w-full" disabled={syncBusy} onclick={() => (confirmingStop = false)}>
          Cancel
        </Button>
      </div>
    {:else if confirmingDelete && menuTarget}
      <Drawer.Header>
        {#if menuTarget.kind === "folder"}
          <Drawer.Title>Remove "{menuTarget.name}" from the list?</Drawer.Title>
          <Drawer.Description>Its files stay in {menuTarget.path}. You can open the folder again at any time.</Drawer.Description>
        {:else}
          <Drawer.Title>Delete "{menuTarget.name}"?</Drawer.Title>
          <Drawer.Description>This permanently deletes the workspace and all its files.</Drawer.Description>
        {/if}
      </Drawer.Header>
      <div class="flex flex-col gap-2 p-4 pt-2" style="padding-bottom: calc(var(--safe-bottom) + 1rem);">
        <Button
          variant="destructive"
          class="w-full"
          onclick={() => menuTarget && doDelete(menuTarget)}
        >
          {#if menuTarget.kind === "folder"}
            <Icon icon={Cancel01Icon} />
            Remove from list
          {:else}
            <Icon icon={Delete02Icon} />
            Delete workspace
          {/if}
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
      <div class="flex flex-col gap-1 p-2 pb-6" style="padding-bottom: calc(var(--safe-bottom) + 1rem);">
        <Button
          variant="ghost"
          class="justify-start"
          disabled={exporting}
          onclick={() => menuTarget && doExport(menuTarget)}
        >
          <Icon icon={FolderExportIcon} />
          Export to folder…
        </Button>
        {#if menuTarget && !menuTarget.system}
          {#if menuTarget.kind === "folder"}
            <Button variant="ghost" class="justify-start" onclick={() => (confirmingStop = true)}>
              <Icon icon={Unlink02Icon} />
              Stop syncing
            </Button>
          {:else}
            <Button
              variant="ghost"
              class="justify-start"
              onclick={() => {
                const meta = menuTarget;
                menuTarget = null;
                if (meta) syncConfirm = { kind: "move", meta };
              }}
            >
              <Icon icon={FolderSyncIcon} />
              Sync with a folder…
            </Button>
          {/if}
          <Button
            variant="ghost"
            class="text-destructive justify-start"
            onclick={() => (confirmingDelete = true)}
          >
            {#if menuTarget.kind === "folder"}
              <Icon icon={Cancel01Icon} />
              Remove from list
            {:else}
              <Icon icon={Delete02Icon} />
              Delete workspace
            {/if}
          </Button>
        {/if}
      </div>
    {/if}
  </Drawer.Content>
</Drawer.Root>

<!-- Every way into syncing goes through this: the costs, then the picker. -->
<FolderStorageDialog
  bind:open={() => syncConfirm !== null, (o) => { if (!o) closeSyncConfirm(); }}
  description={syncConfirm?.kind === "move"
    ? `Copy "${syncConfirm.meta.name}" into a folder that a sync app, like Syncthing, shares with your other devices.`
    : "Open a folder that a sync app, like Syncthing, shares with your other devices."}
  busy={syncBusy || addingFolder}
  onConfirm={confirmSync}
/>
