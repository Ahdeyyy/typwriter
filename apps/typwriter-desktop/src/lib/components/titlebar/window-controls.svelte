<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    MinusSignIcon,
    MultiplicationSignIcon,
    MaximizeIcon,
    Square01Icon,
    MaximizeScreenIcon,
    SquareIcon,
    Copy01Icon,
    CopyIcon,
  } from "@hugeicons/core-free-icons";
  import { platform } from "$lib/utils/platform";
  import { logError } from "$lib/logger";
  import { Button } from "$lib/components/ui/button/index.js";

  const win = getCurrentWindow();
  let isMaximized = $state(false);
  let unlisten: (() => void) | null = null;

  async function refreshMaximized() {
    try {
      isMaximized = await win.isMaximized();
    } catch (err) {
      logError("titlebar: isMaximized failed:", err);
    }
  }

  onMount(async () => {
    await refreshMaximized();
    try {
      unlisten = await win.onResized(() => {
        refreshMaximized();
      });
    } catch (err) {
      logError("titlebar: onResized listener failed:", err);
    }
  });

  onDestroy(() => {
    unlisten?.();
  });

  function minimize() {
    win.minimize().catch((err) => logError("titlebar: minimize failed:", err));
  }
  function toggleMax() {
    win.toggleMaximize().catch((err) =>
      logError("titlebar: toggleMaximize failed:", err)
    );
  }
  function close() {
    win.close().catch((err) => logError("titlebar: close failed:", err));
  }
</script>

{#if platform === "macos"}
  <!-- Traffic-light style buttons (left side) -->
  <div class="group/traffic flex items-center gap-2 px-1">
    <Button
      aria-label="Close window"
      onclick={close}
      class="flex size-3 items-center justify-center rounded-full bg-[#ff5f57] text-black/60 ring-1 ring-inset ring-black/10 transition-colors hover:bg-[#ff5f57] [&_svg:not([class*='size-'])]:size-2"
    >
      <HugeiconsIcon
        icon={MultiplicationSignIcon}
        class="size-2 opacity-0 group-hover/traffic:opacity-100"
      />
    </Button>
    <Button
      aria-label="Minimize window"
      onclick={minimize}
      class="flex size-3 items-center justify-center rounded-full bg-[#febc2e] text-black/60 ring-1 ring-inset ring-black/10 transition-colors hover:bg-[#febc2e] [&_svg:not([class*='size-'])]:size-2"
    >
      <HugeiconsIcon
        icon={MinusSignIcon}
        class="size-2 opacity-0 group-hover/traffic:opacity-100"
      />
    </Button>
    <Button
      aria-label={isMaximized ? "Restore window" : "Maximize window"}
      onclick={toggleMax}
      class="flex size-3 items-center justify-center rounded-full bg-[#28c840] text-black/60 ring-1 ring-inset ring-black/10 transition-colors hover:bg-[#28c840] [&_svg:not([class*='size-'])]:size-2"
    >
      {#if !isMaximized}
        <HugeiconsIcon icon={SquareIcon} class="size-2" />
      {:else}
        <HugeiconsIcon icon={CopyIcon} class="size-2 rotate-180" />
      {/if}
    </Button>
  </div>
{:else}
  <!-- Windows / Linux style buttons (right side) -->
  <div class="flex h-full items-stretch">
    <Button
      variant="ghost"
      aria-label="Minimize window"
      onclick={minimize}
      class="flex h-full w-11 items-center justify-center rounded-none text-foreground/70 hover:bg-foreground/10 hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5"
    >
      <HugeiconsIcon icon={MinusSignIcon} class="size-3.5" />
    </Button>
    <Button
      variant="ghost"
      aria-label={isMaximized ? "Restore window" : "Maximize window"}
      onclick={toggleMax}
      class="flex h-full w-11 items-center justify-center rounded-none text-foreground/70 hover:bg-foreground/10 hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5"
    >
      {#if !isMaximized}
        <HugeiconsIcon icon={SquareIcon} class="size-3.5" />
      {:else}
        <HugeiconsIcon icon={CopyIcon} class="size-3.5 rotate-180" />
      {/if}
    </Button>
    <Button
      variant="ghost"
      aria-label="Close window"
      onclick={close}
      class="flex h-full w-11 items-center justify-center rounded-none text-foreground/70 hover:bg-destructive hover:text-destructive-foreground [&_svg:not([class*='size-'])]:size-3.5"
    >
      <HugeiconsIcon icon={MultiplicationSignIcon} class="size-3.5" />
    </Button>
  </div>
{/if}
