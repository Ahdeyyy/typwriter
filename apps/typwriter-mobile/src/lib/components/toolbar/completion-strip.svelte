<script lang="ts">
  import {
    Function as FunctionIcon,
    Cube,
    TextT,
    Hash,
    BracketsSquare,
    At,
    Sparkle,
  } from "phosphor-svelte";
  import type { Component } from "svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { completions } from "$lib/editor/completion-controller.svelte";
  import type { StripItem } from "$lib/editor/completion-logic";

  // Match the desktop's mapBackendCompletionKind: lowercase substring match.
  function iconFor(kind: string): Component {
    const k = kind.toLowerCase();
    if (k.includes("func")) return FunctionIcon;
    if (k.includes("module") || k.includes("namespace")) return Cube;
    if (k.includes("text") || k.includes("string")) return TextT;
    if (k.includes("constant")) return Hash;
    if (k.includes("type")) return BracketsSquare;
    if (k.includes("label") || k.includes("ref")) return At;
    return Sparkle;
  }

  function accept(e: PointerEvent, item: StripItem) {
    e.preventDefault(); // keep editor focus / keyboard up
    if (editor.view) completions.accept(editor.view, item);
  }
</script>

{#if completions.items.length}
  <div
    class="bg-background flex h-10 shrink-0 items-stretch gap-1 overflow-x-auto border-t px-2"
    style="scrollbar-width: none;"
  >
    {#each completions.items as item, i (item.label + i)}
      {@const Icon = iconFor(item.kind)}
      <button
        class="active:bg-accent active:text-accent-foreground flex shrink-0 items-center gap-1 rounded-md border px-3 font-mono text-sm whitespace-nowrap {i === 0 ? 'border-foreground/40' : ''}"
        onpointerdown={(e) => accept(e, item)}
      >
        <Icon class="size-3.5 shrink-0" />
        <span class="max-w-[24ch] truncate">{item.label}</span>
      </button>
    {/each}
  </div>
{/if}
