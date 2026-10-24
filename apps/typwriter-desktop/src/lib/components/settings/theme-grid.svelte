<script lang="ts">
  // Card and circle buttons are siblings so each is keyboard accessible and
  // selecting one mode cannot also trigger the whole-card action.
  import { Moon, Sun } from "@lucide/svelte";
  import { cn } from "$lib/utils";
  import { settings, THEMES, type ThemeId } from "$lib/stores/settings.svelte";
  import "./theme-preview.css";
</script>

{#snippet circle(dark: boolean, themeId: ThemeId, label: string)}
  {@const selected = (dark ? settings.darkTheme : settings.lightTheme) === themeId}
  {@const mode = dark ? "dark" : "light"}
  <button
    type="button"
    aria-label={`${label} for ${mode} mode`}
    aria-pressed={selected}
    title={`Use ${label} for ${mode} mode`}
    class={cn(
      "pointer-events-auto relative z-10 rounded-full transition-shadow",
      "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary",
      selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:ring-2 hover:ring-muted-foreground/40 hover:ring-offset-2 hover:ring-offset-background",
    )}
    onclick={() => settings.setTheme(themeId, mode)}
  >
    <span
      class={cn("theme-preview block size-12 rounded-full", dark && "dark")}
      data-theme={themeId}
      style="background: radial-gradient(circle at 32% 32%, var(--tp-dot), var(--tp-heading) 70%, var(--tp-bg) 130%)"
      aria-hidden="true"
    >
    </span>
    <span
      class="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-border bg-background text-foreground"
      aria-hidden="true"
    >
      {#if dark}
        <Moon class="size-3" />
      {:else}
        <Sun class="size-3" />
      {/if}
    </span>
  </button>
{/snippet}

<p class="text-xs text-muted-foreground">
  Select a sun or moon circle for one mode, or a card to use its theme for both.
</p>
<div class="grid grid-cols-2 gap-3 sm:grid-cols-3" role="group" aria-label="Themes">
  {#each THEMES as theme (theme.id)}
    {@const selected = settings.lightTheme === theme.id && settings.darkTheme === theme.id}
    {@const partiallySelected = settings.lightTheme === theme.id || settings.darkTheme === theme.id}
    <div
      role="group"
      aria-label={theme.label}
      class="relative flex flex-col rounded-lg"
    >
      <button
        type="button"
        aria-label={`${theme.label} for both modes`}
        aria-pressed={selected}
        title={`${theme.description} Use for both modes.`}
        class={cn(
          "absolute inset-0 rounded-lg border transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground/40",
        )}
        onclick={() => settings.setTheme(theme.id)}
      ></button>
      <div class="pointer-events-none flex items-center justify-center gap-3 px-4 pt-5">
        {@render circle(false, theme.id, theme.label)}
        {@render circle(true, theme.id, theme.label)}
      </div>
      <span
        class={cn(
          "pointer-events-none mt-5 truncate px-4 pb-4 text-sm",
          partiallySelected ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {theme.label}
      </span>
    </div>
  {/each}
</div>
