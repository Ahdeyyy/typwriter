<script lang="ts">
  import type { DiagnosticResponse } from "../types"
  import DiagnosticItem from "./diagnostic/item.svelte"

  import { ScrollArea } from "@/components/ui/scroll-area"
  import { appContext } from "@/app-context.svelte"
</script>

<article class="h-full p-4">
  {#if !appContext.workspace || !appContext.workspace.document}
    <div class="p-4 text-sm text-muted-foreground">
      Open a document to see diagnostics.
    </div>
  {:else}
    <h3 class="text-center">Diagnostics</h3>
    <!-- declare const for better readability -->
    <!-- Change the order of the ifs, the each as an else for the case of the length being 0 -->
    {#if appContext.workspace.document.diagnostics.length === 0}
      <div class="p-2">No issues found. Your document is clean!</div>
    {:else}
      <ScrollArea orientation="vertical" class="min-h-0 mt-4 h-5/6 ">
        <div class="space-y-4">
          {#each appContext.workspace.document.diagnostics as diag, index (diag.message + index)}
            <DiagnosticItem {...diag} />
          {/each}
        </div>
      </ScrollArea>
    {/if}
  {/if}
</article>
