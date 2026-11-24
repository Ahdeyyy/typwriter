<script lang="ts">
  // The opt-in for folder workspaces. Nothing turns them on without the user
  // having seen this: what they get, and — just as plainly — what it costs.
  import { FolderSyncIcon } from "@hugeicons/core-free-icons";
  import Icon from "#lib/components/icon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Dialog from "#lib/components/ui/dialog/index.ts";
  import { dismissOnBack } from "#lib/back-dismiss.svelte.ts";
  import { scheduleBodyLockRelease } from "#lib/body-lock.ts";
  import { settings } from "#lib/stores/settings.svelte.ts";

  let {
    open = $bindable(false),
    onEnabled,
  }: {
    open?: boolean;
    /** Runs after the user turned folder workspaces on. */
    onEnabled?: () => void;
  } = $props();

  dismissOnBack(() => open, () => (open = false));

  const downsides = [
    {
      title: "Uses more storage",
      body: "Typwriter keeps its own copy of each folder workspace so typing and previews stay fast. A workspace takes up roughly twice its size on this device.",
    },
    {
      title: "Changes from other devices arrive within seconds, not instantly",
      body: "The file you are editing is checked every second and the rest of the folder every few seconds, only while the workspace is open on screen.",
    },
    {
      title: "Some battery use while a workspace is open",
      body: "Those checks stop whenever the app is in the background, and resume (with an immediate catch-up) when you come back.",
    },
    {
      title: "The first open of a large folder takes a while",
      body: "Everything is copied in once. After that only changed files are.",
    },
    {
      title: "Editing the same file on two devices at once needs your call",
      body: "If another device saves a file you are also changing, you choose Keep mine or Reload. Nothing is overwritten silently.",
    },
    {
      title: "The folder has to stay reachable",
      body: "If it is moved, deleted, on a removed SD card, or its access is revoked, saving to it fails until it is back. Hidden files such as .git are not shown or copied.",
    },
  ];

  function enable() {
    settings.setFolderWorkspaces(true);
    open = false;
    scheduleBodyLockRelease();
    onEnabled?.();
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(o) => {
    if (!o) scheduleBodyLockRelease();
  }}
>
  <Dialog.Content class="max-h-[85svh] overflow-y-auto">
    <Dialog.Header>
      <div class="bg-primary/10 text-primary mb-1 flex size-11 items-center justify-center rounded-xl">
        <Icon icon={FolderSyncIcon} class="size-6" />
      </div>
      <Dialog.Title>Store workspaces in your own folders?</Dialog.Title>
      <Dialog.Description>
        Workspaces can live in any folder you choose, for example one a sync app such as Syncthing
        keeps in step with your other devices. Before you turn this on, here is what it costs:
      </Dialog.Description>
    </Dialog.Header>
    <ul class="flex flex-col gap-3 py-1">
      {#each downsides as item (item.title)}
        <li class="flex flex-col gap-0.5">
          <span class="text-sm font-medium">{item.title}</span>
          <span class="text-muted-foreground text-xs">{item.body}</span>
        </li>
      {/each}
    </ul>
    <p class="text-muted-foreground text-xs">
      While a folder workspace is open, an indicator shows whether it is syncing, up to date,
      paused or unable to reach the folder, and you are told when syncing starts and stops. You
      can turn this off again in Settings.
    </p>
    <Dialog.Footer class="mt-2 flex-col gap-2">
      <Button class="w-full" onclick={enable}>Turn on</Button>
      <Button variant="ghost" class="w-full" onclick={() => (open = false)}>Not now</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
