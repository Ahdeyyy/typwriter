<script lang="ts">
  // The whole update flow in one primary button, pinned to the bottom of the
  // settings nav. Its label and icon *are* the progress UI — the store raises no
  // download toast — so every lifecycle state has to read clearly here.
  import { onMount } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Refresh01Icon,
    Download01Icon,
    Download04Icon,
    ReloadIcon,
    Loading03Icon,
  } from "@hugeicons/core-free-icons";
  import Button from "$lib/components/ui/button/button.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { settings } from "$lib/stores/settings.svelte";
  import { updater } from "$lib/stores/updater.svelte";

  // Settings is its own webview window, so the launch-time passive check in the
  // main window never reaches this store instance. Repeat it quietly on mount so
  // the button opens already offering a pending update instead of "Check for
  // updates" — same opt-out as the launch check, and guarded to one request.
  onMount(() => {
    if (settings.autoCheckUpdates) updater.checkPassive();
  });

  const label = $derived.by(() => {
    switch (updater.status) {
      case "checking":
        return "Checking…";
      case "available":
        return `Update to ${updater.displayVersion}`;
      case "downloading":
        return updater.progress === null ? "Updating…" : `Updating… ${updater.progress}%`;
      case "ready":
        return "Restart to update";
      case "installing":
        return "Installing…";
      default:
        return "Check for updates";
    }
  });

  const icon = $derived.by(() => {
    switch (updater.status) {
      case "available":
        return Download04Icon;
      case "downloading":
        return Download01Icon;
      case "ready":
        return ReloadIcon;
      case "installing":
        return Loading03Icon;
      default:
        return Refresh01Icon;
    }
  });

  const hint = $derived.by(() => {
    switch (updater.status) {
      case "available":
        return `${updater.displayVersion} is available to download.`;
      case "downloading":
        return `Downloading ${updater.displayVersion}…`;
      case "ready":
      case "installing":
        return `${updater.displayVersion} is downloaded — restart Typwriter to finish installing.`;
      default:
        return "Look for a newer release and install it.";
    }
  });

  const spinning = $derived(updater.status === "checking" || updater.status === "installing");
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <!-- h-9 pinned at every breakpoint: the nav items above have no md: size
           step, and the button size variants do. -->
      <Button
        {...props}
        variant="default"
        class="relative h-9 w-full justify-start gap-2.5 overflow-hidden px-3 text-sm md:h-9
               {updater.status === 'downloading' ? 'disabled:opacity-100' : ''}"
        onclick={() => updater.advance()}
        disabled={updater.busy}
      >
        {#if updater.status === "downloading" && updater.progress !== null}
          <!-- Progress fill behind the label; the label itself is the readout. -->
          <span
            class="bg-primary-foreground/25 absolute inset-y-0 left-0 transition-[width] duration-200"
            style="width: {updater.progress}%"
            aria-hidden="true"
          ></span>
        {/if}
        <!-- `relative` keeps the icon above the absolutely-positioned fill. -->
        <HugeiconsIcon {icon} class="relative size-4 shrink-0 {spinning ? 'animate-spin' : ''}" />
        <span class="relative truncate">{label}</span>
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="top">{hint}</Tooltip.Content>
</Tooltip.Root>
