<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Alert01Icon, MultiplicationSignCircleIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { basename } from "$lib/paths";
  import type { SerializedDiagnostic } from "$lib/types";

  interface Props {
    onclose?: () => void;
  }
  let { onclose }: Props = $props();

  // Group all diagnostics by file_path
  const grouped = $derived.by(() => {
    const map = new Map<string, { errors: SerializedDiagnostic[]; warnings: SerializedDiagnostic[] }>();

    for (const diag of diagnostics.errors) {
      const key = diag.file_path ?? "(unknown)";
      if (!map.has(key)) map.set(key, { errors: [], warnings: [] });
      map.get(key)!.errors.push(diag);
    }
    for (const diag of diagnostics.warnings) {
      const key = diag.file_path ?? "(unknown)";
      if (!map.has(key)) map.set(key, { errors: [], warnings: [] });
      map.get(key)!.warnings.push(diag);
    }

    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  const totalCount = $derived(diagnostics.errors.length + diagnostics.warnings.length);

  function lineColToOffset(content: string, line: number, col: number): number {
    const lines = content.split("\n");
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    return offset + Math.min(col, lines[line]?.length ?? 0);
  }

  async function jumpToDiagnostic(diag: SerializedDiagnostic) {
    if (!diag.file_path) return;

    const existingTab = editor.tabs.find((t) => t.relPath === diag.file_path);
    if (existingTab) {
      await editor.activateTab(existingTab.id);
      workspace.activeFilePath = existingTab.relPath;
    } else {
      const result = await workspace.openFile(diag.file_path);
      if (result.isErr()) return;
    }

    if (!diag.range) return;
    const tab = editor.activeTab;
    if (!tab) return;

    const offset = lineColToOffset(tab.content, diag.range.start_line, diag.range.start_col);
    editor.requestCursorJump(tab.id, offset);
  }
</script>

<div class="flex h-full flex-col border-t border-border bg-background">
  <!-- Header -->
  <div class="flex h-8 shrink-0 items-center justify-between border-b border-border px-3">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Problems</span>
      {#if totalCount > 0}
        <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
          {totalCount > 99 ? "99+" : totalCount}
        </span>
      {/if}
    </div>
    <Button
      variant="ghost"
      size="icon-xs"
      onclick={() => onclose ? onclose() : diagnostics.togglePane()}
      aria-label="Close problems pane"
    >
      <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
    </Button>
  </div>

  <!-- Body -->
  <ScrollArea.Root class="flex-1 min-h-0">
    {#if totalCount === 0}
      <p class="py-8 text-center text-sm text-muted-foreground select-none">No problems detected.</p>
    {:else}
      <div class="py-1">
        {#each grouped as [filePath, { errors, warnings }]}
          <!-- File group header -->
          <div class="flex items-center gap-2 px-3 py-1 sticky top-0 bg-background/95 backdrop-blur-sm z-10 min-w-0">
            <Tooltip.Root>
              <Tooltip.Trigger class="truncate text-xs font-medium text-foreground shrink-0 max-w-[40%]">{basename(filePath)}</Tooltip.Trigger>
              <Tooltip.Content>{filePath}</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger class="truncate text-[10px] text-muted-foreground min-w-0 flex-1 text-left">{filePath}</Tooltip.Trigger>
              <Tooltip.Content>{filePath}</Tooltip.Content>
            </Tooltip.Root>
            <span class="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">{errors.length + warnings.length}</span>
          </div>

          <!-- Errors -->
          {#each errors as diag}
            <button
              class="group flex w-full items-start gap-2 rounded-none px-6 py-1.5 text-left text-sm font-normal hover:bg-muted hover:text-foreground {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => void jumpToDiagnostic(diag)}
            >
              <HugeiconsIcon icon={MultiplicationSignCircleIcon} class="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <span class="break-words flex-1 min-w-0">{diag.message}</span>
                  {#if diag.range}
                    <span class="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold tabular-nums text-destructive group-hover:bg-accent-foreground/20 group-hover:text-accent-foreground">
                      {diag.range.start_line + 1}:{diag.range.start_col + 1}
                    </span>
                  {/if}
                </div>
                {#each diag.hints as hint}
                  <p class="text-xs italic text-muted-foreground group-hover:text-accent-foreground/80">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}

          <!-- Warnings -->
          {#each warnings as diag}
            <button
              class="group flex w-full items-start gap-2 rounded-none px-6 py-1.5 text-left text-sm font-normal hover:bg-muted hover:text-foreground {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => void jumpToDiagnostic(diag)}
            >
              <HugeiconsIcon icon={Alert01Icon} class="mt-0.5 size-3.5 shrink-0 text-yellow-500" />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <span class="break-words flex-1 min-w-0">{diag.message}</span>
                  {#if diag.range}
                    <span class="shrink-0 rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-mono font-semibold tabular-nums text-yellow-700 dark:text-yellow-400 group-hover:bg-accent-foreground/20 group-hover:text-accent-foreground">
                      {diag.range.start_line + 1}:{diag.range.start_col + 1}
                    </span>
                  {/if}
                </div>
                {#each diag.hints as hint}
                  <p class="text-xs italic text-muted-foreground group-hover:text-accent-foreground/80">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}
        {/each}
      </div>
    {/if}
  </ScrollArea.Root>
</div>
