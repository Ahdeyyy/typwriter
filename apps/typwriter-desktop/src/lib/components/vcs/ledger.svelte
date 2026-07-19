<!--
  vcs/ledger.svelte

  The version-history pane ("Ledger" design), mounted from the app
  sidebar. Maximum-density flat list: one 28px row per restore point with sticky
  day headers. The three important actions (view diff / set compare
  anchor / restore) surface *inline on hover* instead of hiding behind
  an overflow menu — the time column swaps to the action cluster so
  rows never grow. Selection shows as A/B chips, matching the compare
  strip at the top.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    ArrowReloadHorizontalIcon,
    Cancel01Icon,
    GitCommitIcon,
    GitCompareIcon,
    PlusSignIcon,
    Target02Icon,
  } from "@hugeicons/core-free-icons";

  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { toast } from "svelte-sonner";

  import { vcs } from "$lib/stores/vcs.svelte";
  import {
    bucketize,
    clockTime,
    restoreWithConfirm,
    selectEntry,
    selectionStateOf,
    shortId,
    triggerIcon,
    triggerLabel,
    useAsCompare,
    viewDiffFor,
  } from "./shared";
  import CreatePointDialog from "./create-point-dialog.svelte";

  interface Props {
    onclose?: () => void;
    onopenDiff?: () => void;
  }
  let { onclose, onopenDiff }: Props = $props();

  onMount(() => {
    vcs.refresh().mapErr((err) => toast.error(`History: ${err}`));
  });

  const buckets = $derived(bucketize(vcs.history));
  let createOpen = $state(false);

  // Inline action buttons use native `title` tooltips: three shadcn
  // tooltips per row would triple the row markup for no extra clarity.
  const inlineBtn =
    "inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
</script>

<div class="flex h-full flex-col bg-background">
  <!-- Header ─────────────────────────────────────────────────────────── -->
  <div class="flex h-8 shrink-0 items-center justify-between border-b border-border px-3">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</span>
      {#if vcs.history.length > 0}
        <span class="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {vcs.history.length}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-0.5">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-xs"
              onclick={() => (createOpen = true)}
              aria-label="New restore point"
            >
              <HugeiconsIcon icon={PlusSignIcon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>New restore point…</Tooltip.Content>
      </Tooltip.Root>
      {#if onclose}
        <Button variant="ghost" size="icon-xs" onclick={onclose} aria-label="Close history pane">
          <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
        </Button>
      {/if}
    </div>
  </div>

  <!-- Compare strip: only when a selection exists ─────────────────────── -->
  {#if vcs.primaryId}
    <div class="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px]">
      <span
        class="rounded-sm px-1 py-0.5 font-mono leading-none"
        style:background-color="color-mix(in srgb, {vcs.colorForCommit(vcs.primaryId)} 20%, transparent)"
        style:color={vcs.colorForCommit(vcs.primaryId)}
      >
        A {shortId(vcs.primaryId)}
      </span>
      <span class="text-muted-foreground">→</span>
      {#if vcs.secondaryId}
        <span
          class="rounded-sm px-1 py-0.5 font-mono leading-none"
          style:background-color="color-mix(in srgb, {vcs.colorForCommit(vcs.secondaryId)} 20%, transparent)"
          style:color={vcs.colorForCommit(vcs.secondaryId)}
        >
          B {shortId(vcs.secondaryId)}
        </span>
        <button
          type="button"
          class={inlineBtn}
          onclick={() => vcs.clearSecondary()}
          title="Clear compare anchor"
          aria-label="Clear compare anchor"
        >
          <HugeiconsIcon icon={Cancel01Icon} class="size-2.5" />
        </button>
      {:else}
        <span class="text-muted-foreground">current</span>
      {/if}
      <Button variant="outline" size="xs" class="ml-auto" onclick={() => onopenDiff?.()}>
        <HugeiconsIcon icon={GitCompareIcon} class="size-2.5" />
        Diff
      </Button>
    </div>
  {/if}

  <!-- Body ────────────────────────────────────────────────────────────── -->
  <ScrollArea.Root class="min-h-0 flex-1">
    {#if vcs.loading && vcs.history.length === 0}
      <p class="py-8 text-center text-sm text-muted-foreground select-none">Loading history…</p>
    {:else if vcs.history.length === 0}
      <div class="flex flex-col items-center gap-3 py-10 text-center select-none">
        <HugeiconsIcon icon={GitCommitIcon} class="size-7 text-muted-foreground/40" />
        <p class="text-sm text-muted-foreground">No restore points yet.</p>
        <Button variant="outline" size="xs" onclick={() => (createOpen = true)}>
          <HugeiconsIcon icon={PlusSignIcon} class="size-2.5" />
          Create restore point
        </Button>
      </div>
    {:else}
      <div class="pb-1">
        {#each buckets as bucket (bucket.label)}
          <div
            class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border/40 bg-background/95 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 backdrop-blur-sm"
          >
            {bucket.label}
            <span class="ml-auto tabular-nums font-normal">{bucket.entries.length}</span>
          </div>

          {#each bucket.entries as entry (entry.id)}
            {@const sel = selectionStateOf(entry.id)}
            {@const swatch = vcs.colorForCommit(entry.id)}
            {@const isCurrent = vcs.currentId === entry.id}
            <div
              class={[
                "group relative flex h-7 w-full items-center gap-1.5 pl-2.5 pr-1.5",
                "hover:bg-muted/60",
                sel === "primary" && "bg-muted",
                sel === "secondary" && "bg-muted/40",
              ]}
            >
              {#if isCurrent}
                <!-- "You are here" accent bar -->
                <span
                  class="absolute inset-y-0.5 left-0 w-[3px] rounded-r-full"
                  style="background: var(--primary)"
                  aria-hidden="true"
                ></span>
              {/if}

              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onclick={(ev) => selectEntry(ev, entry)}
                title={`${entry.message} · ${triggerLabel[entry.trigger]} · ${entry.changed_files.length} file${entry.changed_files.length === 1 ? "" : "s"}`}
              >
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  style:background-color={isCurrent ? "var(--primary)" : swatch}
                  aria-hidden="true"
                ></span>
                <HugeiconsIcon
                  icon={triggerIcon[entry.trigger]}
                  class="size-3 shrink-0 text-muted-foreground/60"
                />
                <span class="truncate text-xs leading-none {isCurrent ? 'font-medium' : ''}">
                  {entry.message}
                </span>
                <span class="shrink-0 text-[9px] tabular-nums text-muted-foreground/50">
                  {entry.changed_files.length}f
                </span>
                {#if sel !== "none"}
                  <span
                    class="shrink-0 rounded-sm px-1 text-[9px] font-semibold leading-4"
                    style:background-color="color-mix(in srgb, {swatch} 20%, transparent)"
                    style:color={swatch}
                  >
                    {sel === "primary" ? "A" : "B"}
                  </span>
                {/if}
              </button>

              <!-- Time ↔ actions swap on hover -->
              <span
                class="shrink-0 text-[10px] tabular-nums text-muted-foreground group-hover:hidden group-focus-within:hidden"
              >
                {clockTime(entry.timestamp_seconds)}
              </span>
              <div
                class="hidden shrink-0 items-center gap-px group-hover:flex group-focus-within:flex"
              >
                <button
                  type="button"
                  class={inlineBtn}
                  onclick={() => viewDiffFor(entry, onopenDiff)}
                  title="View diff vs current"
                  aria-label="View diff vs current"
                >
                  <HugeiconsIcon icon={GitCompareIcon} class="size-3" />
                </button>
                <button
                  type="button"
                  class={inlineBtn}
                  onclick={() => useAsCompare(entry)}
                  title="Use as compare anchor"
                  aria-label="Use as compare anchor"
                >
                  <HugeiconsIcon icon={Target02Icon} class="size-3" />
                </button>
                <button
                  type="button"
                  class="{inlineBtn} hover:text-destructive!"
                  onclick={() => restoreWithConfirm(entry)}
                  title="Restore here…"
                  aria-label="Restore here"
                >
                  <HugeiconsIcon icon={ArrowReloadHorizontalIcon} class="size-3" />
                </button>
              </div>
            </div>
          {/each}
        {/each}
      </div>
    {/if}
  </ScrollArea.Root>

  <!-- Footer ──────────────────────────────────────────────────────────── -->
  <div class="shrink-0 border-t border-border p-1">
    <Button
      variant="ghost"
      size="xs"
      class="w-full justify-center text-muted-foreground"
      onclick={() => (createOpen = true)}
    >
      <HugeiconsIcon icon={PlusSignIcon} class="size-2.5" />
      New restore point
    </Button>
  </div>
</div>

<CreatePointDialog bind:open={createOpen} />
