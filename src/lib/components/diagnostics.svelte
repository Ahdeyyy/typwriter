<script lang="ts">
  import { onMount } from "svelte"
  import { listen } from "@tauri-apps/api/event"
  import type { DiagnosticResponse } from "../types"
  import { appState } from "@/states.svelte"
  import * as Sheet from "$lib/components/ui/sheet"
  import { Button } from "./ui/button"
  import { Badge } from "./ui/badge"
  import { LucidePanelBottom } from "@lucide/svelte"
  import { ScrollArea } from "@/components/ui/scroll-area"

  onMount(() => {
    listen<DiagnosticResponse[]>("source-diagnostics", (event) => {
      appState.diagnostics = event.payload

      appState.newDiagnostics = appState.diagnostics.length
    })
  })
</script>

<article class="h-1/2">
  <div>
    <h3>Diagnostic</h3>
    <div>
      {#if appState.diagnostics.length === 0}
        <div class="p-2">No issues found. Your document is clean!</div>
      {:else}
        <div class="p-2 border-t-1 border-black max-h-40 overflow-y-auto">
          <ScrollArea orientation="vertical">
            <ol class=" list-inside space-y-2">
              {#each appState.diagnostics as diag (diag.message)}
                {@render diagnostic(diag)}
              {/each}
            </ol>
          </ScrollArea>
        </div>
      {/if}
    </div>
  </div>
</article>

{#snippet diagnostic(diag: DiagnosticResponse)}
  <li>
    <span
      class={[
        "font-bold",
        diag.severity === "Error"
          ? "text-red-600 bg-red-100"
          : diag.severity === "Warning"
            ? "text-yellow-600 bg-yellow-100"
            : "text-blue-600 bg-blue-100",
        "px-2 py-1",
      ]}>{diag.severity.toUpperCase()}:</span
    >
    {diag.message} (Line: {diag.location.line} - {diag.location.end_line})
    (column: {diag.location.column} - {diag.location.end_column}) Hints: {#each diag.hints as hint}
      <div class="ml-4 text-sm text-gray-500 list-disc list-inside">{hint}</div>
    {/each}
  </li>
{/snippet}

<!-- <div class="col-span-2">
  {#if diagnostics.length > 0}
    <div class="p-2 border-t-1 border-black max-h-40 overflow-y-auto">
      <h2 class="font-bold mb-2">Diagnostics</h2>
      <ul class="list-item list-inside">
        {#each diagnostics as diag}
          <li class="mb-1">
            <strong>{diag.severity.toUpperCase()}:</strong>
            {diag.message} (Line: {diag.range.start}
            {diag.range.end})
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div> -->
