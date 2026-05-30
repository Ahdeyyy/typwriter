<!--
  vcs/diff-overlay.svelte

  Full-bleed overlay anchored over the editor pane. Renders the currently
  selected diff (either "point vs current" or "point A vs point B") as a list
  of per-file @pierre/diffs FileDiff instances.

  Mounted on demand from `workspace.svelte` when `vcs.diffPaneOpen` flips true,
  which keeps the Shiki/WASM payload out of the cold path.
-->
<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Cancel01Icon,
    ArrowReloadHorizontalIcon,
    GitCompareIcon,
    Layout01Icon,
    LayoutTwoColumnIcon,
  } from "@hugeicons/core-free-icons";

  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { toast } from "svelte-sonner";

  import { vcs } from "$lib/stores/vcs.svelte";
  import DiffViewer from "./diff-viewer.svelte";

  let layout = $state<"split" | "unified">("split");

  const heading = $derived.by(() => {
    if (!vcs.primaryId) return "No restore point selected";
    const a = vcs.findById(vcs.primaryId)?.message ?? vcs.primaryId.slice(0, 7);
    if (vcs.secondaryId) {
      const b = vcs.findById(vcs.secondaryId)?.message ?? vcs.secondaryId.slice(0, 7);
      return `${a} → ${b}`;
    }
    return `${a} → current`;
  });

  async function onrestoreFile(path: string) {
    if (!vcs.primaryId) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(`Restore "${path}" from the selected restore point?`, {
      title: "Typwriter",
      kind: "warning",
    });
    if (!ok) return;
    const result = await vcs.restoreSingleFile(vcs.primaryId, path);
    result.match(
      () => toast.success(`Restored ${path}`),
      (err) => toast.error(`Restore failed: ${err}`),
    );
  }
</script>

<div class="absolute inset-0 z-30 flex flex-col bg-background">
  <!-- Header ─────────────────────────────────────────────────────── -->
  <div class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-muted/30 px-3">
    <HugeiconsIcon icon={GitCompareIcon} class="size-4 text-muted-foreground" />
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium">{heading}</div>
      <div class="text-[10px] text-muted-foreground">
        {vcs.diff?.files.length ?? 0} file{(vcs.diff?.files.length ?? 0) === 1 ? "" : "s"} changed
      </div>
    </div>

    <!-- Split / unified toggle. A real <ToggleGroup> would be overkill for two
         mutually-exclusive states; two buttons with `aria-pressed` is cleaner
         and avoids pulling in an extra shadcn component. -->
    <div class="flex items-center rounded border border-border bg-background">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={layout === "split" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={layout === "split"}
              onclick={() => (layout = "split")}
            >
              <HugeiconsIcon icon={LayoutTwoColumnIcon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Split view</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={layout === "unified" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={layout === "unified"}
              onclick={() => (layout = "unified")}
            >
              <HugeiconsIcon icon={Layout01Icon} class="size-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Unified view</Tooltip.Content>
      </Tooltip.Root>
    </div>

    <Button variant="ghost" size="icon-sm" onclick={() => (vcs.diffPaneOpen = false)} aria-label="Close diff">
      <HugeiconsIcon icon={Cancel01Icon} class="size-4" />
    </Button>
  </div>

  <!-- Body ───────────────────────────────────────────────────────── -->
  <ScrollArea.Root class="flex-1 min-h-0">
    {#if vcs.diffLoading}
      <p class="py-12 text-center text-sm text-muted-foreground">Computing diff…</p>
    {:else if !vcs.diff || vcs.diff.files.length === 0}
      <p class="py-12 text-center text-sm text-muted-foreground">No differences.</p>
    {:else}
      <div class="space-y-6 p-4">
        {#each vcs.diff.files as entry (entry.path)}
          <section class="space-y-2">
            <header class="flex items-center gap-2 text-[11px]">
              <span
                class="rounded px-1.5 py-0.5 font-mono uppercase"
                class:bg-emerald-500-15={entry.status === "added"}
                class:text-emerald-600={entry.status === "added"}
                class:dark:text-emerald-400={entry.status === "added"}
                class:bg-red-500-15={entry.status === "removed"}
                class:text-red-600={entry.status === "removed"}
                class:dark:text-red-400={entry.status === "removed"}
                class:bg-muted={entry.status === "modified"}
                class:text-muted-foreground={entry.status === "modified"}
              >
                {entry.status}
              </span>
              <span class="truncate font-mono text-foreground">{entry.path}</span>
              <span class="text-muted-foreground">·</span>
              <span class="tabular-nums text-muted-foreground">
                {entry.before_bytes.toLocaleString()} → {entry.after_bytes.toLocaleString()} b
              </span>
              {#if !vcs.secondaryId}
                <Button
                  variant="ghost"
                  size="xs"
                  class="ml-auto"
                  onclick={() => onrestoreFile(entry.path)}
                  title="Restore just this file"
                >
                  <HugeiconsIcon icon={ArrowReloadHorizontalIcon} class="mr-1 size-3" />
                  Restore file
                </Button>
              {/if}
            </header>
            <DiffViewer {entry} {layout} />
          </section>
        {/each}
      </div>
    {/if}
  </ScrollArea.Root>
</div>

<style>
  /* Tailwind doesn't have arbitrary alpha-color classes baked in for our
     theme; encode the soft tints used by the status pill. */
  :global(.bg-emerald-500-15) { background-color: color-mix(in srgb, rgb(16 185 129) 15%, transparent); }
  :global(.bg-red-500-15) { background-color: color-mix(in srgb, rgb(239 68 68) 15%, transparent); }
</style>
