<script lang="ts">
  // Confirms that one workspace should sync with a folder (opening an
  // existing folder, or moving a workspace out of the app), after a short
  // list of what that costs. Syncing is a per-workspace choice: this never
  // changes anything for other workspaces.
  import { FolderSyncIcon } from "@hugeicons/core-free-icons";
  import Icon from "#lib/components/icon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Dialog from "#lib/components/ui/dialog/index.ts";
  import { dismissOnBack } from "#lib/back-dismiss.svelte.ts";
  import { scheduleBodyLockRelease } from "#lib/body-lock.ts";
  import SyncTradeoffs from "#lib/components/sync-tradeoffs.svelte";

  let {
    open = $bindable(false),
    title = "Sync with a folder?",
    description = "Keep this workspace in a folder that a sync app, like Syncthing, shares with your other devices.",
    confirmLabel = "Choose folder",
    busy = false,
    onConfirm,
  }: {
    open?: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
  } = $props();

  dismissOnBack(() => open, () => (open = false));
</script>

<Dialog.Root
  bind:open
  onOpenChange={(o) => {
    if (!o) scheduleBodyLockRelease();
  }}
>
  <Dialog.Content>
    <Dialog.Header>
      <div class="bg-primary/10 text-primary mb-1 flex size-11 items-center justify-center rounded-xl">
        <Icon icon={FolderSyncIcon} class="size-6" />
      </div>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <SyncTradeoffs class="py-1" />
    <Dialog.Footer class="mt-2 flex-col gap-2">
      <Button class="w-full" disabled={busy} onclick={onConfirm}>{busy ? "Working…" : confirmLabel}</Button>
      <Button variant="ghost" class="w-full" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
