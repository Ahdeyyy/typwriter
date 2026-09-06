<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    PresentationBarChart01Icon,
  } from "@hugeicons/core-free-icons";
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { preview } from "$lib/stores/preview.svelte";
  import { previewController } from "$lib/components/sidebar/preview-controller.svelte";
  import { matchesCommand } from "$lib/keybindings";

  type Props = {
    onReturnToPresenter: () => void;
    onEndPresentation: () => void;
  };
  let { onReturnToPresenter, onEndPresentation }: Props = $props();

  const ctrl = previewController;

  const currentPageIndex = $derived(ctrl.visiblePage);
  const totalPages = $derived(preview.totalPages);
  const hasNextSlide = $derived(currentPageIndex + 1 < totalPages);

  function prevSlide() {
    ctrl.prevPage();
    if (preview.blackout) {
      preview.blackout = false;
    }
  }

  function nextSlide() {
    ctrl.nextPage();
    if (preview.blackout) {
      preview.blackout = false;
    }
  }

  function toggleBlackout() {
    preview.toggleBlackout();
  }

  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      onReturnToPresenter();
    } else if (matchesCommand(e, "preview.nextPage") || e.key === "PageDown") {
      e.preventDefault();
      nextSlide();
    } else if (matchesCommand(e, "preview.previousPage") || e.key === "PageUp") {
      e.preventDefault();
      prevSlide();
    } else if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      toggleBlackout();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Tooltip.Provider>
<div class="flex h-10 shrink-0 items-center justify-between border-b border-amber-500/20 bg-neutral-900/95 px-3 text-xs text-neutral-200 select-none shadow-sm backdrop-blur-sm z-20">
  <!-- Left: Live Indicator & Slide Navigation -->
  <div class="flex items-center gap-3">
    <div class="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-400">
      <span class="size-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
      {#if preview.rehearsalMode}
        <span>Rehearsal</span>
      {:else if preview.presentationDisplay}
        <span>Live on {preview.presentationDisplay.name ?? preview.presentationDisplay.id}</span>
      {:else}
        <span>Presenting</span>
      {/if}
    </div>

    {#if preview.blackout}
      <span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
        Blacked Out
      </span>
    {/if}

    <!-- Slide stepper -->
    <div class="flex items-center gap-1">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="size-6 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-30"
              disabled={currentPageIndex === 0}
              onclick={prevSlide}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} class="size-3.5 pointer-events-none" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Previous Slide</Tooltip.Content>
      </Tooltip.Root>

      <span class="font-mono text-xs font-semibold text-white px-1">
        Slide {currentPageIndex + 1} / {totalPages || 1}
      </span>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="size-6 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-30"
              disabled={!hasNextSlide}
              onclick={nextSlide}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} class="size-3.5 pointer-events-none" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Next Slide</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </div>

  <!-- Right: Controls & Return to Presenter View -->
  <div class="flex items-center gap-2">
    <!-- Blackout Toggle -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="sm"
            class="h-7 gap-1 px-2 text-xs {preview.blackout ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'}"
            onclick={toggleBlackout}
          >
            <svg class="size-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>{preview.blackout ? "Unblank" : "Blackout"}</span>
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>{preview.blackout ? "Resume slide display (B)" : "Blank audience screen (B)"}</Tooltip.Content>
    </Tooltip.Root>

    <!-- Return to Presenter View -->
    <Button
      variant="default"
      size="sm"
      class="h-7 gap-1.5 px-2.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
      onclick={onReturnToPresenter}
    >
      <HugeiconsIcon icon={PresentationBarChart01Icon} class="size-3.5" />
      <span>Presenter View</span>
      <kbd class="ml-0.5 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[10px]">Tab</kbd>
    </Button>

    <!-- End Presentation -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="size-7 text-red-400 hover:bg-red-950/50 hover:text-red-300"
            onclick={onEndPresentation}
          >
            <HugeiconsIcon icon={Cancel01Icon} class="size-3.5 pointer-events-none" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>End presentation</Tooltip.Content>
    </Tooltip.Root>
  </div>
</div>
</Tooltip.Provider>
