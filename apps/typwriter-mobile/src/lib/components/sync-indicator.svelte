<script lang="ts">
  // A folder workspace's sync state, kept small. Only workspaces that sync
  // show it, and it is there exactly while syncing runs. Every variant that
  // can be tapped opens the shared details sheet (`sync-details.svelte`).
  //
  // - `icon`: a small icon button (file-tree footer, tablet tab strip).
  // - `dot`: a status dot laid over another button (the phone header's files
  //   button). Quiet while all is well; hidden while `alert` shows instead.
  // - `alert`: a red header button, only while the folder can't be reached —
  //   the way back to the details once the toast has gone.
  import Icon from "#lib/components/icon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { workspace } from "#lib/stores/workspace.svelte.ts";
  import { syncView } from "./sync-view.ts";

  let { variant = "icon" }: { variant?: "icon" | "dot" | "alert" } = $props();

  const status = $derived(workspace.sync);
  const view = $derived(status ? syncView(status) : null);
  const offline = $derived(status?.state === "offline");
</script>

{#if status && view}
  {#if variant === "dot"}
    {#if !offline}
      <span
        class="ring-background pointer-events-none absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2 {view.dot}"
        aria-hidden="true"
      ></span>
    {/if}
  {:else if variant === "alert"}
    {#if offline}
      <button
        class="float-btn text-destructive"
        aria-label="Sync: {view.label}"
        onclick={() => (workspace.syncDetailsOpen = true)}
      >
        <Icon icon={view.icon} class="size-5" />
      </button>
    {/if}
  {:else}
    <Button
      variant="ghost"
      size="icon"
      class={view.tone}
      aria-label="Sync: {view.label}"
      onclick={() => (workspace.syncDetailsOpen = true)}
    >
      <Icon icon={view.icon} class={status.state === "syncing" ? "animate-pulse" : ""} />
    </Button>
  {/if}
{/if}
