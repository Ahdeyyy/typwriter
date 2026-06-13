<script lang="ts">
  import { undo, redo } from "@codemirror/commands";
  import { ArrowUUpLeft, ArrowUUpRight, Keyboard, Sparkle } from "phosphor-svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { completions } from "$lib/editor/completion-controller.svelte";
  import { insertOrWrap } from "$lib/editor/insert";

  // Symbols inserted/wrapped at the cursor. Order matters (most-used first).
  const SYMBOLS = [
    "#", "$", "*", "_", "`", "=", "-", "+", "/",
    "(", ")", "[", "]", "{", "}", '"', "<", ">", "@",
  ];

  function withView(fn: (v: import("@codemirror/view").EditorView) => void) {
    return (e: PointerEvent) => {
      e.preventDefault(); // keep editor focus / keyboard up
      if (editor.view) fn(editor.view);
    };
  }
</script>

<div class="bg-background flex h-10 shrink-0 items-stretch border-t">
  <!-- Manual completion trigger (replaces Ctrl+Space) -->
  <button
    class="active:bg-accent active:text-accent-foreground flex min-w-9 shrink-0 items-center justify-center border-r"
    aria-label="Suggestions"
    onpointerdown={withView((v) => completions.trigger(v))}
  >
    <Sparkle class="size-4" />
  </button>

  <!-- Scrollable symbol row -->
  <div class="flex flex-1 items-stretch gap-0.5 overflow-x-auto px-1" style="scrollbar-width: none;">
    {#each SYMBOLS as sym (sym)}
      <button
        class="active:bg-accent active:text-accent-foreground min-w-9 shrink-0 rounded-md font-mono text-sm"
        onpointerdown={withView((v) => insertOrWrap(v, sym))}
      >
        {sym}
      </button>
    {/each}
  </div>

  <!-- Pinned controls -->
  <div class="bg-background flex shrink-0 items-stretch gap-0.5 border-l px-1">
    <button
      class="active:bg-accent active:text-accent-foreground flex min-w-9 items-center justify-center rounded-md"
      aria-label="Undo"
      onpointerdown={withView((v) => undo(v))}
    >
      <ArrowUUpLeft class="size-4" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground flex min-w-9 items-center justify-center rounded-md"
      aria-label="Redo"
      onpointerdown={withView((v) => redo(v))}
    >
      <ArrowUUpRight class="size-4" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground flex min-w-9 items-center justify-center rounded-md"
      aria-label="Hide keyboard"
      onpointerdown={withView((v) => v.contentDOM.blur())}
    >
      <Keyboard class="size-4" />
    </button>
  </div>
</div>
