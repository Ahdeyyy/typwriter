<script lang="ts">
  // The Notion-style editing surface: the document as a vertical list of
  // blocks. It is a second view over the *same* buffer as the classic source
  // editor — the top-bar toggle switches between them — so save, compile,
  // diagnostics and export all keep working untouched.

  import { onMount } from "svelte";
  import { PlusSignIcon } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import type { Block } from "$lib/blocks/segment";
  import type { BlockTemplate } from "$lib/blocks/templates";
  import { blocks } from "$lib/stores/blocks.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import BlockView from "./block-view.svelte";
  import InsertMenu from "./insert-menu.svelte";

  let width = $state(0);

  /** Block the `+` affordance will insert after; null when the menu was opened
   *  by typing `/` inside a block (which replaces that block instead). */
  let insertAfter = $state<Block | null>(null);
  const menuOpen = $derived(insertAfter !== null || blocks.slashQuery !== null);

  onMount(() => {
    blocks.load(editor.text);
    void blocks.refresh();
    // Leaving the screen (back gesture, app backgrounded) commits first, so a
    // half-typed block is never stranded outside the buffer.
    return () => blocks.commitActive();
  });

  // Adopt a newly loaded file. `editor.text` also changes on our own commits,
  // which the doc comparison filters out.
  $effect(() => {
    const text = editor.text;
    if (editor.fileKind !== "text") return;
    if (text !== blocks.doc) {
      blocks.load(text);
      void blocks.refresh();
    }
  });

  function pick(template: BlockTemplate) {
    const after = insertAfter;
    insertAfter = null;
    if (after) blocks.insertAfter(after, template.text);
    else blocks.insertTemplate(template.text);
  }

  function closeMenu(open: boolean) {
    if (open) return;
    insertAfter = null;
    blocks.slashQuery = null;
  }
</script>

<div class="h-full overflow-y-auto overscroll-contain px-4 py-3">
  <!-- Width is measured on the padding-free column so a fragment's scale
       matches the space its crop is actually drawn in. -->
  <div bind:clientWidth={width} class="mx-auto w-full max-w-[820px]">
    {#each blocks.blocks as block (block.id)}
      {#if block.kind === "blank"}
        <!-- Blank blocks own the parbreak whitespace so the partition stays
             gap-free; they read as spacing rather than as a block. -->
        <div class="h-3"></div>
      {:else}
        <BlockView {block} {width} />
        <button
          class="group flex h-6 w-full items-center gap-2 opacity-40 active:opacity-100"
          aria-label="Insert block below"
          onclick={() => (insertAfter = block)}
        >
          <Icon icon={PlusSignIcon} class="text-muted-foreground size-3.5" />
          <span class="bg-border h-px flex-1"></span>
        </button>
      {/if}
    {/each}

    <!-- Room to scroll the last block clear of the toolbar / keyboard. -->
    <div class="h-[40vh]"></div>
  </div>
</div>

<InsertMenu open={menuOpen} onOpenChange={closeMenu} onpick={pick} />
