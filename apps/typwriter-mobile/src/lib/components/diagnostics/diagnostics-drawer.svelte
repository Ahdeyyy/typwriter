<script lang="ts">
  import { tick } from "svelte";
  import { toast } from "svelte-sonner";
  import { XCircle, Warning } from "phosphor-svelte";
  import * as Drawer from "$lib/components/ui/drawer";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { app } from "$lib/stores/app.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import type { Diagnostic } from "$lib/ipc/types";

  const items = $derived([...compileStore.errors, ...compileStore.warnings]);

  function jumpInView(range: NonNullable<Diagnostic["range"]>) {
    const view = editor.view;
    if (!view) return;
    const doc = view.state.doc;
    const lineNo = Math.min(range.startLine + 1, doc.lines);
    const line = doc.line(lineNo);
    const pos = Math.min(line.from + range.startCol, line.to);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  async function goto(diag: Diagnostic) {
    app.closeOverlay();
    if (!diag.range) return;
    if (diag.filePath && diag.filePath !== editor.relPath) {
      const res = await editor.loadFile(diag.filePath);
      if (res.isErr()) {
        toast.error(`Failed to open ${diag.filePath}: ${res.error}`);
        return;
      }
      await tick(); // let the editor host re-seed CodeMirror
    }
    jumpInView(diag.range);
  }
</script>

<Drawer.Root
  open={app.overlay === "diagnostics"}
  onOpenChange={(o) => {
    if (!o) app.closeOverlay();
  }}
>
  <Drawer.Content class="max-h-[60vh]">
    <Drawer.Header>
      <Drawer.Title>
        Diagnostics
        {#if items.length}
          <span class="text-muted-foreground font-normal">({items.length})</span>
        {/if}
      </Drawer.Title>
    </Drawer.Header>

    <ScrollArea class="flex-1 px-2">
      {#if items.length === 0}
        <p class="text-muted-foreground p-4 text-center text-sm">No problems.</p>
      {:else}
        <div class="flex flex-col gap-1 pb-2">
          {#each items as diag, i (i)}
            <button
              class="active:bg-accent flex w-full flex-col gap-1 rounded-md p-2 text-left"
              onclick={() => goto(diag)}
            >
              <div class="flex items-start gap-2">
                {#if diag.severity === "error"}
                  <XCircle class="text-destructive mt-0.5 size-4 shrink-0" weight="fill" />
                {:else}
                  <Warning class="mt-0.5 size-4 shrink-0 text-amber-500" weight="fill" />
                {/if}
                <span class="min-w-0 flex-1 font-mono text-xs break-words">{diag.message}</span>
              </div>
              {#each diag.hints as hint}
                <p class="text-muted-foreground pl-6 text-xs">{hint}</p>
              {/each}
              {#if diag.filePath && diag.range}
                <p class="text-muted-foreground pl-6 text-xs">
                  {diag.filePath}:{diag.range.startLine + 1}
                </p>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </ScrollArea>

    {#if compileStore.stale}
      <p class="text-muted-foreground border-t p-2 text-center text-xs">based on last compile</p>
    {/if}
  </Drawer.Content>
</Drawer.Root>
