<!--
  vcs/timeline.svelte

  The version-history pane. Lives inside the app sidebar and serves as the
  entry point to every VCS operation:

    * Lists restore points in date-bucketed, collapsible groups.
    * Each entry's timeline node is colored by its branch in the parent_id
      graph, using the --vcs-node-* CSS custom properties from layout.css.
    * Click selects a point → shows diff vs current working tree.
    * Cmd/Ctrl-click selects a second point → two-point diff.
    * Each row has an overflow menu (··· on hover, right-click anywhere).
    * Bottom-left "+" opens a shadcn Dialog for naming the restore point.
-->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Cancel01Icon,
    ArrowReloadHorizontalIcon,
    GitCommitIcon,
    PlayIcon,
    Tag01Icon,
    GitCompareIcon,
    FloppyDiskIcon,
    FileEditIcon,
    MoreHorizontalIcon,
    PlusSignIcon,
    ArrowDown01Icon,
    ArrowRight01Icon,
  } from "@hugeicons/core-free-icons";

  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { toast } from "svelte-sonner";

  import { vcs } from "$lib/stores/vcs.svelte";
  import type { CommitTrigger, RestorePoint } from "$lib/types";

  interface Props {
    onclose?: () => void;
    onopenDiff?: () => void;
  }
  let { onclose, onopenDiff }: Props = $props();

  onMount(() => {
    vcs.refresh().mapErr((err) => toast.error(`History: ${err}`));
  });

  // ─── Display helpers ────────────────────────────────────────────────────

  const triggerLabel: Record<CommitTrigger, string> = {
    initial: "Initial",
    manual: "Manual",
    save: "Save",
    compile: "Compile",
    pre_restore: "Pre-restore",
    file_op: "File change",
  };

  const triggerIcon: Record<CommitTrigger, typeof PlayIcon> = {
    initial: GitCommitIcon,
    manual: Tag01Icon,
    save: FloppyDiskIcon,
    compile: PlayIcon,
    pre_restore: ArrowReloadHorizontalIcon,
    file_op: FileEditIcon,
  };

  function shortId(id: string): string {
    return id.slice(0, 7);
  }

  function relTime(sec: number): string {
    const now = Date.now() / 1000;
    const diff = Math.max(0, now - sec);
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
    const d = new Date(sec * 1000);
    return d.toLocaleDateString();
  }

  function selectionStateOf(id: string): "none" | "primary" | "secondary" {
    if (vcs.primaryId === id) return "primary";
    if (vcs.secondaryId === id) return "secondary";
    return "none";
  }

  // ─── Date buckets ────────────────────────────────────────────────────────

  type Bucket = { label: string; entries: RestorePoint[] };

  const buckets = $derived.by<Bucket[]>(() => {
    const now = new Date();
    const startOfToday =
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const startOfYesterday = startOfToday - 86400;
    const startOfWeek = startOfToday - 86400 * 6;

    const today: RestorePoint[] = [];
    const yesterday: RestorePoint[] = [];
    const week: RestorePoint[] = [];
    const earlier: RestorePoint[] = [];

    for (const e of vcs.history) {
      if (e.timestamp_seconds >= startOfToday) today.push(e);
      else if (e.timestamp_seconds >= startOfYesterday) yesterday.push(e);
      else if (e.timestamp_seconds >= startOfWeek) week.push(e);
      else earlier.push(e);
    }

    const out: Bucket[] = [];
    if (today.length) out.push({ label: "Today", entries: today });
    if (yesterday.length) out.push({ label: "Yesterday", entries: yesterday });
    if (week.length) out.push({ label: "This week", entries: week });
    if (earlier.length) out.push({ label: "Earlier", entries: earlier });
    return out;
  });

  // ─── Collapsible state ───────────────────────────────────────────────────

  /** Labels of currently-collapsed buckets. Buckets not in the set are open. */
  let collapsedBuckets = $state(new Set<string>());

  function toggleBucket(label: string) {
    const next = new Set(collapsedBuckets);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    collapsedBuckets = next;
  }

  // ─── Selection handlers ──────────────────────────────────────────────────

  async function onclick(ev: MouseEvent, entry: RestorePoint) {
    const additive = ev.metaKey || ev.ctrlKey || ev.shiftKey;
    (await vcs.selectPoint(entry.id, additive)).mapErr((err) =>
      toast.error(`History: ${err}`)
    );
  }

  async function useAsCompare(entry: RestorePoint) {
    if (!vcs.primaryId) {
      (await vcs.selectPoint(entry.id, false)).mapErr((err) =>
        toast.error(`History: ${err}`)
      );
      return;
    }
    if (vcs.primaryId === entry.id) {
      toast.info("That's already the anchor.");
      return;
    }
    (await vcs.selectPoint(entry.id, true)).mapErr((err) =>
      toast.error(`History: ${err}`)
    );
  }

  function viewDiffFor(entry: RestorePoint) {
    if (vcs.primaryId !== entry.id) {
      vcs.selectPoint(entry.id, false).mapErr((err) =>
        toast.error(`History: ${err}`)
      );
    }
    onopenDiff?.();
  }

  // ─── Restore ────────────────────────────────────────────────────────────

  async function onrestore(entry: RestorePoint) {
    const ok = await confirm(
      `Restore workspace to "${entry.message}" (${shortId(entry.id)})?\n\n` +
        "Your current state will be saved as a 'pre-restore' point you can " +
        "return to from this same timeline."
    );
    if (!ok) return;
    const result = await vcs.restoreWorkspaceTo(entry.id);
    result.match(
      () => toast.success("Workspace restored."),
      (err) => toast.error(`Restore failed: ${err}`)
    );
  }

  async function confirm(message: string): Promise<boolean> {
    const { confirm: tConfirm } = await import("@tauri-apps/plugin-dialog");
    return tConfirm(message, { title: "Typwriter", kind: "warning" });
  }

  // ─── Create restore point dialog ─────────────────────────────────────────

  let createOpen = $state(false);
  let createLabel = $state("");
  let createSubmitting = $state(false);
  let labelInputEl: HTMLInputElement | null = $state(null);

  async function openCreateDialog() {
    createLabel = defaultRestoreLabel();
    createOpen = true;
    await tick();
    labelInputEl?.focus();
    labelInputEl?.select();
  }

  function defaultRestoreLabel(): string {
    const d = new Date();
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `Checkpoint ${d.toLocaleDateString()} ${hh}:${mm}`;
  }

  async function submitCreate() {
    if (createSubmitting) return;
    createSubmitting = true;
    const label = createLabel.trim() || "Restore point";
    const result = await vcs.createRestorePoint(label);
    createSubmitting = false;
    result.match(
      (id) => {
        if (id === null) {
          toast.info(
            "Nothing to save — the workspace already matches the latest restore point."
          );
        } else {
          toast.success(`Saved "${label}".`);
        }
        createOpen = false;
      },
      (err) => toast.error(`Create failed: ${err}`)
    );
  }

  function viewDiffClick() {
    if (!vcs.primaryId) {
      toast.info("Select a restore point first.");
      return;
    }
    onopenDiff?.();
  }
</script>

<div class="flex h-full flex-col border-t border-border bg-background">
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
              onclick={openCreateDialog}
              aria-label="New restore point"
            >
              <HugeiconsIcon icon={PlusSignIcon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>New restore point…</Tooltip.Content>
      </Tooltip.Root>
      {#if onclose}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-xs"
                onclick={onclose}
                aria-label="Close history pane"
              >
                <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Close</Tooltip.Content>
        </Tooltip.Root>
      {/if}
    </div>
  </div>

  <!-- Selection bar ───────────────────────────────────────────────────── -->
  {#if vcs.primaryId}
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/30 px-3 py-2 text-[11px]">
      <span class="text-muted-foreground">Comparing</span>
      <span
        class="rounded px-1.5 py-0.5 font-mono"
        style:background-color="color-mix(in srgb, {vcs.colorForCommit(vcs.primaryId)} 20%, transparent)"
        style:color={vcs.colorForCommit(vcs.primaryId)}
      >
        {shortId(vcs.primaryId)}
      </span>
      <span class="text-muted-foreground">→</span>
      {#if vcs.secondaryId}
        <span
          class="rounded px-1.5 py-0.5 font-mono"
          style:background-color="color-mix(in srgb, {vcs.colorForCommit(vcs.secondaryId)} 20%, transparent)"
          style:color={vcs.colorForCommit(vcs.secondaryId)}
        >
          {shortId(vcs.secondaryId)}
        </span>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-xs"
                onclick={() => vcs.clearSecondary()}
                aria-label="Clear compare anchor"
              >
                <HugeiconsIcon icon={Cancel01Icon} class="size-3" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Clear compare anchor</Tooltip.Content>
        </Tooltip.Root>
      {:else}
        <span class="text-muted-foreground">current</span>
      {/if}
      <span class="ml-auto"></span>
      <Button variant="outline" size="xs" onclick={viewDiffClick}>
        <HugeiconsIcon icon={GitCompareIcon} class="mr-1 size-3.5" />
        View diff
      </Button>
    </div>
  {/if}

  <!-- Body ────────────────────────────────────────────────────────────── -->
  <ScrollArea.Root class="flex-1 min-h-0">
    {#if vcs.loading && vcs.history.length === 0}
      <p class="py-8 text-center text-sm text-muted-foreground select-none">Loading history…</p>
    {:else if vcs.history.length === 0}
      <div class="flex flex-col items-center gap-3 py-10 text-center select-none">
        <HugeiconsIcon icon={GitCommitIcon} class="size-7 text-muted-foreground/40" />
        <div class="space-y-1">
          <p class="text-sm text-muted-foreground">No restore points yet.</p>
          <p class="px-6 text-[11px] text-muted-foreground/70">
            Save a file or compile to create one automatically.
          </p>
        </div>
        <Button variant="outline" size="xs" onclick={openCreateDialog}>
          <HugeiconsIcon icon={PlusSignIcon} class="mr-1.5 size-3.5" />
          Create restore point
        </Button>
      </div>
    {:else}
      <div class="pb-2">
        {#each buckets as bucket (bucket.label)}
          {@const isCollapsed = collapsedBuckets.has(bucket.label)}
          <div>
            <!-- Bucket header ────────────────────────────────────────── -->
            <button
              type="button"
              class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              onclick={() => toggleBucket(bucket.label)}
              aria-expanded={!isCollapsed}
            >
              <HugeiconsIcon
                icon={isCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
                class="size-2.5 shrink-0"
              />
              {bucket.label}
              <span class="ml-auto tabular-nums text-[9px]">{bucket.entries.length}</span>
            </button>

            <!-- Entries ─────────────────────────────────────────────── -->
            {#if !isCollapsed}
              <!-- Indent under the bucket header and draw a vertical guide
                   so entries read as children of the collapsible — same
                   visual contract as a file tree, implemented in CSS rather
                   than via @pierre/trees (whose item slot can't host our
                   custom row layout). The guide sits at the chevron's
                   horizontal centre so it links back to the parent. -->
              <ul class="ml-[15px] border-l border-border/60 pb-0.5">
                {#each bucket.entries as entry (entry.id)}
                  {@const sel = selectionStateOf(entry.id)}
                  {@const swatch = vcs.colorForCommit(entry.id)}
                  {@const isCurrent = vcs.currentId === entry.id}
                  <li>
                    <ContextMenu.Root>
                      <ContextMenu.Trigger class="block w-full">
                        <div
                          class="group relative flex w-full items-start gap-2.5 pl-2.5 pr-2 py-1 text-left text-sm hover:bg-muted/60
                                 {sel === 'primary' ? 'bg-muted' : ''}
                                 {sel === 'secondary' ? 'bg-muted/50' : ''}
                                 {isCurrent ? 'is-current' : ''}"
                        >
                          <button
                            type="button"
                            class="flex flex-1 items-start gap-2.5 text-left min-w-0"
                            onclick={(ev) => onclick(ev, entry)}
                          >
                            <!-- Branch-colored node. Three layered states:
                                   • selection (primary / secondary) — branch
                                     color glow / ring; says "you picked this".
                                   • current (HEAD) — node fill swaps to
                                     `--primary` and gets a contrasting
                                     `--ring` halo; says "you are here".
                                   When both apply, current wins on the fill
                                   and the selection's glow stacks around it. -->
                            <span
                              class="mt-1.5 size-2 shrink-0 rounded-full transition-[box-shadow,transform] duration-150
                                     {sel === 'primary' ? 'scale-110' : ''}
                                     {sel === 'secondary' ? 'scale-105' : ''}
                                     {isCurrent ? 'scale-125' : ''}"
                              style:background-color={isCurrent ? "var(--primary)" : swatch}
                              style:box-shadow={
                                isCurrent && sel === "primary"
                                  ? `0 0 0 1.5px var(--background), 0 0 0 3px var(--ring), 0 0 9px var(--ring), 0 0 0 5px ${swatch}`
                                  : isCurrent
                                    ? `0 0 0 1.5px var(--background), 0 0 0 2.5px var(--ring), 0 0 8px var(--ring)`
                                    : sel === "primary"
                                      ? `0 0 0 1.5px var(--background), 0 0 0 3px ${swatch}, 0 0 8px ${swatch}`
                                      : sel === "secondary"
                                        ? `0 0 0 1.5px var(--background), 0 0 0 2.5px ${swatch}`
                                        : "none"
                              }
                              aria-hidden="true"
                            ></span>

                            <div class="min-w-0 flex-1">
                              <div class="flex items-baseline gap-2">
                                <span class="truncate font-medium leading-snug">{entry.message}</span>
                                {#if isCurrent}
                                  <span
                                    class="shrink-0 rounded-sm px-1 py-px text-[9px] font-medium uppercase tracking-wide leading-none"
                                    style="background: color-mix(in srgb, var(--ring) 18%, transparent); color: var(--ring);"
                                    title="The workspace currently matches this restore point."
                                  >
                                    Here
                                  </span>
                                {/if}
                                <span class="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                  {relTime(entry.timestamp_seconds)}
                                </span>
                              </div>
                              <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <HugeiconsIcon icon={triggerIcon[entry.trigger]} class="size-3 shrink-0" />
                                <span class="uppercase tracking-wide">{triggerLabel[entry.trigger]}</span>
                                <span class="opacity-50">·</span>
                                <span>
                                  {entry.changed_files.length} file{entry.changed_files.length === 1 ? "" : "s"}
                                </span>
                              </div>
                            </div>
                          </button>

                          <!-- Per-row overflow menu -->
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger>
                              {#snippet child({ props })}
                                <Button
                                  {...props}
                                  variant="ghost"
                                  size="icon-xs"
                                  class={[
                                    "mt-0.5 shrink-0 transition-opacity focus-visible:opacity-100 data-[state=open]:opacity-100",
                                    "opacity-0 group-hover:opacity-100",
                                  ]}
                                  aria-label="Restore point actions"
                                  onclick={(ev: MouseEvent) => ev.stopPropagation()}
                                >
                                  <HugeiconsIcon icon={MoreHorizontalIcon} class="size-3.5" />
                                </Button>
                              {/snippet}
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content align="end" class="w-52">
                              <DropdownMenu.Item onclick={() => viewDiffFor(entry)}>
                                <HugeiconsIcon icon={GitCompareIcon} class="mr-2 size-3.5" />
                                View diff vs current
                              </DropdownMenu.Item>
                              <DropdownMenu.Item onclick={() => useAsCompare(entry)}>
                                <HugeiconsIcon icon={GitCompareIcon} class="mr-2 size-3.5" />
                                {vcs.primaryId && vcs.primaryId !== entry.id
                                  ? "Use as compare anchor"
                                  : "Set as anchor"}
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                onclick={() => onrestore(entry)}
                                variant="destructive"
                                class="focus:bg-transparent"
                              >
                                <!-- Bits-ui's prop merging or the popover
                                     portal seems to strip the inherited
                                     `color: var(--destructive)` from the
                                     item's text. We sidestep the problem by
                                     setting the colour on a wrapping <span>
                                     directly — inline style has the highest
                                     specificity and applies to the text node
                                     no matter what the ancestor cascade
                                     looks like. The HugeIcons SVG picks up
                                     the same colour via `currentColor`. -->
                                <span
                                  class="-mx-2 -my-1 flex w-[calc(100%+1rem)] items-center gap-2 rounded-sm bg-destructive px-2 py-1 font-medium transition-colors group-focus/dropdown-menu-item:bg-destructive/85"
                                  style="color: var(--destructive-foreground);"
                                >
                                  <HugeiconsIcon icon={ArrowReloadHorizontalIcon} class="size-3.5" />
                                  Restore here…
                                </span>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Root>
                        </div>
                      </ContextMenu.Trigger>

                      <!-- Right-click menu mirrors the dropdown -->
                      <ContextMenu.Content class="w-52">
                        <ContextMenu.Item onclick={() => viewDiffFor(entry)}>
                          <HugeiconsIcon icon={GitCompareIcon} class="mr-2 size-3.5" />
                          View diff vs current
                        </ContextMenu.Item>
                        <ContextMenu.Item onclick={() => useAsCompare(entry)}>
                          <HugeiconsIcon icon={GitCompareIcon} class="mr-2 size-3.5" />
                          {vcs.primaryId && vcs.primaryId !== entry.id
                            ? "Use as compare anchor"
                            : "Set as anchor"}
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                        <ContextMenu.Item
                          onclick={() => onrestore(entry)}
                          variant="destructive"
                          class="focus:bg-transparent"
                        >
                          <span
                            class="-mx-2 -my-1 flex w-[calc(100%+1rem)] items-center gap-2 rounded-sm bg-destructive px-2 py-1 font-medium transition-colors group-focus/context-menu-item:bg-destructive/85"
                            style="color: var(--destructive-foreground);"
                          >
                            <HugeiconsIcon icon={ArrowReloadHorizontalIcon} class="size-3.5" />
                            Restore here…
                          </span>
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Root>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>

      <p class="px-3 pb-3 text-[10px] text-muted-foreground/60 select-none">
        Tip: click to diff vs current · Cmd+click for two-point diff
      </p>
    {/if}
  </ScrollArea.Root>
</div>

<!-- Create restore point dialog ─────────────────────────────────────── -->
<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>New restore point</Dialog.Title>
      <Dialog.Description>
        Save the current workspace state. You can restore or diff against it any time from the History pane.
      </Dialog.Description>
    </Dialog.Header>

    <form
      class="space-y-4 py-1"
      onsubmit={(ev) => {
        ev.preventDefault();
        submitCreate();
      }}
    >
      <div class="space-y-2">
        <label class="text-sm font-medium text-foreground" for="vcs-create-label">Label</label>
        <Input
          id="vcs-create-label"
          bind:ref={labelInputEl}
          bind:value={createLabel}
          placeholder="e.g. Before refactor, Draft 2"
          maxlength={120}
          disabled={createSubmitting}
        />
        <p class="text-xs text-muted-foreground">
          A short name shown in the timeline alongside the time and file count.
        </p>
      </div>

      <Dialog.Footer>
        <Button
          type="button"
          variant="outline"
          onclick={() => (createOpen = false)}
          disabled={createSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={createSubmitting}>
          {createSubmitting ? "Saving…" : "Save restore point"}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
