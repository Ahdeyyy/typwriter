<!--
  pages/diff-window.svelte

  Standalone version-diff window (label "diff", routed via `?window=diff`).
  Renders the selected diff (either "point vs current" or "point A vs point B")
  two ways, behind a Files / Pages toggle:

    * **Files** — a list of per-file @pierre/diffs FileDiff instances. Source
      truth: what text moved.
    * **Pages** — the rendered-page comparison. Answers "which pages of the
      finished document changed", which the source diff can't: a one-word edit
      can reflow forty pages, and a large refactor can change none. It costs a
      compile of the restore point, so it is requested on demand (first time
      the tab is opened, or via its refresh button) rather than eagerly.

  This window owns its own store instances, so it computes the diff itself over
  IPC: the selection is seeded from URL params on boot and retargeted through
  `vcs:diff-selection` events while open. Single-file restores are delegated to
  the main window (`vcs:restore-file-request` → `vcs:restore-file-result`)
  because the editor tabs that must be flushed before — and reloaded after —
  the restore live in the main window's stores.
-->
<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    ArrowReloadHorizontalIcon,
    File01Icon,
    GitCompareIcon,
    Layers01Icon,
    Layout01Icon,
    LayoutTwoColumnIcon,
  } from "@hugeicons/core-free-icons";

  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { toast } from "svelte-sonner";

  import { vcs } from "$lib/stores/vcs.svelte";
  import {
    onVcsDiffSelection,
    onVcsPageDiff,
    onVcsPageDiffError,
    onVcsRestoreFileResult,
    emitVcsRestoreFileRequest,
    type UnlistenFn,
  } from "$lib/ipc/events";
  import { logError } from "$lib/logger";
  import DiffViewer from "$lib/components/vcs/diff-viewer.svelte";
  import PageDiffView from "$lib/components/vcs/page-diff-view.svelte";

  type DiffView = "files" | "pages";
  type Props = {
    initialPrimary?: string | null;
    initialSecondary?: string | null;
    initialView?: DiffView;
  };
  let { initialPrimary = null, initialSecondary = null, initialView = "files" }: Props =
    $props();

  let layout = $state<"split" | "unified">("split");
  // Seeded once from the URL param, then owned by the toggle. `untrack` says
  // so explicitly: the prop is a boot value, and a later change to it (which
  // can't happen — the window is created with its params) must not stomp on
  // whatever tab the user has since chosen.
  let view = $state<DiffView>(untrack(() => initialView));

  /** Switch tabs, computing the page diff the first time Pages is opened for
   *  the current selection. Not automatic on selection change: it costs a
   *  full compile, and the user may only ever want the file diff. */
  function showPages() {
    view = "pages";
    if (!vcs.pageDiff && !vcs.pageDiffLoading && !vcs.pageDiffError) {
      requestPageDiff();
    }
  }

  function requestPageDiff() {
    vcs.requestPageDiff().mapErr((err) => toast.error(`Pages: ${err}`));
  }

  /** Path of the file whose delegated restore is in flight — disables its
   *  button until the main window reports back. */
  let restoringPath = $state<string | null>(null);

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
    if (!vcs.primaryId || restoringPath) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(`Restore "${path}" from the selected restore point?`, {
      title: "Typwriter",
      kind: "warning",
    });
    if (!ok) return;
    restoringPath = path;
    const result = await emitVcsRestoreFileRequest({ pointId: vcs.primaryId, path });
    result.mapErr((err) => {
      restoringPath = null;
      toast.error(`Restore failed: ${err}`);
    });
  }

  let unlistens: UnlistenFn[] = [];

  onMount(() => {
    vcs
      .refresh()
      .andThen(() => vcs.setSelection(initialPrimary, initialSecondary))
      .map(() => {
        // `setSelection` clears any stale page diff, so the request has to
        // come after it — otherwise we'd cancel the one we just made.
        if (view === "pages") requestPageDiff();
      })
      .mapErr((err) => toast.error(`Diff: ${err}`));

    onVcsDiffSelection(({ primaryId, secondaryId, view: requestedView }) => {
      if (requestedView) view = requestedView;
      vcs
        .setSelection(primaryId, secondaryId)
        .map(() => {
          // Retargeting invalidated the old page diff. Recompute only if the
          // user is actually looking at it — otherwise wait for the tab.
          if (view === "pages" && primaryId) requestPageDiff();
        })
        .mapErr((err) => toast.error(`Diff: ${err}`));
      // The selection may reference a point created since boot.
      vcs.refresh().mapErr((err) => logError("diff window history refresh failed:", err));
    })
      .map((unlisten) => unlistens.push(unlisten))
      .mapErr((err) => logError("diff selection listener failed:", err));

    // The page diff is computed by a backend worker (it has to compile the
    // restore point), so its result arrives as an event rather than a command
    // return. The store drops anything tagged with a superseded request id.
    onVcsPageDiff((payload) => vcs.applyPageDiff(payload))
      .map((unlisten) => unlistens.push(unlisten))
      .mapErr((err) => logError("page diff listener failed:", err));

    onVcsPageDiffError(({ request_id, message }) =>
      vcs.applyPageDiffError(request_id, message)
    )
      .map((unlisten) => unlistens.push(unlisten))
      .mapErr((err) => logError("page diff error listener failed:", err));

    onVcsRestoreFileResult(({ path, error }) => {
      restoringPath = null;
      if (error) {
        toast.error(`Restore failed: ${error}`);
        return;
      }
      toast.success(`Restored ${path}`);
      // The working tree (and history — a pre-restore point may exist now)
      // changed under us; recompute what this window shows.
      vcs
        .refresh()
        .andThen(() => vcs.setSelection(vcs.primaryId, vcs.secondaryId))
        .mapErr((err) => logError("diff window reload after restore failed:", err));
    })
      .map((unlisten) => unlistens.push(unlisten))
      .mapErr((err) => logError("restore result listener failed:", err));
  });

  onDestroy(() => {
    for (const unlisten of unlistens) unlisten();
    unlistens = [];
    vcs.destroy();
  });
</script>

<Tooltip.Provider>
<div class="flex h-screen w-screen flex-col overflow-hidden bg-background">
  <Titlebar variant="minimal" title="Version Diff" />

  <!-- Header ─────────────────────────────────────────────────────── -->
  <div class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-muted/30 px-3">
    <HugeiconsIcon icon={GitCompareIcon} class="size-4 text-muted-foreground" />
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium">{heading}</div>
      <div class="text-[10px] text-muted-foreground">
        {#if view === "pages" && vcs.pageDiff}
          {vcs.pageDiff.changed + vcs.pageDiff.added + vcs.pageDiff.removed} page{vcs.pageDiff
            .changed +
            vcs.pageDiff.added +
            vcs.pageDiff.removed ===
          1
            ? ""
            : "s"} changed
        {:else}
          {vcs.diff?.files.length ?? 0} file{(vcs.diff?.files.length ?? 0) === 1 ? "" : "s"} changed
        {/if}
      </div>
    </div>

    <!-- Files / Pages toggle. Same two-button pattern as the layout switch
         below; `aria-pressed` carries the state. -->
    <div class="flex items-center rounded border border-border bg-background">
      <Button
        variant={view === "files" ? "secondary" : "ghost"}
        size="xs"
        aria-pressed={view === "files"}
        onclick={() => (view = "files")}
      >
        <HugeiconsIcon icon={File01Icon} class="size-3" />
        Files
      </Button>
      <Button
        variant={view === "pages" ? "secondary" : "ghost"}
        size="xs"
        aria-pressed={view === "pages"}
        onclick={showPages}
      >
        <HugeiconsIcon icon={Layers01Icon} class="size-3" />
        Pages
      </Button>
    </div>

    <!-- Split / unified toggle. A real <ToggleGroup> would be overkill for two
         mutually-exclusive states; two buttons with `aria-pressed` is cleaner
         and avoids pulling in an extra shadcn component. -->
    <div class="flex items-center rounded border border-border bg-background" class:hidden={view !== "files"}>
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
  </div>

  <!-- Body ───────────────────────────────────────────────────────── -->
  {#if view === "pages"}
    <div class="min-h-0 flex-1">
      <PageDiffView onrefresh={requestPageDiff} />
    </div>
  {:else}
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
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="xs"
                        class="ml-auto"
                        onclick={() => onrestoreFile(entry.path)}
                        disabled={restoringPath !== null}
                      >
                        <HugeiconsIcon
                          icon={ArrowReloadHorizontalIcon}
                          class="mr-1 size-3 {restoringPath === entry.path ? 'animate-spin' : ''}"
                        />
                        Restore file
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content>Restore just this file</Tooltip.Content>
                </Tooltip.Root>
              {/if}
            </header>
            <DiffViewer {entry} {layout} />
          </section>
        {/each}
      </div>
    {/if}
  </ScrollArea.Root>
  {/if}
</div>
</Tooltip.Provider>

<style>
  /* Tailwind doesn't have arbitrary alpha-color classes baked in for our
     theme; encode the soft tints used by the status pill. */
  :global(.bg-emerald-500-15) { background-color: color-mix(in srgb, rgb(16 185 129) 15%, transparent); }
  :global(.bg-red-500-15) { background-color: color-mix(in srgb, rgb(239 68 68) 15%, transparent); }
</style>
