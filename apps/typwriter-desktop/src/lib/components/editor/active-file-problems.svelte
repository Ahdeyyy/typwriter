<script lang="ts">
  import { TriangleAlert, XCircle } from "@lucide/svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import type { SerializedDiagnostic } from "$lib/types";

  let dialogOpen = $state(false);

  const activeTab = $derived(editor.activeTab);
  const isVisible = $derived(activeTab?.viewMode === "text");

  const activeFileDiags = $derived.by(() => {
    const relPath = activeTab?.relPath ?? null;
    if (!relPath) {
      return {
        errors: [] as SerializedDiagnostic[],
        warnings: [] as SerializedDiagnostic[],
      };
    }
    return {
      errors: diagnostics.errors.filter((diag) => diag.file_path === relPath),
      warnings: diagnostics.warnings.filter((diag) => diag.file_path === relPath),
    };
  });

  const diagCount = $derived(
    activeFileDiags.errors.length + activeFileDiags.warnings.length,
  );
  const hasErrors = $derived(activeFileDiags.errors.length > 0);
  const hasWarnings = $derived(
    !hasErrors && activeFileDiags.warnings.length > 0,
  );

  function lineColToOffset(content: string, line: number, col: number): number {
    const lines = content.split("\n");
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    return offset + Math.min(col, lines[line]?.length ?? 0);
  }

  function jumpToDiagnostic(diag: SerializedDiagnostic) {
    const tab = editor.activeTab;
    if (!tab || !diag.range) {
      return;
    }
    const offset = lineColToOffset(
      tab.content,
      diag.range.start_line,
      diag.range.start_col,
    );
    editor.requestCursorJump(tab.id, offset);
    dialogOpen = false;
  }
</script>

{#if isVisible}
  <Dialog.Root bind:open={dialogOpen}>
    <Button
      variant="ghost"
      size="icon-sm"
      title="Problems"
      aria-label="Problems"
      class="relative"
      onclick={() => (dialogOpen = true)}
    >
      <TriangleAlert
        class="size-3.5 {hasErrors ? 'text-destructive' : hasWarnings ? 'text-yellow-500' : 'text-muted-foreground'}"
      />
      {#if diagCount > 0}
        <span
          class="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold leading-none text-destructive-foreground"
        >
          {diagCount > 9 ? "9+" : diagCount}
        </span>
      {/if}
    </Button>

    <Dialog.Content class="max-w-lg">
      <Dialog.Header>
        <Dialog.Title>Problems — {activeTab?.name ?? "No file open"}</Dialog.Title>
        <Dialog.Description>
          Errors and warnings in the current file.
        </Dialog.Description>
      </Dialog.Header>

      <ScrollArea.Root class="max-h-96">
        {#if diagCount === 0}
          <p class="py-6 text-center text-sm text-muted-foreground">
            No problems detected.
          </p>
        {:else}
          {#each activeFileDiags.errors as diag}
            <button
              class="flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => jumpToDiagnostic(diag)}
            >
              <XCircle class="mt-0.5 size-4 shrink-0 text-destructive" />
              <div class="min-w-0">
                <p class="font-medium">{diag.message}</p>
                {#if diag.range}
                  <p class="text-xs text-muted-foreground">
                    Line {diag.range.start_line + 1}, Col {diag.range.start_col + 1}
                  </p>
                {/if}
                {#each diag.hints as hint}
                  <p class="text-xs italic text-muted-foreground">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}

          {#each activeFileDiags.warnings as diag}
            <button
              class="flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent {diag.range ? 'cursor-pointer' : 'cursor-default'}"
              onclick={() => jumpToDiagnostic(diag)}
            >
              <TriangleAlert class="mt-0.5 size-4 shrink-0 text-yellow-500" />
              <div class="min-w-0">
                <p class="font-medium">{diag.message}</p>
                {#if diag.range}
                  <p class="text-xs text-muted-foreground">
                    Line {diag.range.start_line + 1}, Col {diag.range.start_col + 1}
                  </p>
                {/if}
                {#each diag.hints as hint}
                  <p class="text-xs italic text-muted-foreground">Hint: {hint}</p>
                {/each}
              </div>
            </button>
          {/each}
        {/if}
      </ScrollArea.Root>
    </Dialog.Content>
  </Dialog.Root>
{/if}
