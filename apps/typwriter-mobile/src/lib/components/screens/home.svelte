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
  import { settings } from "#lib/stores/settings.svelte.ts";
  import FolderStorageDialog from "#lib/components/folder-storage-dialog.svelte";

  // Folder workspaces are opt-in; everything that creates or adds one hides
  // until the user has read the trade-offs and turned them on.
  let folderExplainerOpen = $state(false);

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
  let migrateOpen = $state(false);
  dismissOnBack(() => migrateOpen, () => (migrateOpen = false));
  let migrating = $state(false);

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
    // workspace stops syncing here (and says so), rather than polling a
    // folder nobody is looking at.
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
      // The first folder workspace asks where workspaces live; later ones reuse it.
      if (settings.folderWorkspaces && !workspace.location) {
        const picked = await workspace.pickLocation();
        if (picked.isErr()) {
          toast.error(`Couldn't use that folder: ${picked.error}`);
          return;
        }
        if (!picked.value) return;
      }
      const created = await workspace.create(name);
      if (created.isErr()) {
        toast.error(`Failed to create: ${created.error}`);
        return;
      }
      createOpen = false;
      newName = "";
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
      else if (added.value)
        workspace.open(added.value).mapErr((e) => toast.error(`Failed to open: ${e}`));
    } finally {
      addingFolder = false;
    }
  }

  async function doMigrate() {
    if (migrating) return;
    migrating = true;
    try {
      const result = await workspace.migrate();
      if (result.isErr()) {
        toast.error(`Couldn't move workspaces: ${result.error}`);
        return;
      }
      const report = result.value;
      if (!report) return;
      migrateOpen = false;
      scheduleBodyLockRelease();
      const moved = report.moved.length;
      if (moved) toast.success(`Moved ${moved} workspace${moved === 1 ? "" : "s"} to ${workspace.location ?? "the folder"}`);
      for (const failed of report.failed) {
        toast.error(`"${failed.name}" stayed in app storage`, { description: failed.error });
      }
    } finally {
      migrating = false;
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
    {#if settings.folderWorkspaces}
      <Button
        variant="secondary"
        class="hidden rounded-full px-5 tablet:inline-flex"
        disabled={addingFolder}
        onclick={addFolder}
      >
        <Icon icon={FolderOpenIcon} /> Open folder
      </Button>
    {/if}
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
            {#if settings.folderWorkspaces}
              <Button variant="ghost" class="rounded-full px-6" disabled={addingFolder} onclick={addFolder}>
                <Icon icon={FolderOpenIcon} /> Open folder
              </Button>
            {/if}
            <Button variant="ghost" class="rounded-full px-6 tablet:hidden" disabled={pickingDocument} onclick={openDocument}>
              <Icon icon={File02Icon} /> {pickingDocument ? "Opening…" : "Open file"}
            </Button>
          </div>
        </div>
      {:else}
        <!-- Workspaces still inside the app can't reach a sync app: offer to
             move them out to a folder of the user's choosing. -->
        {#if settings.folderWorkspaces && workspace.appStorageCount > 0}
          <div class="bg-card mb-6 flex items-start gap-3.5 rounded-2xl border p-4">
            <div class="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
              <Icon icon={FolderSyncIcon} class="size-6" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[15px] font-medium">
                {workspace.appStorageCount === 1 ? "1 workspace is" : `${workspace.appStorageCount} workspaces are`} stored inside the app
              </div>
              <p class="text-muted-foreground mt-0.5 text-sm">Move them to a folder you choose to back them up or sync them with your other devices.</p>
              <Button size="sm" class="mt-3 rounded-full px-4" onclick={() => (migrateOpen = true)}>Move to a folder…</Button>
            </div>
          </div>
        {/if}

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
            {#each rest as meta (meta.id)}
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
        {#if settings.folderWorkspaces}
          <DropdownMenu.Item class={menuItemClass} disabled={addingFolder} onclick={addFolder}>
            <Icon icon={FolderOpenIcon} /> Open folder
          </DropdownMenu.Item>
        {/if}
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
      <Dialog.Description>
        {settings.folderWorkspaces
          ? "A new folder with this name is created in the location below."
          : "Choose a name for your new Typst workspace."}
      </Dialog.Description>
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
      {#if settings.folderWorkspaces}
        <div class="bg-muted/50 mt-3 flex items-center gap-3 rounded-xl px-3 py-2">
          <Icon icon={Location01Icon} class="text-muted-foreground size-5 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="text-muted-foreground text-xs">Location</div>
            <div class="truncate text-sm">{workspace.location ?? "Not chosen yet"}</div>
          </div>
          <Button type="button" variant="ghost" size="sm" onclick={changeLocation}>
            {workspace.location ? "Change" : "Choose"}
          </Button>
        </div>
      {:else}
        <p class="text-muted-foreground mt-3 text-xs">
          Stored inside the app.
          <button type="button" class="text-primary underline-offset-2 hover:underline" onclick={() => (folderExplainerOpen = true)}>
            Keep workspaces in your own folders instead…
          </button>
        </p>
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
      scheduleBodyLockRelease();
    }
  }}
>
  <Drawer.Content>
    {#if confirmingDelete && menuTarget}
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

<!-- Move app-storage workspaces out to a folder -->
<Dialog.Root
  bind:open={migrateOpen}
  onOpenChange={(o) => {
    if (!o) scheduleBodyLockRelease();
  }}
>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Move workspaces to a folder</Dialog.Title>
      <Dialog.Description>
        Choose a folder, for example one your sync app keeps in step with your other devices. Each
        workspace is copied into it as its own folder, checked, and then removed from the app's
        storage. Downloaded packages stay in the app.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="mt-2 flex-col gap-2">
      <Button class="w-full" disabled={migrating} onclick={() => void doMigrate()}>
        {migrating ? "Moving…" : "Choose folder…"}
      </Button>
      <Button variant="ghost" class="w-full" disabled={migrating} onclick={() => (migrateOpen = false)}>
        Not now
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<FolderStorageDialog
  bind:open={folderExplainerOpen}
  onEnabled={() => {
    toast.success("Folder workspaces turned on", {
      description: "New workspaces are created in a folder you choose.",
    });
  }}
/>
