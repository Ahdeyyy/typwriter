<script lang="ts">
  import { undo, redo } from "@codemirror/commands";
  import {
    UndoIcon,
    RedoIcon,
    KeyboardIcon,
    AiMagicIcon,
    TextBoldIcon,
    TextItalicIcon,
    SourceCodeIcon,
    MathIcon,
    Heading01Icon,
    ListViewIcon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { completions } from "$lib/editor/completion-controller.svelte";
  import { insertOrWrap, insertLinePrefix } from "$lib/editor/insert";
  import type { EditorView } from "@codemirror/view";

  // Symbols inserted/wrapped at the cursor. Order matters (most-used first).
  const SYMBOLS = [
    "#", "$", "*", "_", "`", "=", "-", "+", "/",
    "(", ")", "[", "]", "{", "}", '"', "<", ">", "@",
  ];

  // Obsidian-style formatting quick commands.
  const COMMANDS: { icon: IconSvgElement; label: string; run: (v: EditorView) => void }[] = [
    { icon: TextBoldIcon, label: "Bold", run: (v) => insertOrWrap(v, "*") },
    { icon: TextItalicIcon, label: "Italic", run: (v) => insertOrWrap(v, "_") },
    { icon: SourceCodeIcon, label: "Code", run: (v) => insertOrWrap(v, "`") },
    { icon: MathIcon, label: "Math", run: (v) => insertOrWrap(v, "$") },
    { icon: Heading01Icon, label: "Heading", run: (v) => insertLinePrefix(v, "= ") },
    { icon: ListViewIcon, label: "List", run: (v) => insertLinePrefix(v, "- ") },
  ];

  // Pinned buttons (outside the scroller): preventDefault on pointerdown keeps
  // editor focus / the keyboard up.
  function withView(fn: (v: EditorView) => void) {
    return (e: PointerEvent) => {
      e.preventDefault();
      if (editor.view) fn(editor.view);
    };
  }

  // Scroller buttons: tap-vs-scroll so the formatting row can pan horizontally.
  // The run helpers re-focus the editor themselves (insert.ts calls view.focus).
  let startX = 0;
  let startY = 0;
  function tapDown(e: PointerEvent) {
    startX = e.clientX;
    startY = e.clientY;
  }
  function tapUp(fn: (v: EditorView) => void) {
    return (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) return; // scrolled
      e.preventDefault();
      if (editor.view) fn(editor.view);
    };
  }
</script>

<div class="bg-background flex h-11 shrink-0 items-stretch border-t">
  <!-- Manual completion trigger (replaces Ctrl+Space) -->
  <button
    class="active:bg-accent active:text-accent-foreground flex min-w-10 shrink-0 items-center justify-center border-r"
    aria-label="Suggestions"
    onpointerdown={withView((v) => completions.trigger(v))}
  >
    <Icon icon={AiMagicIcon} class="size-5" />
  </button>

  <!-- Scrollable commands + symbols -->
  <div class="flex flex-1 items-stretch gap-0.5 overflow-x-auto px-1" style="scrollbar-width: none; touch-action: pan-x;">
    {#each COMMANDS as cmd (cmd.label)}
      <button
        class="active:bg-accent active:text-accent-foreground flex min-w-10 shrink-0 items-center justify-center rounded-lg"
        aria-label={cmd.label}
        onpointerdown={tapDown}
        onpointerup={tapUp(cmd.run)}
      >
        <Icon icon={cmd.icon} class="size-5" />
      </button>
    {/each}
    <div class="bg-border my-2 w-px shrink-0"></div>
    {#each SYMBOLS as sym (sym)}
      <button
        class="active:bg-accent active:text-accent-foreground min-w-10 shrink-0 rounded-lg font-mono text-base"
        onpointerdown={tapDown}
        onpointerup={tapUp((v) => insertOrWrap(v, sym))}
      >
        {sym}
      </button>
    {/each}
  </div>

  <!-- Pinned controls -->
  <div class="bg-background flex shrink-0 items-stretch gap-0.5 border-l px-1">
    <button
      class="active:bg-accent active:text-accent-foreground flex min-w-10 items-center justify-center rounded-lg"
      aria-label="Undo"
      onpointerdown={withView((v) => undo(v))}
    >
      <Icon icon={UndoIcon} class="size-5" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground flex min-w-10 items-center justify-center rounded-lg"
      aria-label="Redo"
      onpointerdown={withView((v) => redo(v))}
    >
      <Icon icon={RedoIcon} class="size-5" />
    </button>
    <button
      class="active:bg-accent active:text-accent-foreground flex min-w-10 items-center justify-center rounded-lg"
      aria-label="Hide keyboard"
      onpointerdown={withView((v) => v.contentDOM.blur())}
    >
      <Icon icon={KeyboardIcon} class="size-5" />
    </button>
  </div>
</div>
