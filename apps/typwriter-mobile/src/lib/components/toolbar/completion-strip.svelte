<script lang="ts">
  import {
    FunctionSquareIcon,
    CubeIcon,
    TextFontIcon,
    HashIcon,
    SourceCodeIcon,
    AtIcon,
    AiMagicIcon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { completions } from "$lib/editor/completion-controller.svelte";
  import type { StripItem } from "$lib/editor/completion-logic";

  // Match the desktop's mapBackendCompletionKind: lowercase substring match.
  function iconFor(kind: string): IconSvgElement {
    const k = kind.toLowerCase();
    if (k.includes("func")) return FunctionSquareIcon;
    if (k.includes("module") || k.includes("namespace")) return CubeIcon;
    if (k.includes("text") || k.includes("string")) return TextFontIcon;
    if (k.includes("constant")) return HashIcon;
    if (k.includes("type")) return SourceCodeIcon;
    if (k.includes("label") || k.includes("ref")) return AtIcon;
    return AiMagicIcon;
  }

  // Tap-vs-scroll: accepting on pointerdown blocked horizontal scrolling. Now we
  // record the pointerdown position and only accept on pointerup if the finger
  // barely moved (a tap); a drag scrolls the strip instead.
  let startX = 0;
  let startY = 0;
  const TAP_SLOP = 8;

  function onPointerDown(e: PointerEvent) {
    startX = e.clientX;
    startY = e.clientY;
  }

  function onPointerUp(e: PointerEvent, item: StripItem) {
    const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (moved > TAP_SLOP) return; // it was a scroll, not a tap
    e.preventDefault();
    if (editor.view) completions.accept(editor.view, item);
  }

  // Buttons steal focus from the editor's contenteditable on mousedown, which
  // blurs it and dismisses the soft keyboard. Preventing the mousedown default
  // keeps focus (and the keyboard) on the editor. Fires only on a tap — a scroll
  // cancels the synthetic mouse events, so it never interferes with panning.
  function keepEditorFocus(e: MouseEvent) {
    e.preventDefault();
  }
</script>

<!-- The row is always present (even with no items) so showing/clearing
     completions never resizes the editor viewport — a resize makes CodeMirror
     re-anchor its scroll, which reads as an unwanted jump when you tap a symbol
     that clears the suggestions. -->
<div
  class="bg-background flex h-10 shrink-0 items-stretch gap-1 overflow-x-auto border-t px-2"
  style="scrollbar-width: none; touch-action: pan-x;"
>
  {#each completions.items as item, i (item.label + i)}
    <button
      class="active:bg-accent active:text-accent-foreground flex shrink-0 items-center gap-1 rounded-full border px-3 font-mono text-sm whitespace-nowrap {i === 0 ? 'border-foreground/40' : ''}"
      onmousedown={keepEditorFocus}
      onpointerdown={onPointerDown}
      onpointerup={(e) => onPointerUp(e, item)}
    >
      <Icon icon={iconFor(item.kind)} class="size-3.5 shrink-0" />
      <span class="max-w-[24ch] truncate">{item.label}</span>
    </button>
  {/each}
</div>
