<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Folder01Icon,
    Alert01Icon,
    TextCheckIcon,
    ArrowDown01Icon,
    Settings01Icon,
    GitCommitIcon,
    LeftToRightListBulletIcon,
    Search01Icon,
    Tick02Icon,
  } from "@hugeicons/core-free-icons";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { grammar } from "$lib/stores/grammar.svelte";
  import { ui, type SidebarSection } from "$lib/stores/ui.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { platform } from "$lib/stores/platform.svelte";
  import { normalize, shortenHomePath } from "$lib/paths";
  import { getRecentWorkspaces } from "$lib/ipc/commands";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";
  import FileTree from "$lib/components/sidebar/filetree.svelte";
  import StandaloneDocument from "$lib/components/sidebar/standalone-document.svelte";
  import { chooseDocument } from "$lib/services/document-opening";
  import DiagnosticsPane from "$lib/components/editor/diagnostics-pane.svelte";
  import GrammarPane from "$lib/components/editor/grammar-pane.svelte";
  import OutlinePane from "$lib/components/sidebar/outline-pane.svelte";
  import SearchPane from "$lib/components/sidebar/search-pane.svelte";
  import HistoryPane from "$lib/components/vcs/ledger.svelte";
  import { vcs } from "$lib/stores/vcs.svelte";
  import { openDiffWindow, openSettingsWindow } from "$lib/windows";
  import type { RecentWorkspaceEntry } from "$lib/types";

  const sidebarCtx = Sidebar.useSidebar();

  // The active section lives in the ui store, not here: the command palette
  // ("Show outline", "Go to heading") has to be able to reveal a section from
  // outside the sidebar.
  const activeSection = $derived(
    workspace.isStandalone && (ui.sidebarSection === "history" || ui.sidebarSection === "search")
      ? "files" : ui.sidebarSection
  );

  // `sectionRequest` is bumped by anything outside the sidebar that asks for a
  // section. Reading it here is what makes this effect re-run; opening the
  // sidebar is untracked so it never feeds back into its own dependencies.
  $effect(() => {
    ui.sectionRequest;
    untrack(() => sidebarCtx.setOpen(true));
  });
  let recentWorkspaces = $state<RecentWorkspaceEntry[]>([]);

  const diagCount = $derived(diagnostics.errors.length + diagnostics.warnings.length);
  const hasErrors = $derived(diagnostics.errors.length > 0);
  const grammarCount = $derived(grammar.totalLints);
  const workspaceName = $derived(
    (workspace.documentPath ?? workspace.rootPath)?.split(/[/\\]/).pop() ?? "Workspace"
  );

  onMount(async () => {
    const result = await getRecentWorkspaces({ includeThumbnails: false });
    result.match(
      (entries) => { recentWorkspaces = entries.slice(0, 3); },
      (err) => { logError("Failed to load recent workspaces:", err); }
    );
  });

  function toggleSection(section: SidebarSection) {
    if (sidebarCtx.open && activeSection === section) {
      sidebarCtx.setOpen(false);
    } else {
      ui.sidebarSection = section;
      sidebarCtx.setOpen(true);
    }
  }

  async function handleOpenRecent(path: string) {
    if (isCurrentWorkspace(path)) return;
    const result = await workspace.init(path);
    result.mapErr((err) => {
      logError("Failed to open workspace:", err);
      toast.error(`Failed to open workspace: ${err}`);
    });
  }

  function isCurrentWorkspace(path: string): boolean {
    if (workspace.isStandalone || !workspace.rootPath) return false;
    const current = normalize(workspace.rootPath).replace(/\/+$/, "");
    const recent = normalize(path).replace(/\/+$/, "");
    return platform.os === "windows"
      ? current.toLowerCase() === recent.toLowerCase()
      : current === recent;
  }
</script>

<Sidebar.Root collapsible="icon" role="navigation" aria-label="Workspace">

  <!-- ─── Header: recent projects dropdown ──────────────────────────────────── -->
  <Sidebar.Header class="border-b border-sidebar-border">
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuButton
                size="lg"
                {...props}
                tooltipContent={workspaceName}
                aria-label={workspaceName}
                class="md:px-2 px-0"
              >
                <div class="flex min-w-0 flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
                  <span class="truncate font-semibold">{workspaceName}</span>
                  <span class="truncate text-[10px] opacity-50">
                    {shortenHomePath(workspace.rootPath ?? "", platform.homePath)}
                  </span>
                </div>
                <HugeiconsIcon icon={ArrowDown01Icon} class="ml-auto size-4 shrink-0 opacity-50" />
              </Sidebar.MenuButton>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="w-60">
            <DropdownMenu.Item onclick={() => void chooseDocument()}>Open File…</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Label>Recent projects</DropdownMenu.Label>
            <DropdownMenu.Separator />
            {#if recentWorkspaces.length === 0}
              <DropdownMenu.Item disabled>No recent projects</DropdownMenu.Item>
            {:else}
              {#each recentWorkspaces as recent (recent.path)}
                {@const isCurrent = isCurrentWorkspace(recent.path)}
                <DropdownMenu.Item
                  class="py-2"
                  aria-current={isCurrent ? "true" : undefined}
                  onclick={() => handleOpenRecent(recent.path)}
                >
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="truncate font-medium">{recent.name}</span>
                    <span class="text-muted-foreground truncate text-[10px]">
                      {shortenHomePath(recent.path, platform.homePath)}
                    </span>
                  </div>
                  {#if isCurrent}
                    <HugeiconsIcon icon={Tick02Icon} class="size-4 shrink-0" aria-hidden="true" />
                    <span class="sr-only">Current workspace</span>
                  {/if}
                </DropdownMenu.Item>
              {/each}
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <!-- ─── Content: file tree or diagnostics ─────────────────────────────────── -->
  <Sidebar.Content class="group-data-[collapsible=icon]:hidden">
    {#if activeSection === "files"}
      {#if workspace.isStandalone}
        <StandaloneDocument />
      {:else}
        <FileTree />
      {/if}
    {:else if activeSection === "search"}
      <SearchPane onclose={() => sidebarCtx.setOpen(false)} />
    {:else if activeSection === "outline"}
      <OutlinePane onclose={() => sidebarCtx.setOpen(false)} />
    {:else if activeSection === "diagnostics"}
      <DiagnosticsPane onclose={() => sidebarCtx.setOpen(false)} />
    {:else if activeSection === "grammar"}
      <GrammarPane onclose={() => sidebarCtx.setOpen(false)} />
    {:else if activeSection === "history"}
      <HistoryPane
        onclose={() => sidebarCtx.setOpen(false)}
        onopenDiff={(view) => openDiffWindow(vcs.primaryId, vcs.secondaryId, view)}
      />
    {/if}
  </Sidebar.Content>

  <!-- ─── Footer: section toggles + settings (horizontal) ─────────────────── -->
  <Sidebar.Footer class="border-t border-sidebar-border">
    <div class="flex items-center group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center gap-0.5 p-1">

      <!-- File explorer toggle -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              class="relative size-8 shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground {sidebarCtx.open && activeSection === 'files' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70'}"
              aria-label="Files"
              aria-expanded={sidebarCtx.open && activeSection === 'files'}
              onclick={() => toggleSection("files")}
            >
              <HugeiconsIcon icon={Folder01Icon} class="size-4" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Files</Tooltip.Content>
      </Tooltip.Root>

      <!-- Search toggle -->
      {#if !workspace.isStandalone}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              class="relative size-8 shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground {sidebarCtx.open && activeSection === 'search' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70'}"
              aria-label="Search"
              aria-expanded={sidebarCtx.open && activeSection === 'search'}
              onclick={() => toggleSection("search")}
            >
              <HugeiconsIcon icon={Search01Icon} class="size-4" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Search</Tooltip.Content>
      </Tooltip.Root>
      {/if}

      <!-- Outline toggle -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              class="relative size-8 shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground {sidebarCtx.open && activeSection === 'outline' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70'}"
              aria-label="Outline"
              aria-expanded={sidebarCtx.open && activeSection === 'outline'}
              onclick={() => toggleSection("outline")}
            >
              <HugeiconsIcon icon={LeftToRightListBulletIcon} class="size-4" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Outline</Tooltip.Content>
      </Tooltip.Root>

      <!-- Diagnostics toggle -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              class="relative size-8 shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground {sidebarCtx.open && activeSection === 'diagnostics' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70'}"
              aria-label="Problems"
              aria-expanded={sidebarCtx.open && activeSection === 'diagnostics'}
              onclick={() => toggleSection("diagnostics")}
            >
              <HugeiconsIcon
                icon={Alert01Icon}
                class="size-4 {hasErrors
                  ? 'text-destructive'
                  : diagCount > 0
                    ? 'text-yellow-500'
                    : ''}"
              />
              {#if diagCount > 0}
                <span
                  class="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5
                         items-center justify-center rounded-full bg-destructive
                         text-[9px] font-bold leading-none text-destructive-foreground"
                >
                  {diagCount > 9 ? "9+" : diagCount}
                </span>
              {/if}
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Diagnostics</Tooltip.Content>
      </Tooltip.Root>

      <!-- Grammar toggle -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              class="relative size-8 shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground {sidebarCtx.open && activeSection === 'grammar' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70'}"
              aria-label="Grammar"
              aria-expanded={sidebarCtx.open && activeSection === 'grammar'}
              onclick={() => toggleSection("grammar")}
            >
              <HugeiconsIcon icon={TextCheckIcon} class="size-4" />
              {#if grammarCount > 0}
                <span
                  class="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5
                         items-center justify-center rounded-full bg-muted-foreground
                         text-[9px] font-bold leading-none text-background"
                >
                  {grammarCount > 9 ? "9+" : grammarCount}
                </span>
              {/if}
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Grammar</Tooltip.Content>
      </Tooltip.Root>

      <!-- History toggle -->
      {#if !workspace.isStandalone}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              class="relative size-8 shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground {sidebarCtx.open && activeSection === 'history' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70'}"
              aria-label="History"
              aria-expanded={sidebarCtx.open && activeSection === 'history'}
              onclick={() => toggleSection("history")}
            >
              <HugeiconsIcon icon={GitCommitIcon} class="size-4" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">History</Tooltip.Content>
      </Tooltip.Root>
      {/if}

      <!-- Settings -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              class="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="Settings"
              onclick={() => openSettingsWindow()}
            >
              <HugeiconsIcon icon={Settings01Icon} class="size-4" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Settings</Tooltip.Content>
      </Tooltip.Root>

    </div>
  </Sidebar.Footer>

  <Sidebar.Rail />
</Sidebar.Root>
