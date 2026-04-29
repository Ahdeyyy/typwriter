<script lang="ts">
  import { onMount } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Folder01Icon,
    Alert01Icon,
    Home01Icon,
    ArrowDown01Icon,
  } from "@hugeicons/core-free-icons";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { page } from "$lib/stores/page.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { getRecentWorkspaces } from "$lib/ipc/commands";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";
  import FileTree from "$lib/components/sidebar/filetree.svelte";
  import DiagnosticsPane from "$lib/components/editor/diagnostics-pane.svelte";
  import ModeSwitcher from "./mode-switcher.svelte";
  import type { RecentWorkspaceEntry } from "$lib/types";
  import { defaultWindowIcon } from '@tauri-apps/api/app';

function createImageUrlFromRgba(rgbaArray: Uint8Array, width: number, height: number): string {
    // 1. Wrap the array in a Uint8ClampedArray (required by the ImageData API)
    const clampedArray = new Uint8ClampedArray(rgbaArray);

    // 2. Create an ImageData object
    const imageData = new ImageData(clampedArray, width, height);

    // 3. Create an off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    // 4. Put the image data onto the canvas context
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error("Failed to get 2d context from canvas");
      return "";
    }
    ctx.putImageData(imageData, 0, 0);

    // 5. Export the canvas as a base64 encoded PNG URL
    return canvas.toDataURL('image/png');
}

  type Section = "files" | "diagnostics";

  let iconImage: HTMLImageElement | undefined = $state(undefined);

  const sidebarCtx = Sidebar.useSidebar();
  let activeSection = $state<Section>("files");
  let recentWorkspaces = $state<RecentWorkspaceEntry[]>([]);
  let returningHome = $state(false);

  const diagCount = $derived(diagnostics.errors.length + diagnostics.warnings.length);
  const hasErrors = $derived(diagnostics.errors.length > 0);
  const workspaceName = $derived(
    workspace.rootPath?.split(/[/\\]/).pop() ?? "Workspace"
  );

  onMount(async () => {
    const icon = await defaultWindowIcon();
    if (icon) {
      const size = await icon.size()
      const htmlImage = new Image(size.width, size.height)
      const bytes = await icon.rgba()
      htmlImage.src = createImageUrlFromRgba(bytes, size.width, size.height)
      iconImage = htmlImage;
      await icon.close()
    }
    const result = await getRecentWorkspaces();
    result.match(
      (entries) => { recentWorkspaces = entries.slice(0, 3); },
      (err) => { logError("Failed to load recent workspaces:", err); }
    );
  });

  function toggleSection(section: Section) {
    if (sidebarCtx.open && activeSection === section) {
      sidebarCtx.setOpen(false);
    } else {
      activeSection = section;
      sidebarCtx.setOpen(true);
    }
  }

  async function handleOpenRecent(path: string) {
    if (workspace.rootPath === path) return;
    const result = await workspace.init(path);
    result.mapErr((err) => {
      logError("Failed to open workspace:", err);
      toast.error(`Failed to open workspace: ${err}`);
    });
  }

  async function handleReturnHome() {
    if (returningHome) return;
    returningHome = true;
    const result = await workspace.leave();
    result.match(
      () => page.navigate("home"),
      (err) => {
        logError("Failed to return home:", err);
        toast.error(`Failed to return home: ${err}`);
      }
    );
    returningHome = false;
  }
</script>

<Sidebar.Root collapsible="icon">

  <!-- ─── Header: recent projects dropdown ──────────────────────────────────── -->
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuButton size="lg" {...props} tooltipContent={workspaceName}>
                <div
                  class="bg-sidebar-accent text-sidebar-accent-foreground shadow-lg flex size-8 shrink-0
                         items-center justify-center rounded-lg mx-auto"
                >
                    {#if iconImage}
                        <img src={iconImage.src} alt="typwriter logo" class="mx-auto size-8" />
                    {:else}
                      <HugeiconsIcon icon={Folder01Icon} class="size-4" />
                    {/if}
                </div>
                <div class="flex min-w-0 flex-col gap-0.5 leading-none">
                  <span class="truncate font-semibold">{workspaceName}</span>
                  <span class="truncate text-[10px] opacity-50">{workspace.rootPath ?? ""}</span>
                </div>
                <HugeiconsIcon icon={ArrowDown01Icon} class="ml-auto size-4 shrink-0 opacity-50" />
              </Sidebar.MenuButton>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="w-60">
            <DropdownMenu.Label>Recent projects</DropdownMenu.Label>
            <DropdownMenu.Separator />
            {#if recentWorkspaces.length === 0}
              <DropdownMenu.Item disabled>No recent projects</DropdownMenu.Item>
            {:else}
              {#each recentWorkspaces as recent (recent.path)}
                <DropdownMenu.Item
                  class="flex flex-col items-start gap-0.5 py-2"
                  onclick={() => handleOpenRecent(recent.path)}
                >
                  <span class="font-medium">{recent.name}</span>
                  <span class="text-muted-foreground max-w-full truncate text-[10px]">
                    {recent.path}
                  </span>
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
      <FileTree />
    {:else}
      <DiagnosticsPane onclose={() => sidebarCtx.setOpen(false)} />
    {/if}
  </Sidebar.Content>

  <!-- ─── Footer: section toggles + home + theme (horizontal) ─────────────── -->
  <Sidebar.Footer class="border-t border-sidebar-border">
    <div class="flex items-center group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center gap-0.5 p-1">

      <!-- File explorer toggle -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="relative flex size-8 shrink-0 items-center justify-center rounded-md
                     transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
                     {sidebarCtx.open && activeSection === 'files'
                       ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                       : 'text-sidebar-foreground/70'}"
              onclick={() => toggleSection("files")}
            >
              <HugeiconsIcon icon={Folder01Icon} class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Files</Tooltip.Content>
      </Tooltip.Root>

      <!-- Diagnostics toggle -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="relative flex size-8 shrink-0 items-center justify-center rounded-md
                     transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
                     {sidebarCtx.open && activeSection === 'diagnostics'
                       ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                       : 'text-sidebar-foreground/70'}"
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
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Diagnostics</Tooltip.Content>
      </Tooltip.Root>

      <!-- Home -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="flex size-8 shrink-0 items-center justify-center rounded-md
                     text-sidebar-foreground/70 transition-colors
                     hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onclick={handleReturnHome}
            >
              <HugeiconsIcon icon={Home01Icon} class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Home</Tooltip.Content>
      </Tooltip.Root>

      <!-- Theme switcher -->
      <div class="ml-auto group-data-[collapsible=icon]:ml-0">
        <ModeSwitcher />
      </div>

    </div>
  </Sidebar.Footer>

  <Sidebar.Rail />
</Sidebar.Root>
