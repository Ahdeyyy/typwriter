<script lang="ts">
  import { untrack } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    PanelLeftIcon,
    EyeIcon,
    ArrowExpandIcon,
    Link01Icon,
    LinkSquare01Icon,
  } from "@hugeicons/core-free-icons";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import WindowControls from "./window-controls.svelte";
  import { platform } from "$lib/utils/platform";

  type Props = {
    variant?: "workspace" | "minimal";
    title?: string;
    subtitle?: string;
    previewVisible?: boolean;
    onTogglePreview?: () => void;
  };

  let {
    variant = "minimal",
    title,
    subtitle,
    previewVisible = $bindable(true),
    onTogglePreview,
  }: Props = $props();

  const sidebarCtx = untrack(() => variant) === "workspace" ? Sidebar.useSidebar() : null;

  const isMac = platform === "macos";
</script>

<div
  data-tauri-drag-region
  class="relative flex h-9 w-full shrink-0 select-none items-center
         border-b border-border bg-background/80 backdrop-blur"
>
  <!-- ─── Left: macOS traffic lights → sidebar toggle ─────────────────── -->
  <div class="flex items-center gap-1 pl-2 pr-1">
    {#if isMac}
      <WindowControls />
    {/if}

    {#if variant === "workspace" && sidebarCtx}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              aria-label="Toggle sidebar"
              onclick={() => sidebarCtx.toggle()}
              class="flex size-7 items-center justify-center rounded-md
                     text-foreground/70 transition-colors
                     hover:bg-accent hover:text-accent-foreground
                     {sidebarCtx.open ? 'bg-accent/20 text-accent-foreground' : ''}"
            >
              <HugeiconsIcon icon={PanelLeftIcon} class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">Toggle sidebar</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  </div>

  <!-- ─── Center: workspace + opened folder/file name ─────────────────── -->
  <div
    data-tauri-drag-region
    class="pointer-events-none absolute left-1/2 top-1/2
           flex -translate-x-1/2 -translate-y-1/2 items-center gap-2
           text-xs text-foreground/80"
  >
    {#if title}
      <span class="font-medium">{title}</span>
    {/if}
    {#if title && subtitle}
      <span class="text-foreground/30">/</span>
    {/if}
    {#if subtitle}
      <span class="truncate max-w-[40vw] text-foreground/60">{subtitle}</span>
    {/if}
  </div>

  <!-- ─── Spacer fills remaining drag region ──────────────────────────── -->
  <div data-tauri-drag-region class="flex-1"></div>

  <!-- ─── Right: preview toggle + pop-out + (Win/Linux) controls ─────── -->
  <div class="flex h-full items-center gap-1 pl-1 {isMac ? 'pr-2' : ''}">
    {#if variant === "workspace"}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              aria-label={previewVisible ? "Hide preview" : "Show preview"}
              onclick={() => onTogglePreview?.()}
              class="flex size-7 items-center justify-center rounded-md
                     text-foreground/70 transition-colors
                     hover:bg-accent hover:text-accent-foreground
                     {previewVisible ? 'bg-accent/20 text-accent-foreground' : ''}"
            >
              <HugeiconsIcon icon={EyeIcon} class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">
          {previewVisible ? "Hide preview" : "Show preview"}
        </Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              aria-label="Pop out preview to a new window"
              disabled
              class="flex size-7 items-center justify-center rounded-md
                     text-foreground/40 transition-colors
                     disabled:cursor-not-allowed disabled:opacity-50"
            >
              <HugeiconsIcon icon={LinkSquare01Icon} class="size-4" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">Open preview in a new window(coming soon)</Tooltip.Content>
      </Tooltip.Root>

      <div class={[ isMac && "hidden","mx-1 h-4 w-px bg-border"]}></div>
    {/if}

    {#if !isMac}
      <WindowControls />
    {/if}
  </div>
</div>
