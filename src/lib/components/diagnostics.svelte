<script lang="ts">
  import { onMount } from "svelte"
  import { listen } from "@tauri-apps/api/event"
  import type { DiagnosticResponse } from "../types"
  import { app } from "@/states.svelte"
  import * as Sheet from "$lib/components/ui/sheet"
  import { Button } from "./ui/button"
  import { Badge } from "./ui/badge"
  import { LucidePanelBottom } from "@lucide/svelte"
  import { ScrollArea } from "@/components/ui/scroll-area"

  let diagnostics = $state([] as Array<DiagnosticResponse>)

  onMount(() => {
    listen<DiagnosticResponse[]>("compilation-diagnostics", (event) => {
      diagnostics = event.payload

      app.newDiagnostics = diagnostics.length
    })
  })
</script>

<Sheet.Root bind:open={app.isDiagnosticsOpen}>
  <Sheet.Trigger>
    {#snippet child(props)}
      <Button
        onclick={() => (app.isDiagnosticsOpen = !app.isDiagnosticsOpen)}
        size="icon"
        class="size-7 relative"
        variant="ghost"
        {...props}
      >
        {#if app.newDiagnostics > 0}
          <Badge
            variant="destructive"
            class="absolute top-0 right-0 h-3 w-3 rounded-full p-1.5"
            >{app.newDiagnostics}</Badge
          >
        {/if}
        <LucidePanelBottom />
      </Button>
    {/snippet}
  </Sheet.Trigger>
  <Sheet.Content class="h-1/2" side="bottom">
    <Sheet.Header>
      <Sheet.Title>Diagnostic</Sheet.Title>
      <Sheet.Description>
        {#if diagnostics.length === 0}
          <div class="p-2">No issues found. Your document is clean!</div>
        {:else}
          <div class="p-2 border-t-1 border-black max-h-40 overflow-y-auto">
            <ScrollArea orientation="vertical">
              <ol class=" list-inside space-y-2">
                {#each diagnostics as diag (diag.message)}
                  {@render diagnostic(diag)}
                {/each}
              </ol>
            </ScrollArea>
          </div>
        {/if}
      </Sheet.Description>
    </Sheet.Header>
  </Sheet.Content>
</Sheet.Root>

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
