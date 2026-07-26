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
    ListViewIcon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { completions } from "$lib/editor/completion-controller.svelte";
  import { insertOrWrap } from "$lib/editor/insert";
  import {
    toggleBold,
    toggleItalic,
    toggleRawInline,
    toggleMath,
    toggleBulletList,
    setHeadingLevel,
  } from "$lib/editor/commands";
  import type { EditorView } from "@codemirror/view";

  // Symbols inserted/wrapped at the cursor. Order matters (most-used first).
  const SYMBOLS = [
    "#", "$", "*", "_", "`", "=", "-", "+", "/",
    "(", ")", "[", "]", "{", "}", '"', "<", ">", "@",
  ];

  // Formatting quick commands — same buttons as before, but they now run the
  // desktop toolbar's toggle semantics (wrap ⇄ unwrap, prefix on ⇄ off)
  // instead of blind insertion. The commands re-focus via `focused(...)`.
  // Heading is handled separately (it opens the level picker).
  const COMMANDS: { icon: IconSvgElement; label: string; run: (v: EditorView) => void }[] = [
    { icon: TextBoldIcon, label: "Bold", run: focused(toggleBold) },
    { icon: TextItalicIcon, label: "Italic", run: focused(toggleItalic) },
    { icon: SourceCodeIcon, label: "Code", run: focused(toggleRawInline) },
    { icon: MathIcon, label: "Math", run: focused(toggleMath) },
    { icon: ListViewIcon, label: "List", run: focused(toggleBulletList) },
  ];

  // Heading-level picker (bottom sheet). Kept open without stealing focus from
  // the editor so the soft keyboard stays up while the user picks a level.
  let headingOpen = $state(false);

  function applyHeading(level: number) {
    if (editor.view) {
      setHeadingLevel(level)(editor.view);
      editor.view.focus();
    }
    headingOpen = false;
  }

  /** Run a command and keep focus (and the soft keyboard) on the editor. */
  function focused(cmd: (v: EditorView) => boolean) {
    return (v: EditorView) => {
      cmd(v);
      v.focus();
    };
  }

  // Tapping a button steals focus from the editor's contenteditable on
  // mousedown, which blurs it and dismisses the soft keyboard. Preventing the
  // mousedown default keeps focus (and the keyboard) on the editor — every
  // button carries onmousedown={keepEditorFocus}. It only fires on a tap; a
  // scroll cancels the synthetic mouse events, so horizontal panning is
  // unaffected. The "Hide keyboard" button still works since it blurs the
  // editor explicitly in its handler.
  function keepEditorFocus(e: MouseEvent) {
    e.preventDefault();
  }

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

<!-- Floating pill toolbar. Transparent wrapper keeps the pill off the edges and
     anchors the heading picker directly above it. -->
<div class="relative shrink-0 px-2 pb-2">
  {#if headingOpen}
    <!-- Outside-tap catcher. Keeps editor focus so the keyboard stays up. -->
    <button
      type="button"
      class="fixed inset-0 z-40"
      aria-label="Close heading picker"
      onmousedown={keepEditorFocus}
      onpointerup={(e) => { e.preventDefault(); headingOpen = false; }}
    ></button>

    <!-- Heading-level sheet, anchored above the toolbar. -->
    <div
      class="bg-popover text-popover-foreground absolute inset-x-2 bottom-full z-50 mb-2 overflow-hidden rounded-2xl border shadow-lg"
      onmousedown={keepEditorFocus}
      role="menu"
      tabindex="-1"
    >
      <div class="text-muted-foreground border-b px-4 py-2 text-xs font-medium">Heading level</div>
      {#each [1, 2, 3, 4, 5, 6] as level (level)}
        <button
          class="active:bg-accent active:text-accent-foreground flex w-full items-center gap-3 px-4 py-2.5 text-left"
          role="menuitem"
          onmousedown={keepEditorFocus}
          onpointerup={(e) => { e.preventDefault(); applyHeading(level); }}
        >
          <span class="flex w-6 shrink-0 justify-center font-semibold">H{level}</span>
          <span class="text-sm">Heading {level}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- The pill: fixed-height row so every control shares one vertical axis. -->
  <div class="bg-muted flex h-11 items-center gap-0.5 rounded-full border px-1 shadow-lg">
    <!-- Manual completion trigger (replaces Ctrl+Space) -->
    <button
      class="active:bg-accent active:text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-full"
      aria-label="Suggestions"
      onmousedown={keepEditorFocus}
      onpointerdown={withView((v) => completions.trigger(v))}
    >
      <Icon icon={AiMagicIcon} class="size-5" />
    </button>

    <!-- Scrollable commands + symbols -->
    <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" style="scrollbar-width: none; touch-action: pan-x;">
      {#each COMMANDS as cmd (cmd.label)}
        <button
          class="active:bg-accent active:text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-full"
          aria-label={cmd.label}
          onmousedown={keepEditorFocus}
          onpointerdown={tapDown}
          onpointerup={tapUp(cmd.run)}
        >
          <Icon icon={cmd.icon} class="size-5" />
        </button>
      {/each}
      <!-- Heading: opens the level picker instead of toggling directly. -->
      <button
        class="active:bg-accent active:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold"
        aria-label="Heading"
        aria-expanded={headingOpen}
        onmousedown={keepEditorFocus}
        onpointerup={(e) => { e.preventDefault(); headingOpen = !headingOpen; }}
      >
        H
      </button>
      <div class="bg-border mx-1 h-5 w-px shrink-0"></div>
      {#each SYMBOLS as sym (sym)}
        <button
          class="active:bg-accent active:text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-base"
          onmousedown={keepEditorFocus}
          onpointerdown={tapDown}
          onpointerup={tapUp((v) => insertOrWrap(v, sym))}
        >
          {sym}
        </button>
      {/each}
    </div>

    <!-- Pinned controls -->
    <div class="flex shrink-0 items-center gap-0.5">
      <button
        class="active:bg-accent active:text-accent-foreground flex size-9 items-center justify-center rounded-full"
        aria-label="Undo"
        onmousedown={keepEditorFocus}
        onpointerdown={withView((v) => undo(v))}
      >
        <Icon icon={UndoIcon} class="size-5" />
      </button>
      <button
        class="active:bg-accent active:text-accent-foreground flex size-9 items-center justify-center rounded-full"
        aria-label="Redo"
        onmousedown={keepEditorFocus}
        onpointerdown={withView((v) => redo(v))}
      >
        <Icon icon={RedoIcon} class="size-5" />
      </button>
      <button
        class="active:bg-accent active:text-accent-foreground flex size-9 items-center justify-center rounded-full"
        aria-label="Hide keyboard"
        onpointerdown={withView((v) => v.contentDOM.blur())}
      >
        <Icon icon={KeyboardIcon} class="size-5" />
      </button>
    </div>
  </div>
</div>
