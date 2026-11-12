<script lang="ts">
  import { tick } from "svelte";
  import { toast } from "svelte-sonner";
  import {
    Add01Icon,
    Cancel01Icon,
    EyeIcon,
    File01Icon,
    File02Icon,
    Image01Icon,
    Search01Icon,
    SidebarLeft01Icon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { layout } from "$lib/stores/layout.svelte";
  import ActionsMenu from "./actions-menu.svelte";

  // Tablet editor header. With room to spare, the phone's centered title and
  // bottom dock fold into one row: every open tab is visible and one tap away,
  // and the dock's commands sit at the right end. The tab strip reuses the
  // dock's pill so the two form factors read as the same app.
  let { onPreview, onFormat }: { onPreview: () => void; onFormat: () => void } = $props();

  const tabCount = $derived(editor.tabs.length + (editor.newTabOpen ? 1 : 0));
  let strip = $state<HTMLElement | null>(null);

  // Fade whichever edge has tabs scrolled past it, so a clipped strip reads as
  // scrollable rather than as all there is.
  let fadeStart = $state(false);
  let fadeEnd = $state(false);
  function measureOverflow() {
    if (!strip) return;
    fadeStart = strip.scrollLeft > 1;
    fadeEnd = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
  }
  $effect(() => {
    if (!strip) return;
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(strip);
    return () => observer.disconnect();
  });
  const fadeMask = $derived(
    fadeStart || fadeEnd
      ? `linear-gradient(to right, ${fadeStart ? "transparent, black 2rem" : "black"}, ${fadeEnd ? "black calc(100% - 2rem), transparent" : "black"})`
      : undefined,
  );

  // Keep the active tab in view as tabs open (or the active one changes from
  // the tree, the switcher, or a preview jump).
  $effect(() => {
    void editor.relPath;
    void editor.newTabOpen;
    void editor.tabs.length;
    void tick().then(() => {
      // Tabs opening or closing change the overflow without resizing the strip.
      measureOverflow();
      strip
        ?.querySelector("[data-active]")
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  });

  function iconFor(name: string): IconSvgElement {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return Image01Icon;
    if (name.endsWith(".typ")) return File02Icon;
    return File01Icon;
  }

  function select(rel: string) {
    if (editor.isActiveTab(rel)) return;
    editor.loadFile(rel).mapErr((e) => toast.error(`Failed to open: ${e}`));
  }

  function close(rel: string) {
    editor.closeTab(rel).mapErr((e) => toast.error(`Failed to close: ${e}`));
  }

  function toggleFiles() {
    if (layout.wide) layout.sidebarOpen = !layout.sidebarOpen;
    else if (app.overlay === "filetree") app.closeOverlay();
    else app.openOverlay("filetree");
  }

  const tabClass = "flex h-10 max-w-60 shrink-0 items-center rounded-full transition-colors duration-150";
</script>

<div class="flex h-16 items-center gap-2 px-3">
  <Button
    variant={layout.sidebarDocked ? "ghost" : "secondary"}
    size="icon"
    aria-label="Toggle files"
    aria-pressed={layout.sidebarDocked}
    onclick={toggleFiles}
  >
    <Icon icon={SidebarLeft01Icon} />
  </Button>

  <!-- Tab strip -->
  <div class="bg-muted/70 flex h-12 min-w-0 flex-1 items-center gap-1 rounded-full border p-1">
    <div
      bind:this={strip}
      class="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
      style:mask-image={fadeMask}
      role="tablist"
      onscroll={measureOverflow}
    >
      {#each editor.tabs as rel (rel)}
        {@const active = editor.isActiveTab(rel)}
        <div
          class="{tabClass} {active
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground'}"
          data-active={active || undefined}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active}
            class="flex h-full min-w-0 items-center gap-2 rounded-full pr-1 pl-3.5 text-sm {active ? 'font-medium' : ''}"
            onclick={() => select(rel)}
          >
            <Icon icon={iconFor(rel)} class="size-[18px] shrink-0 {active ? 'text-foreground' : ''}" />
            <span class="truncate">{editor.tabLabel(rel)}</span>
          </button>
          <button
            type="button"
            class="hover:bg-foreground/10 mr-1 flex size-8 shrink-0 items-center justify-center rounded-full"
            aria-label="Close {editor.tabLabel(rel)}"
            onclick={() => close(rel)}
          >
            <Icon icon={Cancel01Icon} class="size-4" />
          </button>
        </div>
      {/each}

      {#if editor.newTabOpen}
        <div class="{tabClass} bg-background text-foreground gap-2 px-3.5 text-sm font-medium shadow-sm" data-active>
          <Icon icon={File01Icon} class="size-[18px] shrink-0" />
          <span class="truncate">New tab</span>
        </div>
      {/if}
    </div>

    <button
      type="button"
      class="text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      aria-label="New tab"
      onclick={() => editor.openNewTab()}
    >
      <Icon icon={Add01Icon} class="size-5" />
    </button>

    <!-- Spacer pushes the overview button to the strip's far end. -->
    <div class="flex-1"></div>

    <button
      type="button"
      class="text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
      aria-label="Show all tabs"
      onclick={() => app.openOverlay("tabswitcher")}
    >
      <span class="flex h-6 min-w-6 items-center justify-center rounded-md border-2 border-current px-1 text-xs font-semibold tabular-nums">
        {tabCount}
      </span>
    </button>
  </div>

  <div class="flex shrink-0 items-center gap-1">
    {#if compileStore.errors.length > 0}
      <Badge variant="destructive" onclick={() => app.openOverlay("diagnostics")}>
        {compileStore.errors.length}
      </Badge>
    {/if}
    <button
      type="button"
      class="text-foreground flex size-11 shrink-0 items-center justify-center rounded-full"
      aria-label="Search files"
      onclick={() => app.openOverlay("quickswitcher")}
    >
      <Icon icon={Search01Icon} class="size-6" />
    </button>
    <Button
      variant={layout.previewDocked ? "default" : "secondary"}
      size="icon"
      aria-label="Preview"
      aria-pressed={layout.previewDocked}
      onclick={onPreview}
    >
      <Icon icon={EyeIcon} />
    </Button>
    <ActionsMenu {onFormat} side="bottom" />
  </div>
</div>
