<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    MinusSignIcon,
    MultiplicationSignIcon,
    SquareIcon,
    CopyIcon,
  } from "@hugeicons/core-free-icons";
  import { platform } from "$lib/stores/platform.svelte";
  import { logError } from "$lib/logger";
  import { Button } from "$lib/components/ui/button/index.js";

  const win = getCurrentWindow();
  let isMaximized = $state(false);

  const trafficLightClasses = [
    "flex size-3 shrink-0 appearance-none items-center justify-center rounded-full border-0 p-0",
    "text-black/60 ring-1 ring-inset ring-black/10",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  ];
  const trafficLightIconClasses = [
    "pointer-events-none size-2 shrink-0 opacity-0",
    "group-hover/traffic:opacity-100 group-focus-within/traffic:opacity-100",
  ].join(" ");

  async function refreshMaximized() {
    try {
      isMaximized = await win.isMaximized();
    } catch (err) {
      logError("titlebar: isMaximized failed:", err);
    }
  }

  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void refreshMaximized();
    win.onResized(() => { if (!disposed) void refreshMaximized(); })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((err) => logError("titlebar: onResized listener failed:", err));
    return () => {
      disposed = true;
      unlisten?.();
    };
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

{#if platform.isMac}
  <!-- Keep traffic lights independent of Button's responsive height/padding. -->
  <div class="group/traffic flex items-center gap-2 px-1">
    <button
      type="button"
      aria-label="Close window"
      onclick={close}
      class={[trafficLightClasses, "bg-[#ff5f57]"]}
    >
      <HugeiconsIcon
        icon={MultiplicationSignIcon}
        class={trafficLightIconClasses}
      />
    </button>
    <button
      type="button"
      aria-label="Minimize window"
      onclick={minimize}
      class={[trafficLightClasses, "bg-[#febc2e]"]}
    >
      <HugeiconsIcon
        icon={MinusSignIcon}
        class={trafficLightIconClasses}
      />
    </button>
    <button
      type="button"
      aria-label={isMaximized ? "Restore window" : "Maximize window"}
      onclick={toggleMax}
      class={[trafficLightClasses, "bg-[#28c840]"]}
    >
      {#if !isMaximized}
        <HugeiconsIcon
          icon={SquareIcon}
          class={trafficLightIconClasses}
        />
      {:else}
        <HugeiconsIcon
          icon={CopyIcon}
          class={`${trafficLightIconClasses} rotate-180`}
        />
      {/if}
    </button>
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
      class="flex h-full w-11 items-center justify-center rounded-none text-foreground/70 hover:bg-destructive hover:text-white dark:hover:bg-destructive dark:hover:text-white [&_svg:not([class*='size-'])]:size-3.5"
    >
      <HugeiconsIcon icon={MultiplicationSignIcon} class="size-3.5" />
    </Button>
  </div>
{/if}
