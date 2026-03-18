<script lang="ts">
  import { Warning, XCircle, X } from "phosphor-svelte";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import type { SerializedDiagnostic } from "$lib/types";

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

  function basename(path: string): string {
    return path.split(/[/\\]/).pop() ?? path;
  }

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
    <button
      class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      onclick={() => diagnostics.togglePane()}
      aria-label="Close problems pane"
    >
      <X class="size-3.5" />
    </button>
  </div>

  <!-- Body -->
  <ScrollArea.Root class="flex-1 min-h-0">
    {#if totalCount === 0}
      <p class="py-8 text-center text-sm text-muted-foreground select-none">No problems detected.</p>
    {:else}
      <div class="py-1">
        {#each grouped as [filePath, { errors, warnings }]}
          <!-- File group header -->
          <div class="flex items-center gap-2 px-3 py-1 text-xs font-medium text-foreground sticky top-0 bg-background/95 backdrop-blur-sm z-10">
            <span class="truncate" title={filePath}>{basename(filePath)}</span>
            <span class="shrink-0 text-muted-foreground">{filePath}</span>
            <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{errors.length + warnings.length}</span>
          </div>

          <!-- Errors -->
          {#each errors as diag}
            <button
              class="flex w-full items-start gap-2 px-6 py-1.5 text-left text-sm hover:bg-accent transition-colors {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => void jumpToDiagnostic(diag)}
            >
              <XCircle class="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div class="min-w-0 flex-1">
                <span class="break-words">{diag.message}</span>
                {#if diag.range}
                  <span class="ml-2 text-xs text-muted-foreground">
                    Line {diag.range.start_line + 1}, Col {diag.range.start_col + 1}
                  </span>
                {/if}
                {#each diag.hints as hint}
                  <p class="text-xs italic text-muted-foreground">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}

          <!-- Warnings -->
          {#each warnings as diag}
            <button
              class="flex w-full items-start gap-2 px-6 py-1.5 text-left text-sm hover:bg-accent transition-colors {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => void jumpToDiagnostic(diag)}
            >
              <Warning class="mt-0.5 size-3.5 shrink-0 text-yellow-500" />
              <div class="min-w-0 flex-1">
                <span class="break-words">{diag.message}</span>
                {#if diag.range}
                  <span class="ml-2 text-xs text-muted-foreground">
                    Line {diag.range.start_line + 1}, Col {diag.range.start_col + 1}
                  </span>
                {/if}
                {#each diag.hints as hint}
                  <p class="text-xs italic text-muted-foreground">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}
        {/each}
      </div>
    {/if}
  </ScrollArea.Root>
</div>
