<script lang="ts">
  // Theme grid: one card per palette, each showing a light and a dark gradient
  // circle — the same palette serves both modes, the circles preview the two
  // faces of it. The selected card gets the primary ring, matching the colour
  // scheme cards above.
  import { cn } from "$lib/utils";
  import { settings, THEMES, type ThemeId } from "$lib/stores/settings.svelte";
  import "./theme-preview.css";

  function select(id: ThemeId) {
    settings.setTheme(id);
  }
</script>

{#snippet circle(dark: boolean, themeId: ThemeId)}
  <div class="theme-preview" class:dark data-theme={themeId} aria-hidden="true">
    <span
      class="block size-12 rounded-full"
      style="background: radial-gradient(circle at 32% 32%, var(--tp-dot), var(--tp-heading) 70%, var(--tp-bg) 130%)"
    >
    </span>
  </div>
{/snippet}

<div class="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
  {#each THEMES as theme (theme.id)}
    {@const selected = settings.theme === theme.id}
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={theme.label}
      title={theme.description}
      class="flex flex-col rounded-lg border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {selected
        ? 'border-primary ring-1 ring-primary'
        : 'border-border hover:border-muted-foreground/40'}"
      onclick={() => select(theme.id)}
    >
      <span class="flex items-center justify-center gap-3 py-1">
        {@render circle(false, theme.id)}
        {@render circle(true, theme.id)}
      </span>
      <span
        class={cn(
          "mt-4 truncate text-sm",
          selected ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {theme.label}
      </span>
    </button>
  {/each}
</div>
