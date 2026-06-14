<script lang="ts">
  import { toast } from "svelte-sonner";
  import {
    Add01Icon,
    Cancel01Icon,
    File02Icon,
    Image01Icon,
    File01Icon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import { editor } from "$lib/stores/editor.svelte";

  function basename(rel: string): string {
    const parts = rel.split("/");
    return parts[parts.length - 1] ?? rel;
  }

  function iconFor(name: string): IconSvgElement {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return Image01Icon;
    if (name.endsWith(".typ")) return File02Icon;
    return File01Icon;
  }

  // Tap-vs-scroll so dragging the strip doesn't switch tabs.
  let startX = 0;
  let startY = 0;
  function down(e: PointerEvent) {
    startX = e.clientX;
    startY = e.clientY;
  }
  function selectTab(e: PointerEvent, rel: string) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) return;
    if (editor.isActiveTab(rel)) return;
    editor.loadFile(rel).mapErr((err) => toast.error(`Failed to open: ${err}`));
  }
</script>

<div
  class="bg-muted/40 flex h-10 shrink-0 items-stretch gap-1 overflow-x-auto border-b px-1.5 py-1.5"
  style="scrollbar-width: none; touch-action: pan-x;"
>
  {#each editor.tabs as rel (rel)}
    {@const active = editor.isActiveTab(rel)}
    <div
      class="group/tab flex shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors {active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground active:bg-background/60'}"
    >
      <button
        class="flex min-w-0 items-center gap-1.5"
        onpointerdown={down}
        onpointerup={(e) => selectTab(e, rel)}
      >
        <Icon icon={iconFor(rel)} class="size-3.5 shrink-0" />
        <span class="max-w-[16ch] truncate">{basename(rel)}</span>
      </button>
      <button
        class="hover:text-foreground -mr-1 flex size-5 items-center justify-center rounded-full"
        aria-label="Close tab"
        onclick={() => editor.closeTab(rel)}
      >
        <Icon icon={Cancel01Icon} class="size-3" />
      </button>
    </div>
  {/each}

  {#if editor.newTabOpen}
    <div class="bg-background text-foreground flex shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs shadow-sm">
      <Icon icon={Add01Icon} class="size-3.5" />
      <span>New tab</span>
    </div>
  {/if}

  <button
    class="text-muted-foreground hover:text-foreground active:bg-background/60 ml-0.5 flex size-7 shrink-0 items-center justify-center self-center rounded-full"
    aria-label="New tab"
    onclick={() => editor.openNewTab()}
  >
    <Icon icon={Add01Icon} class="size-4" />
  </button>
</div>
