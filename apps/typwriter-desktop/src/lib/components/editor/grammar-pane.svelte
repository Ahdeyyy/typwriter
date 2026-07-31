<script lang="ts">
  // Grammar suggestions, grouped by file. A sibling of the diagnostics pane,
  // not part of it: compile errors and prose suggestions are different kinds
  // of problem and shouldn't compete for the same list.
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Cancel01Icon, RefreshIcon, TextCheckIcon } from "@hugeicons/core-free-icons";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { grammar, grammarSeverity } from "$lib/stores/grammar.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { basename } from "$lib/paths";
  import type { GrammarLint } from "$lib/types";
  import { toast } from "svelte-sonner";

  interface Props {
    onclose?: () => void;
  }
  let { onclose }: Props = $props();

  const activeTab = $derived(editor.activeTab);
  const activeReport = $derived(
    activeTab ? grammar.reportFor(activeTab.relPath) : null,
  );
  const activeFileChecked = $derived(
    activeTab ? !grammar.isFileDisabled(activeTab.relPath) : false,
  );

  const grouped = $derived.by(() =>
    Object.entries(grammar.reports)
      .filter(([, report]) => report.lints.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

  const totalCount = $derived(grammar.totalLints);

  async function jumpToLint(filePath: string, lint: GrammarLint) {
    const existing = editor.tabs.find((t) => t.relPath === filePath);
    if (existing) {
      await editor.activateTab(existing.id);
      workspace.activeFilePath = existing.relPath;
    } else {
      const result = await workspace.openFile(filePath);
      if (result.isErr()) return;
    }
    const tab = editor.activeTab;
    if (tab) editor.requestCursorJump(tab.id, lint.start);
  }

  function toggleActiveFile(enabled: boolean) {
    if (!activeTab) return;
    grammar
      .setFileEnabled(activeTab.relPath, enabled)
      .mapErr((err) => toast.error(`Could not update: ${err}`));
  }
</script>

<div class="flex h-full flex-col border-t border-border bg-background">
  <div
    class="flex h-8 shrink-0 items-center justify-between border-b border-border px-3"
  >
    <div class="flex items-center gap-2">
      <span
        class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        Grammar
      </span>
      {#if totalCount > 0}
        <span
          class="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-bold text-muted-foreground"
        >
          {totalCount > 99 ? "99+" : totalCount}
        </span>
      {/if}
      {#if grammar.checking.length > 0}
        <HugeiconsIcon
          icon={RefreshIcon}
          class="size-3 animate-spin text-muted-foreground"
        />
      {/if}
    </div>
    <Button
      variant="ghost"
      size="icon-xs"
      onclick={() => onclose?.()}
      aria-label="Close grammar pane"
    >
      <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
    </Button>
  </div>

  <!-- Per-file switch. Only meaningful for a file type the checker reads. -->
  {#if activeTab && activeReport && activeReport.format !== null}
    <label
      class="flex shrink-0 cursor-pointer items-center justify-between gap-3 border-b border-border px-3 py-2"
    >
      <span class="min-w-0">
        <span class="block truncate text-xs font-medium">
          Check {activeTab.name}
        </span>
        <span class="block text-[10px] text-muted-foreground">
          Read as {activeReport.formatLabel}
        </span>
      </span>
      <Switch
        checked={activeFileChecked}
        disabled={!grammar.config.enabled}
        onCheckedChange={toggleActiveFile}
      />
    </label>
  {/if}

  <ScrollArea.Root class="min-h-0 flex-1">
    {#if !grammar.config.enabled}
      <p class="select-none py-8 text-center text-sm text-muted-foreground">
        Grammar checking is turned off in Settings.
      </p>
    {:else if totalCount === 0}
      <div class="px-4 py-8 text-center">
        <HugeiconsIcon
          icon={TextCheckIcon}
          class="mx-auto size-5 text-muted-foreground"
        />
        <p class="mt-2 select-none text-sm text-muted-foreground">
          {#if activeTab && activeReport?.skipped === "file-disabled"}
            Checking is off for this file.
          {:else if activeTab && activeReport?.format === null}
            {activeTab.name} isn't a format the checker reads.
          {:else}
            Nothing to suggest.
          {/if}
        </p>
      </div>
    {:else}
      <div class="py-1">
        {#each grouped as [filePath, report] (filePath)}
          <div
            class="sticky top-0 z-10 flex min-w-0 items-center gap-2 bg-background/95 px-3 py-1 backdrop-blur-sm"
          >
            <Tooltip.Root>
              <Tooltip.Trigger
                class="max-w-[40%] shrink-0 truncate text-xs font-medium text-foreground"
              >
                {basename(filePath)}
              </Tooltip.Trigger>
              <Tooltip.Content>{filePath}</Tooltip.Content>
            </Tooltip.Root>
            <span
              class="min-w-0 flex-1 truncate text-left text-[10px] text-muted-foreground"
            >
              {filePath}
            </span>
            <span
              class="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground"
            >
              {report.lints.length}
            </span>
          </div>

          {#each report.lints as lint (`${lint.rule}:${lint.start}:${lint.end}`)}
            <button
              class="group flex w-full cursor-pointer items-start gap-2 rounded-none px-6 py-1.5 text-left text-sm font-normal hover:bg-muted hover:text-foreground"
              onclick={() => void jumpToLint(filePath, lint)}
            >
              <span
                class="mt-1.5 size-1.5 shrink-0 rounded-full {grammarSeverity(
                  lint,
                ) === 'problem'
                  ? 'bg-destructive'
                  : 'bg-blue-500'}"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <span class="min-w-0 flex-1 break-words">{lint.message}</span>
                  {#if lint.text}
                    <!-- Hover keeps the row on `bg-muted`, so the chip has to
                         stay in the foreground family: `accent-foreground` is
                         near-black in dark themes and vanishes against it. -->
                    <span
                      class="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground group-hover:bg-foreground/10 group-hover:text-foreground"
                    >
                      {lint.text.length > 16
                        ? `${lint.text.slice(0, 15)}…`
                        : lint.text}
                    </span>
                  {/if}
                </span>
                {#if lint.suggestions.length > 0}
                  <span
                    class="block text-xs italic text-muted-foreground group-hover:text-foreground/80"
                  >
                    {lint.suggestions
                      .slice(0, 3)
                      .map((s) =>
                        s.type === "remove" ? "remove" : `“${s.text}”`,
                      )
                      .join(", ")}
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        {/each}
      </div>
    {/if}
  </ScrollArea.Root>
</div>
