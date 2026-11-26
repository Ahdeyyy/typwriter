<script lang="ts">
  // The one sheet that explains where a folder workspace's sync stands, with
  // "Sync now". Mounted once in the editor; everything that offers details
  // (the indicator icon, the red header button, the "Details" action on the
  // can't-reach toast) opens it through `workspace.syncDetailsOpen`, so the
  // details can always be brought back after the toast is gone.
  import { RefreshIcon } from "@hugeicons/core-free-icons";
  import Icon from "#lib/components/icon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Drawer from "#lib/components/ui/drawer/index.ts";
  import { dismissOnBack } from "#lib/back-dismiss.svelte.ts";
  import { scheduleBodyLockRelease } from "#lib/body-lock.ts";
  import { workspace } from "#lib/stores/workspace.svelte.ts";
  import { timeAgo } from "#lib/time.ts";
  import { syncView } from "./sync-view.ts";

  dismissOnBack(() => workspace.syncDetailsOpen, () => (workspace.syncDetailsOpen = false));
  let syncing = $state(false);

  const status = $derived(workspace.sync);
  const view = $derived(status ? syncView(status) : null);

  async function syncNow() {
    if (syncing) return;
    syncing = true;
    try {
      await workspace.syncNow();
    } finally {
      syncing = false;
    }
  }
</script>

<Drawer.Root
  open={workspace.syncDetailsOpen && !!status}
  onOpenChange={(o) => {
    if (!o) {
      workspace.syncDetailsOpen = false;
      scheduleBodyLockRelease();
    }
  }}
>
  <Drawer.Content>
    {#if status && view}
      <Drawer.Header>
        <Drawer.Title class="flex items-center justify-center gap-2 {view.tone}">
          <Icon icon={view.icon} class="size-5" />
          {view.label}
        </Drawer.Title>
        <Drawer.Description>{status.location}</Drawer.Description>
      </Drawer.Header>
      <div class="flex flex-col gap-3 px-4" style="padding-bottom: calc(var(--safe-bottom) + 1rem);">
        <p class="text-muted-foreground text-sm">{view.explanation}</p>
        {#if status.state === "offline" && status.message}
          <p class="text-muted-foreground text-xs">Details: {status.message}</p>
        {/if}
        {#if status.lastSyncedMs}
          <p class="text-muted-foreground text-xs">Last synced {timeAgo(status.lastSyncedMs)}</p>
        {/if}
        <Button variant="secondary" class="w-full" disabled={syncing} onclick={() => void syncNow()}>
          <Icon icon={RefreshIcon} class={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : status.state === "offline" ? "Try again" : "Sync now"}
        </Button>
      </div>
    {/if}
  </Drawer.Content>
</Drawer.Root>
