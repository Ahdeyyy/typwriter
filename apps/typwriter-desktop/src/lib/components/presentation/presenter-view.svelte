<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    FileCodeIcon,
    PresentationBarChart01Icon,
    RefreshIcon,
  } from "@hugeicons/core-free-icons";
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { preview } from "$lib/stores/preview.svelte";
  import { previewController } from "$lib/components/sidebar/preview-controller.svelte";
  import { buildPreviewUrl } from "$lib/preview-url";
  import { matchesCommand } from "$lib/keybindings";
  import WindowControls from "$lib/components/titlebar/window-controls.svelte";
  import { platform } from "$lib/stores/platform.svelte";

  type Props = {
    onToggleEditor: () => void;
    onEndPresentation: () => void;
  };
  let { onToggleEditor, onEndPresentation }: Props = $props();

  const isMac = $derived(platform.isMac);
  const ctrl = previewController;

  // ── Timers & Clock ──────────────────────────────────────────────────────────
  let elapsedSeconds = $state(0);
  let timerRunning = $state(true);
  let currentTime = $state("");
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let clockInterval: ReturnType<typeof setInterval> | null = null;

  function updateClock() {
    currentTime = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    if (hours > 0) {
      return `${hours}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  function toggleTimer() {
    timerRunning = !timerRunning;
  }

  function resetTimer() {
    elapsedSeconds = 0;
  }

  // ── Slides & Navigation ───────────────────────────────────────────────────
  let showAllSlidesModal = $state(false);
  let filmstripEl = $state<HTMLElement | null>(null);

  const currentPageIndex = $derived(ctrl.visiblePage);
  const totalPages = $derived(preview.totalPages);
  const hasNextSlide = $derived(currentPageIndex + 1 < totalPages);
  const currentFingerprint = $derived(preview.pages[currentPageIndex] ?? null);
  const nextFingerprint = $derived(hasNextSlide ? (preview.pages[currentPageIndex + 1] ?? null) : null);

  const slideAspectRatio = $derived.by(() => {
    if (ctrl.lastDims && ctrl.lastDims.h > 0 && ctrl.lastDims.w > 0) {
      return `${ctrl.lastDims.w} / ${ctrl.lastDims.h}`;
    }
    return "16 / 9";
  });

  function goToSlide(index: number) {
    ctrl.goToPage(index);
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

  function prevSlide() {
    ctrl.prevPage();
    if (preview.blackout) {
      preview.blackout = false;
    }
  }

  function toggleBlackout() {
    preview.toggleBlackout();
  }

  function toggleAllSlides() {
    showAllSlidesModal = !showAllSlidesModal;
  }

  // Auto-scroll the filmstrip when the active slide changes
  $effect(() => {
    const idx = currentPageIndex;
    if (filmstripEl) {
      untrack(() => {
        const thumb = filmstripEl?.querySelector(`[data-slide-index="${idx}"]`);
        thumb?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
    }
  });

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
    }

    if (showAllSlidesModal) {
      if (e.key === "Escape" || matchesCommand(e, "preview.toggleAllSlides")) {
        e.preventDefault();
        showAllSlidesModal = false;
        return;
      }
    }

    if (matchesCommand(e, "preview.exitPresentation")) {
      e.preventDefault();
      onEndPresentation();
    } else if (matchesCommand(e, "preview.nextPage") || e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      nextSlide();
    } else if (matchesCommand(e, "preview.previousPage") || e.key === "ArrowUp" || e.key === "Backspace") {
      e.preventDefault();
      prevSlide();
    } else if (matchesCommand(e, "preview.firstPage")) {
      e.preventDefault();
      goToSlide(0);
    } else if (matchesCommand(e, "preview.lastPage")) {
      e.preventDefault();
      goToSlide(totalPages - 1);
    } else if (matchesCommand(e, "preview.toggleBlackout")) {
      e.preventDefault();
      toggleBlackout();
    } else if (matchesCommand(e, "preview.toggleAllSlides")) {
      e.preventDefault();
      toggleAllSlides();
    } else if (matchesCommand(e, "preview.togglePresenterEditor")) {
      e.preventDefault();
      onToggleEditor();
    }
  }

  onMount(() => {
    updateClock();
    clockInterval = setInterval(updateClock, 1000);
    timerInterval = setInterval(() => {
      if (timerRunning) elapsedSeconds++;
    }, 1000);
  });

  onDestroy(() => {
    if (clockInterval) clearInterval(clockInterval);
    if (timerInterval) clearInterval(timerInterval);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<Tooltip.Provider>
<div class="flex h-full w-full flex-col overflow-hidden bg-neutral-950 text-neutral-100 select-none font-sans">
  <!-- ── Top Header Bar ───────────────────────────────────────────────────── -->
  <header
    data-tauri-drag-region
    class="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-3"
  >
    <!-- Left: Presentation status -->
    <div class="flex items-center gap-3">
      {#if isMac}
        <WindowControls />
      {/if}

      <div class="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
        <span class="size-2 rounded-full bg-emerald-500 animate-pulse"></span>
        {#if preview.rehearsalMode}
          <span>Rehearsal Mode (Practice)</span>
        {:else if preview.presentationDisplay}
          <span>Presenting on {preview.presentationDisplay.name ?? preview.presentationDisplay.id}</span>
        {:else}
          <span>Presenting</span>
        {/if}
      </div>

      {#if preview.blackout}
        <div class="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
          <span class="size-2 rounded-full bg-amber-400"></span>
          <span>Screen Blacked Out</span>
        </div>
      {/if}
    </div>

    <!-- Center: Clock & Elapsed Timer -->
    <div class="flex items-center gap-6">
      <!-- Wall Clock -->
      <div class="flex items-center gap-1.5 text-neutral-400">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span class="font-mono text-sm tracking-wider">{currentTime}</span>
      </div>

      <div class="h-4 w-px bg-neutral-800"></div>

      <!-- Presentation Stopwatch -->
      <div class="flex items-center gap-2">
        <span class="text-xs uppercase tracking-wider text-neutral-400">Elapsed</span>
        <span class="font-mono text-lg font-semibold tabular-nums text-white">
          {formatDuration(elapsedSeconds)}
        </span>

        <!-- Play/Pause -->
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon"
                class="size-7 rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white"
                onclick={toggleTimer}
              >
                {#if timerRunning}
                  <svg class="size-3.5 pointer-events-none" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                {:else}
                  <svg class="size-3.5 pointer-events-none" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                {/if}
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{timerRunning ? "Pause Timer" : "Resume Timer"}</Tooltip.Content>
        </Tooltip.Root>

        <!-- Reset -->
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon"
                class="size-7 rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white"
                onclick={resetTimer}
              >
                <HugeiconsIcon icon={RefreshIcon} class="size-3.5 pointer-events-none" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Reset Timer</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>

    <!-- Right: Quick toggle to editor & end presentation & window controls -->
    <div class="flex items-center gap-2">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="outline"
              size="sm"
              class="h-8 gap-1.5 border-neutral-700 bg-neutral-800/80 text-xs font-medium text-neutral-200 hover:bg-neutral-700 hover:text-white"
              onclick={onToggleEditor}
            >
              <HugeiconsIcon icon={FileCodeIcon} class="size-3.5 pointer-events-none" />
              <span>Code Editor</span>
              <kbd class="ml-1 rounded border border-neutral-600 bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">Tab</kbd>
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Temporarily switch to code editor while keeping slides live</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="destructive"
              size="sm"
              class="h-8 gap-1.5 text-xs font-medium"
              onclick={onEndPresentation}
            >
              <HugeiconsIcon icon={Cancel01Icon} class="size-3.5 pointer-events-none" />
              <span>End Show</span>
              <kbd class="ml-1 rounded border border-red-800 bg-red-950 px-1 py-0.5 text-[10px] text-red-200">Esc</kbd>
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Exit presentation mode</Tooltip.Content>
      </Tooltip.Root>

      {#if !isMac}
        <div class="mx-1 h-4 w-px bg-neutral-800"></div>
        <WindowControls />
      {/if}
    </div>
  </header>

  <!-- ── Main Stage (Current & Next Slide) ────────────────────────────────── -->
  <div class="flex min-h-0 flex-1 gap-4 p-4">
    <!-- Left: Current Slide (dominant) -->
    <section class="flex flex-[3] min-w-0 flex-col rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 shadow-xl">
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold tracking-wider text-neutral-400 uppercase">Current Slide</span>
          <span class="rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs font-medium text-neutral-200">
            {currentPageIndex + 1} / {totalPages || 1}
          </span>
        </div>
      </div>

      <!-- Slide Viewport -->
      <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-neutral-800/80 bg-black/60 p-2">
        {#if currentFingerprint}
          <img
            src={buildPreviewUrl(currentFingerprint)}
            alt="Current Slide {currentPageIndex + 1}"
            class="max-h-full max-w-full rounded shadow-2xl object-contain"
            draggable="false"
          />
        {:else}
          <div class="flex flex-col items-center justify-center text-neutral-500">
            <span class="size-6 animate-spin rounded-full border-2 border-neutral-600 border-t-transparent mb-2"></span>
            <span class="text-xs">Loading slide…</span>
          </div>
        {/if}

        <!-- Blackout overlay notice -->
        {#if preview.blackout}
          <div class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm p-6 text-center">
            <svg class="size-10 text-amber-400 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <h3 class="text-lg font-semibold text-white mb-1">Audience Display is Blacked Out</h3>
            <p class="text-xs text-neutral-400 max-w-sm mb-4">
              The audience sees a pure black screen. Click below or press <kbd class="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-xs text-neutral-300">B</kbd> to resume the slide view.
            </p>
            <Button
              size="sm"
              variant="outline"
              class="border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
              onclick={toggleBlackout}
            >
              Resume Slide View (B)
            </Button>
          </div>
        {/if}
      </div>

      <!-- Slide Controls underneath Current Slide -->
      <div class="mt-3 flex items-center justify-between border-t border-neutral-800/80 pt-3">
        <!-- Navigation Buttons -->
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-9 gap-1.5 border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
            disabled={currentPageIndex === 0}
            onclick={prevSlide}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} class="size-4" />
            <span>Previous</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            class="h-9 gap-1.5 font-medium disabled:opacity-40"
            disabled={!hasNextSlide}
            onclick={nextSlide}
          >
            <span>Next</span>
            <HugeiconsIcon icon={ArrowRight01Icon} class="size-4" />
          </Button>
        </div>

        <!-- Utilities: Blackout & See All Slides -->
        <div class="flex items-center gap-2">
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={preview.blackout ? "secondary" : "outline"}
                  size="sm"
                  class="h-9 gap-1.5 border-neutral-700 {preview.blackout ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}"
                  onclick={toggleBlackout}
                >
                  <svg class="size-4 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span>{preview.blackout ? "Unblank Screen" : "Black Screen"}</span>
                  <kbd class="ml-1 rounded border border-neutral-700 bg-neutral-800/80 px-1 py-0.2 text-[10px] text-neutral-400">B</kbd>
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{preview.blackout ? "Resume slide display (B)" : "Blank the audience display to pure black (B)"}</Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="outline"
                  size="sm"
                  class="h-9 gap-1.5 border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
                  onclick={toggleAllSlides}
                >
                  <svg class="size-4 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                  </svg>
                  <span>All Slides</span>
                  <kbd class="ml-1 rounded border border-neutral-700 bg-neutral-800/80 px-1 py-0.2 text-[10px] text-neutral-400">G</kbd>
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>Open full slide grid picker (G)</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>
    </section>

    <!-- Right: Next Slide Preview -->
    <section class="flex flex-[2] min-w-0 flex-col rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 shadow-xl">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-xs font-semibold tracking-wider text-neutral-400 uppercase">Next Slide</span>
        {#if hasNextSlide}
          <span class="rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs font-medium text-neutral-400">
            Slide {currentPageIndex + 2}
          </span>
        {/if}
      </div>

      <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-neutral-800/80 bg-black/40 p-2">
        {#if hasNextSlide && nextFingerprint}
          <img
            src={buildPreviewUrl(nextFingerprint)}
            alt="Next Slide {currentPageIndex + 2}"
            class="max-h-full max-w-full rounded opacity-90 shadow-md object-contain"
            draggable="false"
          />
        {:else if hasNextSlide}
          <div class="flex flex-col items-center justify-center text-neutral-500">
            <span class="size-5 animate-spin rounded-full border-2 border-neutral-600 border-t-transparent mb-2"></span>
            <span class="text-xs">Preparing next slide…</span>
          </div>
        {:else}
          <div class="flex flex-col items-center justify-center text-neutral-500 p-6 text-center">
            <HugeiconsIcon icon={PresentationBarChart01Icon} class="size-8 mb-2 opacity-50" />
            <p class="text-sm font-medium text-neutral-300">End of Presentation</p>
            <p class="text-xs text-neutral-500 mt-1">This is the final slide of your document.</p>
          </div>
        {/if}
      </div>
    </section>
  </div>

  <!-- ── Bottom Slide Filmstrip ───────────────────────────────────────────── -->
  <footer class="flex h-32 shrink-0 flex-col border-t border-neutral-800 bg-neutral-900/60 px-4 py-2">
    <div class="mb-1 flex items-center justify-between">
      <span class="text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
        Slide Navigator ({totalPages} slides)
      </span>
      <span class="text-[11px] text-neutral-500">
        Click any slide to jump immediately
      </span>
    </div>

    <!-- Scrollable Filmstrip -->
    <div
      bind:this={filmstripEl}
      class="flex flex-1 items-center gap-3.5 overflow-x-auto overflow-y-hidden pt-2.5 pb-2 px-2 scrollbar-thin scrollbar-thumb-neutral-700"
    >
      {#each preview.pages as fp, idx (idx)}
        <button
          type="button"
          data-slide-index={idx}
          style="aspect-ratio: {slideAspectRatio};"
          class="group relative flex h-[calc(100%-6px)] shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border text-left transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-1.5 hover:z-20 hover:shadow-lg active:scale-[0.97] {idx === currentPageIndex ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-neutral-950 shadow-md z-10' : 'border-neutral-800 hover:border-neutral-500 bg-neutral-900'}"
          onclick={() => goToSlide(idx)}
        >
          {#if fp}
            <img
              src={buildPreviewUrl(fp)}
              alt="Slide {idx + 1}"
              class="h-full w-full object-contain block pointer-events-none"
              draggable="false"
            />
          {:else}
            <div class="flex h-full w-full items-center justify-center bg-neutral-900 text-neutral-600">
              <span class="text-[10px]">…</span>
            </div>
          {/if}

          <!-- Slide number tag -->
          <div class="absolute bottom-1.5 left-1.5 z-10 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums tracking-tight {idx === currentPageIndex ? 'bg-primary text-primary-foreground shadow-xs' : 'bg-neutral-950/90 text-neutral-200 border border-neutral-700/80 shadow-xs backdrop-blur-xs'}">
            {idx + 1}
          </div>
        </button>
      {/each}
    </div>
  </footer>
</div>

<!-- ── Full-Screen "See All Slides" Grid Modal ────────────────────────────── -->
{#if showAllSlidesModal}
  <div
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    class="fixed inset-0 z-50 flex flex-col bg-neutral-950/95 backdrop-blur-md p-6 animate-in fade-in duration-150"
    onkeydown={(e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        showAllSlidesModal = false;
      }
    }}
  >
    <!-- Modal Header -->
    <div class="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
      <div>
        <h2 class="text-lg font-semibold text-white">All Slides</h2>
        <p class="text-xs text-neutral-400">Select any slide to jump to it directly</p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        class="size-8 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
        onclick={() => (showAllSlidesModal = false)}
      >
        <HugeiconsIcon icon={Cancel01Icon} class="size-4" />
      </Button>
    </div>

    <!-- Grid of Slides (Deck Cascade with always-visible numbers and hover lift) -->
    <div class="grid flex-1 grid-cols-2 [grid-auto-rows:48px] gap-x-4 gap-y-0 overflow-y-auto px-6 pt-10 pb-20 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 scrollbar-thin scrollbar-thumb-neutral-700">
      {#each preview.pages as fp, idx (idx)}
        <button
          type="button"
          style="aspect-ratio: {slideAspectRatio};"
          class="group relative flex flex-col items-center justify-center overflow-hidden rounded-lg border text-left transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-8 hover:z-30 hover:shadow-2xl hover:shadow-black/70 hover:will-change-transform active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 focus-visible:-translate-y-8 focus-visible:z-30 {idx === currentPageIndex ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-neutral-950 shadow-xl' : 'border-neutral-800 hover:border-neutral-400 bg-neutral-900/90 shadow-md'}"
          onclick={() => {
            goToSlide(idx);
            showAllSlidesModal = false;
          }}
        >
          {#if fp}
            <img
              src={buildPreviewUrl(fp)}
              alt="Slide {idx + 1}"
              class="h-full w-full object-contain block pointer-events-none"
              draggable="false"
            />
          {:else}
            <div class="flex h-full w-full items-center justify-center text-neutral-600">
              <span class="text-xs">Slide {idx + 1}</span>
            </div>
          {/if}

          <!-- Number Badge (always visible at top-left) -->
          <span
            class="absolute top-2 left-2 z-10 flex items-center justify-center rounded-md px-2 py-0.5 font-mono text-xs font-bold tabular-nums tracking-tight shadow-sm backdrop-blur-sm transition-colors duration-150 {idx === currentPageIndex ? 'bg-primary text-primary-foreground border border-primary' : 'bg-neutral-950/90 text-white border border-neutral-700/80 group-hover:border-neutral-500'}"
          >
            {idx + 1}
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}
</Tooltip.Provider>
