<script lang="ts">
  // Per-block overflow menu: convert the block to another kind, duplicate it,
  // or delete it. Conversions are pure text rewrites of the block's span, so
  // they go through the same commit path as editing — nothing outside the
  // block is ever touched.

  import * as Drawer from "$lib/components/ui/drawer";
  import type { Block } from "$lib/blocks/segment";
  import { blocks } from "$lib/stores/blocks.svelte";
  import { CONVERSIONS, type ConversionId } from "$lib/blocks/convert";

  let { block, open = $bindable(false) }: { block: Block; open?: boolean } = $props();

  // A script block's source is code — re-prefixing its lines would corrupt it.
  const convertible = $derived(block.kind !== "script" && block.kind !== "raw");

  function apply(id: ConversionId) {
    open = false;
    blocks.convertBlock(block, id);
  }
</script>

<Drawer.Root bind:open>
  <Drawer.Content>
    <Drawer.Header>
      <Drawer.Title>Block</Drawer.Title>
    </Drawer.Header>
    <div class="max-h-[60vh] overflow-y-auto px-2 pb-6">
      {#if convertible}
        <p class="text-muted-foreground px-3 py-2 text-xs font-medium">Turn into</p>
        {#each CONVERSIONS as conversion (conversion.id)}
          <button
            class="active:bg-accent active:text-accent-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
            onclick={() => apply(conversion.id)}
          >
            <span class="text-muted-foreground w-8 shrink-0 font-mono text-sm">
              {conversion.glyph}
            </span>
            <span class="text-sm">{conversion.label}</span>
          </button>
        {/each}
        <div class="bg-border my-2 h-px"></div>
      {/if}
      <button
        class="active:bg-accent active:text-accent-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm"
        onclick={() => {
          open = false;
          blocks.duplicate(block);
        }}
      >
        <span class="text-muted-foreground w-8 shrink-0 font-mono text-sm">⧉</span>
        Duplicate block
      </button>
      <button
        class="text-destructive active:bg-destructive/10 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm"
        onclick={() => {
          open = false;
          blocks.remove(block);
        }}
      >
        <span class="w-8 shrink-0 font-mono text-sm">✕</span>
        Delete block
      </button>
    </div>
  </Drawer.Content>
</Drawer.Root>
