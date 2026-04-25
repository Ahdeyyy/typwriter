<script lang="ts">
  import { SidebarSimple, Folder, Warning, House } from "phosphor-svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { page } from "$lib/stores/page.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";
  import FileTree from "$lib/components/sidebar/filetree.svelte";
  import DiagnosticsPane from "$lib/components/editor/diagnostics-pane.svelte";
    import ModeSwitcher from "./mode-switcher.svelte";

  type Section = "files" | "diagnostics";

  let panelOpen = $state(true);
  let activeSection = $state<Section>("files");
  let returningHome = $state(false);

  const diagCount = $derived(diagnostics.errors.length + diagnostics.warnings.length);
  const hasErrors = $derived(diagnostics.errors.length > 0);
  const workspaceName = $derived(
    workspace.rootPath?.split(/[/\\]/).pop() ?? "Explorer"
  );

  function selectSection(section: Section) {
    if (panelOpen && activeSection === section) {
      panelOpen = false;
    } else {
      activeSection = section;
      panelOpen = true;
    }
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
      },
    );
    returningHome = false;
  }
</script>

<div class="flex h-full shrink-0">

  <!-- ─── Icon rail (always visible) ─────────────────────────────────────── -->
  <div class="flex h-full w-10 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
    <div class="flex flex-col gap-0.5 p-1">

      <!-- Sidebar toggle -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="relative flex h-8 w-8 items-center justify-center rounded-md
                     text-sidebar-foreground/70 transition-colors
                     hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
                     {panelOpen ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}"
              onclick={() => (panelOpen = !panelOpen)}
              title="Toggle sidebar"
            >
              <SidebarSimple class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="right">Toggle sidebar</Tooltip.Content>
      </Tooltip.Root>

      <!-- Files -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="relative flex h-8 w-8 items-center justify-center rounded-md
                     text-sidebar-foreground/70 transition-colors
                     hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
                     {panelOpen && activeSection === 'files'
                       ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                       : ''}"
              onclick={() => selectSection("files")}
              title="Files"
            >
              <Folder class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="right">Files</Tooltip.Content>
      </Tooltip.Root>

      <!-- Diagnostics -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="relative flex h-8 w-8 items-center justify-center rounded-md
                     transition-colors
                     hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
                     {panelOpen && activeSection === 'diagnostics'
                       ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                       : 'text-sidebar-foreground/70'}"
              onclick={() => selectSection("diagnostics")}
              title="Diagnostics"
            >
              <Warning
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
        <Tooltip.Content side="right">Diagnostics</Tooltip.Content>
      </Tooltip.Root>

    </div>

    <!-- Home (bottom), Theme Switcher -->

    <div class="mt-auto p-1">

       <ModeSwitcher />
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="flex h-8 w-8 items-center justify-center rounded-md
                     text-sidebar-foreground/70 transition-colors
                     hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
                     disabled:opacity-50 disabled:pointer-events-none"
              onclick={handleReturnHome}
              disabled={returningHome}
              title="Home"
            >
              <House class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="right">Home</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </div>

  <!-- ─── Content panel (conditional) ──────────────────────────────────────── -->
  {#if panelOpen}
    <div class="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">

      <!-- Header -->
      <div class="flex h-9 shrink-0 items-center border-b border-sidebar-border px-2">
        <span class="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {activeSection === "files" ? workspaceName : "Diagnostics"}
        </span>
      </div>

      <!-- Section content -->
      {#if activeSection === "files"}
        <FileTree />
      {:else}
        <DiagnosticsPane onclose={() => (panelOpen = false)} />
      {/if}

    </div>
  {/if}

</div>
