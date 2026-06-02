<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    BookOpen01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    RefreshIcon,
    CheckmarkCircle02Icon,
  } from "@hugeicons/core-free-icons";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { toast } from "svelte-sonner";

  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import OnboardingEditor from "$lib/components/editor/onboarding-editor.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";

  import { onboarding } from "$lib/stores/onboarding.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { logError } from "$lib/logger";

  const DOCS_URL = "https://typst.app/docs/";

  let entering = $state(true);

  onMount(async () => {
    // Preview listeners must be live before the scratch workspace starts
    // compiling (enter() triggers the first compile), otherwise the initial
    // page events are missed.
    try {
      await preview.init();
    } catch (err) {
      logError("onboarding: preview init failed:", err);
    }

    const result = await onboarding.enter();
    entering = false;
    result.mapErr((err) => {
      logError("onboarding: enter failed:", err);
      toast.error(`Couldn't start the tutorial: ${err}`);
    });
  });

  onDestroy(() => {
    preview.destroy();
    // Safety net: if the page is torn down without going through Finish/Skip,
    // still mark the tutorial as dismissed.
    if (onboarding.ready) {
      onboarding.skip().mapErr((err) => logError("onboarding: cleanup leave failed:", err));
    }
  });

  function handleNext() {
    if (onboarding.isLast) {
      onboarding.finish().mapErr((err) => {
        logError("onboarding: finish failed:", err);
        toast.error(`Couldn't close the tutorial: ${err}`);
      });
    } else {
      onboarding.next();
    }
  }

  function handleSkip() {
    onboarding.skip().mapErr((err) => {
      logError("onboarding: skip failed:", err);
      toast.error(`Couldn't close the tutorial: ${err}`);
    });
  }

  function handleOpenDocs() {
    openUrl(DOCS_URL).catch((err) => logError("onboarding: open docs failed:", err));
  }
</script>

<Tooltip.Provider>
<div class="flex h-full w-full flex-col">
  <Titlebar variant="minimal" title="Typwriter — Tutorial" />

  <main class="flex min-h-0 flex-1 flex-col">
    {#if entering}
      <div class="flex flex-1 items-center justify-center">
        <span class="text-sm text-muted-foreground">Preparing the tutorial…</span>
      </div>
    {:else}
      <Resizable.PaneGroup direction="horizontal" class="min-h-0 flex-1">
        <!-- ── Left column: explanation stacked over the editor ─────────── -->
        <Resizable.Pane defaultSize={50} minSize={32}>
          <Resizable.PaneGroup direction="vertical" class="h-full">
            <Resizable.Pane defaultSize={58} minSize={20}>
              <ScrollArea.Root class="h-full">
                <div class="flex flex-col gap-4 p-6">
              <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>Step {onboarding.stepIndex + 1} of {onboarding.steps.length}</span>
              </div>

              <h1 class="text-2xl font-semibold text-foreground">
                {onboarding.current.title}
              </h1>

              <p class="text-sm leading-relaxed text-muted-foreground">
                {onboarding.current.blurb}
              </p>

              {#if onboarding.current.bullets?.length}
                <ul class="flex flex-col gap-2">
                  {#each onboarding.current.bullets as bullet (bullet)}
                    <li class="flex items-start gap-2 text-sm text-foreground">
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <span>{bullet}</span>
                    </li>
                  {/each}
                </ul>
              {/if}

              {#if onboarding.current.tryThis}
                <div class="rounded-md border border-border bg-muted/40 p-3">
                  <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Try this
                  </p>
                  <p class="mt-1 text-sm text-foreground">{onboarding.current.tryThis}</p>
                </div>
              {/if}

              <div class="flex flex-wrap items-center gap-2 pt-1">
                <Button variant="outline" size="sm" class="gap-1.5" onclick={() => onboarding.resetExample()}>
                  <HugeiconsIcon icon={RefreshIcon} class="size-3.5" />
                  Reset example
                </Button>

                {#if onboarding.isLast}
                  <Button variant="outline" size="sm" class="gap-1.5" onclick={handleOpenDocs}>
                    <HugeiconsIcon icon={BookOpen01Icon} class="size-3.5" />
                    Open the docs
                  </Button>
                {/if}
              </div>
                </div>
              </ScrollArea.Root>
            </Resizable.Pane>

            <Resizable.Handle />

            <!-- Editor, directly below the explanation -->
            <Resizable.Pane defaultSize={42} minSize={25}>
              <div class="h-full border-t border-border">
                <OnboardingEditor
                  value={onboarding.activeContent}
                  seedVersion={onboarding.seedVersion}
                  onchange={(v) => onboarding.handleContentChange(v)}
                />
              </div>
            </Resizable.Pane>
          </Resizable.PaneGroup>
        </Resizable.Pane>

        <Resizable.Handle />

        <!-- ── Right column: the live preview ───────────────────────────── -->
        <Resizable.Pane defaultSize={50} minSize={30}>
          <div class="h-full border-l border-border bg-background">
            <Preview />
          </div>
        </Resizable.Pane>
      </Resizable.PaneGroup>

      <!-- ── Footer: skip · stepper · back/next ─────────────────────────── -->
      <footer class="flex h-14 shrink-0 items-center justify-between border-t border-border px-4">
        <Button variant="ghost" size="sm" class="gap-1.5 text-muted-foreground" onclick={handleSkip}>
          <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
          Skip tutorial
        </Button>

        <div class="flex items-center gap-1.5">
          {#each onboarding.steps as step, i (step.id)}
            <button
              class="size-2 rounded-full transition-colors {i === onboarding.stepIndex
                ? 'bg-foreground'
                : i < onboarding.stepIndex
                  ? 'bg-foreground/40'
                  : 'bg-border hover:bg-foreground/30'}"
              aria-label="Go to step {i + 1}: {step.title}"
              aria-current={i === onboarding.stepIndex ? "step" : undefined}
              onclick={() => onboarding.goTo(i)}
            ></button>
          {/each}
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="gap-1.5"
            disabled={onboarding.isFirst}
            onclick={() => onboarding.prev()}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} class="size-3.5" />
            Back
          </Button>

          <Button size="sm" class="gap-1.5" onclick={handleNext}>
            {#if onboarding.isLast}
              Start writing
              <HugeiconsIcon icon={CheckmarkCircle02Icon} class="size-3.5" />
            {:else}
              Next
              <HugeiconsIcon icon={ArrowRight01Icon} class="size-3.5" />
            {/if}
          </Button>
        </div>
      </footer>
    {/if}
  </main>
</div>
</Tooltip.Provider>
