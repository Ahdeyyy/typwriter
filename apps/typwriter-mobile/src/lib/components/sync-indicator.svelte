<script lang="ts">
  // Where a folder workspace's sync stands, always on screen while it runs:
  // syncing (with progress), synced, paused, or unable to reach the folder.
  // Tapping it explains the state and offers "Sync now".
  import {
    Alert02Icon,
    CheckmarkCircle02Icon,
    Loading03Icon,
    PauseIcon,
    RefreshIcon,
  } from "@hugeicons/core-free-icons";
  import Icon from "#lib/components/icon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Drawer from "#lib/components/ui/drawer/index.ts";
  import { dismissOnBack } from "#lib/back-dismiss.svelte.ts";
  import { scheduleBodyLockRelease } from "#lib/body-lock.ts";
  import { workspace } from "#lib/stores/workspace.svelte.ts";
  import { timeAgo } from "#lib/time.ts";

  let { floating = false }: { floating?: boolean } = $props();

  let detailsOpen = $state(false);
  dismissOnBack(() => detailsOpen, () => (detailsOpen = false));
  let syncing = $state(false);

  const status = $derived(workspace.sync);

  const view = $derived.by(() => {
    switch (status?.state) {
      case "syncing":
        return {
          icon: Loading03Icon,
          label: status.total ? `Syncing ${status.done ?? 0}/${status.total}` : "Syncing",
          tone: "text-primary",
          spin: true,
        };
      case "synced":
        return { icon: CheckmarkCircle02Icon, label: "Synced", tone: "text-muted-foreground", spin: false };
      case "paused":
        return { icon: PauseIcon, label: "Paused", tone: "text-muted-foreground", spin: false };
      case "offline":
        return { icon: Alert02Icon, label: "Not syncing", tone: "text-destructive", spin: false };
      default:
        return null;
    }
  });

  const explanation = $derived.by(() => {
    switch (status?.state) {
      case "syncing":
        return "Bringing in changes from the folder.";
      case "synced":
        return "This workspace matches the folder. Your changes are written to it as you save; changes from elsewhere are checked every few seconds (the open file every second).";
      case "paused":
        return "Checks pause while Typwriter is in the background and catch up as soon as you return.";
      case "offline":
        return `The folder can't be reached, so saving to it fails until it is back. It may have been moved or deleted, be on a removed SD card, or its access may have been revoked.${status.message ? ` (${status.message})` : ""}`;
      default:
        return "";
    }
  });

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

{#if status && view}
  <button
    class={floating
      ? `float-pill flex h-11 items-center gap-1.5 px-3.5 text-sm font-medium ${view.tone}`
      : `hover:bg-muted flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${view.tone}`}
    aria-label="Sync status: {view.label}"
    onclick={() => (detailsOpen = true)}
  >
    <Icon icon={view.icon} class="size-[18px] {view.spin ? 'animate-spin' : ''}" />
    <span class="tabular-nums">{view.label}</span>
  </button>

  <Drawer.Root
    bind:open={detailsOpen}
    onOpenChange={(o) => {
      if (!o) scheduleBodyLockRelease();
    }}
  >
    <Drawer.Content>
      <Drawer.Header>
        <Drawer.Title>{view.label}</Drawer.Title>
        <Drawer.Description>Syncing with {status.location}</Drawer.Description>
      </Drawer.Header>
      <div class="flex flex-col gap-3 px-4 pb-4" style="padding-bottom: calc(var(--safe-bottom) + 1rem);">
        <p class="text-muted-foreground text-sm">{explanation}</p>
        {#if status.lastSyncedMs}
          <p class="text-muted-foreground text-xs">Last synced {timeAgo(status.lastSyncedMs)}</p>
        {/if}
        <p class="text-muted-foreground text-xs">
          Syncing runs only while this workspace is open, and stops when you leave it.
        </p>
        <Button variant="secondary" class="w-full" disabled={syncing} onclick={() => void syncNow()}>
          <Icon icon={RefreshIcon} class={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>
    </Drawer.Content>
  </Drawer.Root>
{/if}
