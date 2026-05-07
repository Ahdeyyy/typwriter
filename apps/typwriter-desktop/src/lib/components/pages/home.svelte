<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "@/stores/page.svelte";
  import Button from "../ui/button/button.svelte";
  import { getRecentWorkspaces, createWorkspace, isFontsLoaded, removeRecentWorkspace, clearRecentWorkspaces, getLogFilePath } from "$lib/ipc/commands";
  import { onAppFontsLoaded, type UnlistenFn } from "$lib/ipc/events";
  import type { RecentWorkspaceEntry } from "$lib/types";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Folder01Icon, FolderOpenIcon, FolderAddIcon, Delete01Icon, Cancel01Icon, BookOpen01Icon, Refresh01Icon, File01Icon, KeyboardIcon } from "@hugeicons/core-free-icons";
  import { openUrl, openPath } from "@tauri-apps/plugin-opener";
  import { updater } from "$lib/stores/updater.svelte";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import ModeSwitcher from "$lib/components/sidebar/mode-switcher.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";

  let recentWorkspaces = $state<RecentWorkspaceEntry[]>([]);
  let loading = $state(true);
  let fontsReady = $state(false);
  let fontToastId = $state<string | number | undefined>();

  // New workspace dialog state
  let newWorkspaceOpen = $state(false);
  let newWorkspaceName = $state("");
  let newWorkspaceParent = $state("");
  let newWorkspaceCreating = $state(false);

  // ── Font readiness ──────────────────────────────────────────────────────────

  let unlistenFonts: UnlistenFn | null = null;

  onMount(async () => {
    loadRecent();

    // Check if fonts already loaded (handles race condition)
    const ready = await isFontsLoaded();
    if (ready.isOk() && ready.value) {
      fontsReady = true;
    } else {
      fontToastId = toast.loading("Loading fonts…");
      const result = await onAppFontsLoaded(() => {
        fontsReady = true;
        if (fontToastId !== undefined) {
          toast.dismiss(fontToastId);
          fontToastId = undefined;
        }
      });
      if (result.isOk()) unlistenFonts = result.value;
    }
  });

  onDestroy(() => {
    unlistenFonts?.();
    if (fontToastId !== undefined) toast.dismiss(fontToastId);
  });

  // ── Workspace operations ────────────────────────────────────────────────────

  async function loadRecent() {
    loading = true;
    const result = await getRecentWorkspaces();
    result.match(
      (entries) => {
        recentWorkspaces = entries;
      },
      (err) => {
        logError("Failed to load recent workspaces:", err);
        toast.error(`Failed to load recent workspaces: ${err}`);
      },
    );
    loading = false;
  }

  async function handleOpenRecent(path: string) {
    const result = await workspace.init(path);
    result.match(
      () => { page.navigate("workspace"); },
      (err) => {
        logError("Failed to open workspace:", err);
        toast.error(`Failed to open workspace: ${err}`);
      },
    );
  }

  async function handleRemoveRecent(e: MouseEvent, path: string) {
    e.stopPropagation();
    const result = await removeRecentWorkspace(path);
    result.match(
      () => { loadRecent(); },
      (err) => {
        logError("Failed to remove workspace from recents:", err);
        toast.error(`Failed to remove workspace: ${err}`);
      },
    );
  }

  async function handleClearRecent() {
    const result = await clearRecentWorkspaces();
    result.match(
      () => { loadRecent(); },
      (err) => {
        logError("Failed to clear recent workspaces:", err);
        toast.error(`Failed to clear recent workspaces: ${err}`);
      },
    );
  }

  async function handleOpenNew() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected) return;

    const result = await workspace.init(selected);
    result.match(
      () => { page.navigate("workspace"); },
      (err) => {
        logError("Failed to open workspace:", err);
        toast.error(`Failed to open workspace: ${err}`);
      },
    );
  }

  async function handleSelectParentFolder() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) {
      newWorkspaceParent = selected;
    }
  }

  async function handleCreateWorkspace() {
    if (!newWorkspaceName.trim()) {
      toast.error("Please enter a workspace name.");
      return;
    }
    if (!newWorkspaceParent) {
      toast.error("Please select a location.");
      return;
    }

    newWorkspaceCreating = true;
    const createResult = await createWorkspace(newWorkspaceParent, newWorkspaceName.trim());

    if (createResult.isErr()) {
      logError("Failed to create workspace:", createResult.error);
      toast.error(`Failed to create workspace: ${createResult.error}`);
      newWorkspaceCreating = false;
      return;
    }

    const newPath = createResult.value;
    const initResult = await workspace.init(newPath);
    newWorkspaceCreating = false;

    initResult.match(
      () => {
        newWorkspaceOpen = false;
        newWorkspaceName = "";
        newWorkspaceParent = "";
        page.navigate("workspace");
      },
      (err) => {
        logError("Failed to open new workspace:", err);
        toast.error(`Failed to open workspace: ${err}`);
      },
    );
  }

  async function handleOpenLogsFile() {
    const result = await getLogFilePath();
    if (result.isErr()) {
      logError("Failed to resolve log file path:", result.error);
      toast.error(`Failed to resolve log file path: ${result.error}`);
      return;
    }
    try {
      await openPath(result.value);
    } catch (err) {
      logError("Failed to open log file:", err);
      toast.error(`Failed to open log file: ${err}`);
    }
  }

  function handleNewWorkspaceKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handleCreateWorkspace();
    }
  }

</script>

<Tooltip.Provider>
<div class="flex h-full w-full flex-col">
  <Titlebar variant="minimal" title="Typwriter" />
  <main class="relative flex flex-1 flex-col items-center justify-center gap-5 p-4">
    <div class="absolute right-3 top-3">
      <ModeSwitcher />
    </div>
  <!-- Recent workspaces -->
  <section class="w-full max-w-3xl">
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-sm font-medium text-muted-foreground">
        Recent Workspaces
      </h2>
      <div class="flex items-center gap-2">
        {#if recentWorkspaces.length > 0}
          <Button
            variant="ghost"
            size="sm"
            onclick={handleClearRecent}
            class="gap-2 text-destructive hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete01Icon} class="size-4" />
            Clear All
          </Button>
        {/if}
      </div>
    </div>

    <!-- Heuristic min-height keeps items below in a stable position regardless
         of how many recents are listed. Calc: 3 rows × ~10.5rem card + 2 × 0.5rem gap. -->
    <div class="min-h-[32.5rem]">
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <span class="text-sm text-muted-foreground">Loading…</span>
      </div>
    {:else if recentWorkspaces.length === 0}
      <div
        class="flex items-center justify-center rounded-md border border-dashed border-border py-12"
      >
        <p class="text-sm text-muted-foreground">
          No recent workspaces. Open a folder to get started.
        </p>
      </div>
    {:else}
      <ul class="grid grid-cols-2 gap-2">
        {#each recentWorkspaces.slice(0, 6) as entry (entry.path)}
          <li class="group relative">
            <Button
              variant="outline"
              class="group/card h-auto w-full flex-col gap-0 overflow-hidden rounded-md border border-border bg-card p-0 text-left font-normal hover:bg-accent hover:text-accent-foreground"
              onclick={() => handleOpenRecent(entry.path)}
              disabled={!fontsReady}
            >
              <!-- Thumbnail -->
              <div class="flex h-28 w-full items-center justify-center overflow-hidden bg-muted group-hover/card:bg-accent">
                {#if entry.thumbnail}
                  <img
                    src="data:image/png;base64,{entry.thumbnail}"
                    alt="{entry.name} preview"
                    class="h-full w-full object-cover object-top"
                  />
                {:else}
                  <HugeiconsIcon icon={Folder01Icon} class="h-8 w-8 text-muted-foreground" />
                {/if}
              </div>

              <!-- Details -->
              <div class="min-w-0 w-full px-3 py-2 bg-card group-hover/card:bg-accent">
                <p class="truncate text-sm font-medium text-foreground group-hover/card:text-accent-foreground">
                  {entry.name}
                </p>
                <p class="truncate text-xs text-muted-foreground group-hover/card:text-accent-foreground/70">
                  {entry.path}
                </p>
              </div>
            </Button>

            <!-- Per-entry delete button -->
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    class="absolute right-1.5 top-1.5 rounded-lg bg-background text-muted-foreground opacity-0 hover:bg-destructive hover:text-destructive-foreground focus:opacity-100 group-hover:opacity-100"
                    onclick={(e) => handleRemoveRecent(e, entry.path)}
                    aria-label="Remove {entry.name} from recents"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Remove from recents</Tooltip.Content>
            </Tooltip.Root>
          </li>
        {/each}
      </ul>
    {/if}
    </div>
  </section>

  <div class="flex gap-2">
    <!-- New Workspace dialog -->
    <Dialog.Root bind:open={newWorkspaceOpen}>
      <Dialog.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline" class="gap-2" disabled={!fontsReady}>
            <HugeiconsIcon icon={FolderAddIcon} class="size-4" />
            New Workspace
          </Button>
        {/snippet}
      </Dialog.Trigger>
      <Dialog.Content class="sm:max-w-md">
        <Dialog.Header>
          <Dialog.Title>New Workspace</Dialog.Title>
          <Dialog.Description>
            Choose a location and name for your new workspace. A folder with a
            <code>.typwriter</code> metadata directory will be created inside.
          </Dialog.Description>
        </Dialog.Header>

        <div class="flex flex-col gap-4 py-2">
          <!-- Name input -->
          <div class="flex flex-col gap-1.5">
            <label for="ws-name" class="text-sm font-medium">Name</label>
            <Input
              id="ws-name"
              placeholder="my-document"
              bind:value={newWorkspaceName}
              onkeydown={handleNewWorkspaceKeydown}
              disabled={newWorkspaceCreating}
            />
          </div>

          <!-- Location picker -->
          <div class="flex flex-col gap-1.5">
            <label for="ws-location" class="text-sm font-medium">Location</label>
            <div class="flex gap-2">
              <Input
                readonly
                id="ws-location"
                value={newWorkspaceParent}
                placeholder="Select a folder…"
                class="flex-1 cursor-default text-muted-foreground"
                disabled={newWorkspaceCreating}
              />
              <Button
                variant="outline"
                size="sm"
                onclick={handleSelectParentFolder}
                disabled={newWorkspaceCreating}
              >
                Browse
              </Button>
            </div>
            {#if newWorkspaceParent && newWorkspaceName.trim()}
              <p class="text-xs text-muted-foreground">
                Will create: {newWorkspaceParent}/{newWorkspaceName.trim()}
              </p>
            {/if}
          </div>
        </div>

        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button {...props} variant="ghost" disabled={newWorkspaceCreating}>Cancel</Button>
            {/snippet}
          </Dialog.Close>
          <Button
            onclick={handleCreateWorkspace}
            disabled={newWorkspaceCreating || !newWorkspaceName.trim() || !newWorkspaceParent}
          >
            {newWorkspaceCreating ? "Creating…" : "Create"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>

    <Button onclick={handleOpenNew} class="gap-2" disabled={!fontsReady}>
      <HugeiconsIcon icon={FolderOpenIcon} class="size-4" />
      Open Folder
    </Button>
  </div>

  <div class="flex items-center gap-1">
    <Button
      variant="link"
      size="sm"
      class="gap-1.5 text-muted-foreground cursor-pointer"
      onclick={() => openUrl("https://typst.app/docs/")}
    >
      <HugeiconsIcon icon={BookOpen01Icon} class="size-3.5" />
      Typst Docs
    </Button>

    <Button
      variant="link"
      size="sm"
      class="gap-1.5 text-muted-foreground"
      onclick={() => updater.checkManual()}
      disabled={updater.checking || updater.downloading}
    >
      <HugeiconsIcon icon={Refresh01Icon} class="size-3.5 {updater.checking ? 'animate-spin' : ''}" />
      Check for Updates
    </Button>

    <Button
      variant="link"
      size="sm"
      class="gap-1.5 text-muted-foreground"
      onclick={handleOpenLogsFile}
    >
      <HugeiconsIcon icon={File01Icon} class="size-3.5" />
      Open Logs File
    </Button>

    <Button
      variant="link"
      size="sm"
      class="gap-1.5 text-muted-foreground"
      onclick={() => page.navigate("keymaps")}
    >
      <HugeiconsIcon icon={KeyboardIcon} class="size-3.5" />
      Keymaps
    </Button>
  </div>
  </main>
</div>
</Tooltip.Provider>
