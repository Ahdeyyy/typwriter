<script lang="ts">
  import { Add01Icon, Search01Icon, ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
  import { toast } from "svelte-sonner";
  import Icon from "$lib/components/icon.svelte";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import ActionsMenu from "./actions-menu.svelte";

  let { onFormat }: { onFormat: () => void } = $props();

  // Number shown in the tab-switcher button (open tabs + a pending new tab).
  const tabCount = $derived(editor.tabs.length + (editor.newTabOpen ? 1 : 0));

  // Step to the previous/next open tab, wrapping. From an empty new tab (no
  // active file), forward lands on the first tab and back on the last.
  function cycleTab(delta: number) {
    const tabs = editor.tabs;
    const n = tabs.length;
    if (n === 0) return;
    const cur = editor.relPath ? tabs.indexOf(editor.relPath) : -1;
    const idx = cur < 0 ? (delta > 0 ? 0 : n - 1) : (cur + delta + n) % n;
    const rel = tabs[idx];
    if (rel && !editor.isActiveTab(rel)) {
      editor.loadFile(rel).mapErr((e) => toast.error(`Failed to open: ${e}`));
    }
  }
</script>

<!-- Floating pill dock (browser-style). Transparent wrapper keeps the pill off
     the screen edges and above the home-indicator safe area. -->
<div
  class="shrink-0 px-3 pt-1 pb-2"
  style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem);"
>
  <div class="bg-muted/70 flex h-14 items-center justify-between gap-1 rounded-full border px-1.5 shadow-lg backdrop-blur-md">
    <button
      class="text-foreground flex size-11 shrink-0 items-center justify-center rounded-full"
      aria-label="Previous tab"
      onclick={() => cycleTab(-1)}
    >
      <Icon icon={ArrowLeft01Icon} class="size-6" />
    </button>
    <button
      class="text-foreground flex size-11 shrink-0 items-center justify-center rounded-full"
      aria-label="Next tab"
      onclick={() => cycleTab(1)}
    >
      <Icon icon={ArrowRight01Icon} class="size-6" />
    </button>
    <button
      class="text-foreground flex size-11 shrink-0 items-center justify-center rounded-full"
      aria-label="Search files"
      onclick={() => app.openOverlay("quickswitcher")}
    >
      <Icon icon={Search01Icon} class="size-6" />
    </button>
    <button
      class="text-foreground flex size-11 shrink-0 items-center justify-center rounded-full"
      aria-label="New tab"
      onclick={() => editor.openNewTab()}
    >
      <Icon icon={Add01Icon} class="size-6" />
    </button>
    <button
      class="text-foreground flex size-11 shrink-0 items-center justify-center rounded-full"
      aria-label="Show tabs"
      onclick={() => app.openOverlay("tabswitcher")}
    >
      <span class="border-current flex h-6 min-w-6 items-center justify-center rounded-md border-2 px-1 text-xs font-semibold tabular-nums">
        {tabCount}
      </span>
    </button>

    <ActionsMenu {onFormat} />
  </div>
</div>
