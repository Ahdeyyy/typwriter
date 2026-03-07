<script lang="ts">
  import { page } from "@/stores/page.svelte";
  import Button from "../ui/button/button.svelte";
  import { getRecentWorkspaces } from "$lib/ipc/commands";
  import type { RecentWorkspaceEntry } from "$lib/types";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { Folder, FolderOpen } from "@lucide/svelte";
  import { toast } from "svelte-sonner";

  // const window = Window.getCurrent();
  // window.setTitle("Typwriter");

  let recentWorkspaces = $state<RecentWorkspaceEntry[]>([]);
  let loading = $state(true);

  async function loadRecent() {
    loading = true;
    const result = await getRecentWorkspaces();
    result.match(
      (entries) => {
        recentWorkspaces = entries;
      },
      (err) => {
        console.error("Failed to load recent workspaces:", err);
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
        console.error("Failed to open workspace:", err);
        toast.error(`Failed to open workspace: ${err}`);
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
        console.error("Failed to open workspace:", err);
        toast.error(`Failed to open workspace: ${err}`);
      },
    );
  }

  // Load recent workspaces on mount.
  $effect(() => {
    loadRecent();
  });
</script>

<main class="flex h-full flex-col items-center justify-center gap-8 p-8">
  <!-- Recent workspaces -->
  <section class="w-full max-w-2xl">
    <h2 class="mb-4 text-sm font-medium text-muted-foreground">
      Recent Workspaces
    </h2>

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
    <!-- <ScrollArea class="h-[200px] w-[350px] rounded-md border p-4"> -->
      <ul class="grid grid-cols-1 gap-2">
        {#each recentWorkspaces as entry (entry.path)}
          <li>
            <Button
              variant="ghost"
              class="flex h-auto w-full items-center gap-4 rounded-md border border-border bg-card py-1.5 px-3 text-left hover:bg-accent"
              onclick={() => handleOpenRecent(entry.path)}
            >
              <!-- Thumbnail -->
              <div
                class="flex w-48 shrink-0 self-stretch items-center justify-center overflow-hidden rounded-l-md bg-muted"
              >
                {#if entry.thumbnail}
                  <img
                    src="data:image/png;base64,{entry.thumbnail}"
                    alt="{entry.name} preview"
                    class="h-20 w-full object-none object-top-left"
                  />
                {:else}
                  <Folder class="h-5 w-5 text-muted-foreground" />
                {/if}
              </div>

              <!-- Details -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">
                  {entry.name}
                </p>
                <p class="truncate text-xs text-muted-foreground">
                  {entry.path}
                </p>
              </div>
            </Button>
          </li>
        {/each}
      </ul>
      <!-- </ScrollArea> -->
    {/if}
  </section>

  <Button onclick={handleOpenNew} class="gap-2">
    <FolderOpen />
    Open Folder
  </Button>
</main>
