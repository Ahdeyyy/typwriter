<script lang="ts">
  // Colour scheme cards: System / Light / Dark, each with a miniature mockup
  // of the app painted in the currently selected theme's palette (light values
  // for the Light card, dark values for the Dark card, a hard split for
  // System). Replaces the old segmented mode control.
  //
  // mode-watcher keeps its state per webview, so every change is also
  // broadcast over `app:mode-changed` for the other windows to apply.
  import { setMode, resetMode, userPrefersMode, systemPrefersMode } from "mode-watcher";
  import { app } from "@tauri-apps/api";
  import { cn } from "$lib/utils";
  import { emitAppModeChanged, type ModePreference } from "$lib/ipc/events";
  import { logError } from "$lib/logger";
  import { settings } from "$lib/stores/settings.svelte";
  import "./theme-preview.css";

  const OPTIONS: { id: ModePreference; label: string }[] = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];

  function select(next: ModePreference) {
    if (next === "system") {
      resetMode();
    } else {
      setMode(next);
    }
    // Tauri's window chrome follows the *resolved* mode. Derive it from `next`
    // rather than reading `mode.current` back — that hasn't settled yet in this
    // tick, so it would apply the previous mode's chrome.
    const resolved = next === "system" ? (systemPrefersMode.current ?? "light") : next;
    app.setTheme(resolved === "dark" ? "dark" : "light");
    emitAppModeChanged(next).mapErr((err) => logError("mode broadcast failed:", err));
  }
</script>

{#snippet mockup(dark: boolean)}
  <!-- The palette scope lives on this element: light values by default, dark
       values with the `dark` class (see theme-preview.css). -->
  <div
    class="theme-preview flex h-full w-full overflow-hidden"
    class:dark
    data-theme={settings.theme}
    style="background: var(--tp-underlay, transparent)"
    aria-hidden="true"
  >
    <!-- Sidebar strip -->
    <div
      class="flex w-[27%] shrink-0 flex-col gap-1 border-r p-1.5"
      style="background: var(--tp-surface); border-color: var(--tp-border)"
    >
      <span class="h-1.5 w-4/5 rounded-full" style="background: var(--tp-heading)"></span>
      <span class="h-1 w-full rounded-full" style="background: var(--tp-bar)"></span>
      <span class="h-1 w-2/3 rounded-full" style="background: var(--tp-bar)"></span>
    </div>
    <!-- Editor area -->
    <div class="relative min-w-0 flex-1 p-1.5" style="background: var(--tp-bg)">
      <!-- Floating panel, like the reference's mini outline card -->
      <div
        class="absolute right-1.5 top-1.5 flex w-[46%] flex-col gap-[3px] rounded-sm border p-1"
        style="background: var(--tp-card); border-color: var(--tp-border)"
      >
        <span class="flex items-center gap-1">
          <span class="size-1 rounded-full" style="background: var(--tp-dot)"></span>
          <span class="h-[3px] flex-1 rounded-full" style="background: var(--tp-bar)"></span>
        </span>
        <span class="flex items-center gap-1">
          <span class="size-1 rounded-full" style="background: var(--tp-heading)"></span>
          <span class="h-[3px] flex-1 rounded-full" style="background: var(--tp-bar)"></span>
        </span>
        <span class="flex items-center gap-1">
          <span class="size-1 rounded-full" style="background: var(--tp-dot)"></span>
          <span class="h-[3px] flex-1 rounded-full" style="background: var(--tp-bar)"></span>
        </span>
      </div>
      <!-- Heading + prose lines -->
      <span class="block h-1.5 w-1/2 rounded-full" style="background: var(--tp-heading)"></span>
      <span class="mt-1.5 block h-1 w-5/6 rounded-full" style="background: var(--tp-bar)"></span>
      <span class="mt-1 block h-1 w-2/3 rounded-full" style="background: var(--tp-bar)"></span>
      <!-- Input bar -->
      <div
        class="absolute inset-x-1.5 bottom-1.5 flex h-2.5 items-center justify-end rounded-full border pr-[3px]"
        style="background: var(--tp-card); border-color: var(--tp-border)"
      >
        <span class="size-1.5 rounded-full" style="background: var(--tp-dot)"></span>
      </div>
    </div>
  </div>
{/snippet}

<div class="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Color scheme">
  {#each OPTIONS as option (option.id)}
    {@const selected = userPrefersMode.current === option.id}
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={option.label}
      class="flex flex-col gap-2 rounded-lg border p-1.5 pb-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {selected
        ? 'border-primary ring-1 ring-primary'
        : 'border-border hover:border-muted-foreground/40'}"
      onclick={() => select(option.id)}
    >
      <div class="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-border">
        {#if option.id === "system"}
          <div class="absolute inset-0">{@render mockup(false)}</div>
          <!-- The system preview is one mockup split down the middle: the dark
               half is a second copy clipped to the right side. -->
          <div class="absolute inset-0" style="clip-path: inset(0 0 0 50%)">
            {@render mockup(true)}
          </div>
        {:else}
          <div class="absolute inset-0">
            {@render mockup(option.id === "dark")}
          </div>
        {/if}
      </div>
      <span
        class={cn(
          "text-center text-xs",
          selected ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {option.label}
      </span>
    </button>
  {/each}
</div>
