<script lang="ts">
  import * as Item from "$lib/components/ui/item/index.js"
  import { LucideOctagonAlert, LucideOctagonX } from "@lucide/svelte"
  import type { DiagnosticResponse } from "@/types"
  import { Button } from "../ui/button"

  let { severity, hints, location, message }: DiagnosticResponse = $props()
</script>

<Item.Root
  size="sm"
  class="border-l-4 {severity === 'Error'
    ? 'border-l-red-500'
    : 'border-l-amber-500'}"
>
  <Item.Media variant="icon">
    {#if severity === "Error"}
      <LucideOctagonX class="size-5 stroke-red-500" />
    {:else if severity === "Warning"}
      <LucideOctagonAlert class="size-5 stroke-amber-500" />
    {/if}
  </Item.Media>
  <Item.Content>
    <Item.Title
      >{severity}: {message}
      <br />
      {hints.length > 0 ? hints.join("\n") : null}
    </Item.Title>
  </Item.Content>
  <Item.Actions>
    <Button variant="ghost" size="sm"
      >[Ln{location.line}, Col{location.column}]</Button
    >
  </Item.Actions>
</Item.Root>
