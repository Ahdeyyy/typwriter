<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import { THEMES, type ThemeId } from "$lib/stores/settings.svelte";

  interface Props {
    title: string;
    icon: IconSvgElement;
    /** Render the swatches with each theme's dark palette. */
    dark?: boolean;
    selected: ThemeId;
    onselect: (id: ThemeId) => void;
  }

  let { title, icon, dark = false, selected, onselect }: Props = $props();
</script>

<div class="rounded-md border border-border p-4">
  <div class="mb-3 flex items-center gap-2">
    <HugeiconsIcon {icon} class="size-4" />
    <h3 class="text-sm font-medium">{title}</h3>
  </div>
  <div class="flex flex-col gap-1.5">
    {#each THEMES as theme (theme.id)}
      <button
        type="button"
        class="group flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground {selected ===
        theme.id
          ? 'bg-accent text-accent-foreground border-border'
          : ''}"
        onclick={() => onselect(theme.id)}
      >
        <div
          class="theme-swatch flex h-6 w-10 shrink-0 rounded border border-border"
          class:dark
          data-theme={theme.id}
          aria-hidden="true"
        >
          <span class="flex-1 rounded-l" style="background: var(--background)"></span>
          <span class="flex-1" style="background: var(--primary)"></span>
          <span class="flex-1 rounded-r" style="background: var(--accent)"></span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{theme.label}</p>
          <p class="truncate text-xs text-muted-foreground">{theme.description}</p>
        </div>
      </button>
    {/each}
  </div>
</div>

<style>
  /* Theme swatches render the variables of a specific preset regardless of
     the document's active theme. They scope the CSS variables to the
     element itself, mirroring the rules in layout.css. */
  .theme-swatch[data-theme="default"] {
    --background: oklch(1 0 0);
    --primary: oklch(0.205 0 0);
    --accent: oklch(0.205 0 0);
  }
  .theme-swatch.dark[data-theme="default"] {
    --background: oklch(0.145 0 0);
    --primary: oklch(0.922 0 0);
    --accent: oklch(0.922 0 0);
  }
  /* Glass shares the default palette; the translucent background bar hints at
     the frosted surfaces this theme applies. */
  .theme-swatch[data-theme="glass"] {
    --background: oklch(1 0 0 / 0.5);
    --primary: oklch(0.205 0 0);
    --accent: oklch(0.205 0 0);
  }
  .theme-swatch.dark[data-theme="glass"] {
    --background: oklch(0.145 0 0 / 0.5);
    --primary: oklch(0.922 0 0);
    --accent: oklch(0.922 0 0);
  }
  .theme-swatch[data-theme="nord"] {
    --background: oklch(0.96 0.01 250);
    --primary: oklch(0.52 0.1 245);
    --accent: oklch(0.62 0.1 200);
  }
  .theme-swatch.dark[data-theme="nord"] {
    --background: oklch(0.3 0.025 252);
    --primary: oklch(0.75 0.08 245);
    --accent: oklch(0.72 0.1 200);
  }
  .theme-swatch[data-theme="dracula"] {
    --background: oklch(0.97 0.01 300);
    --primary: oklch(0.55 0.2 295);
    --accent: oklch(0.65 0.18 340);
  }
  .theme-swatch.dark[data-theme="dracula"] {
    --background: oklch(0.22 0.03 285);
    --primary: oklch(0.78 0.16 295);
    --accent: oklch(0.74 0.18 340);
  }
  .theme-swatch[data-theme="solarized"] {
    --background: oklch(0.96 0.02 85);
    --primary: oklch(0.55 0.13 220);
    --accent: oklch(0.6 0.13 145);
  }
  .theme-swatch.dark[data-theme="solarized"] {
    --background: oklch(0.27 0.02 200);
    --primary: oklch(0.7 0.12 220);
    --accent: oklch(0.72 0.13 145);
  }
  .theme-swatch[data-theme="catppuccin"] {
    --background: oklch(0.97 0.01 320);
    --primary: oklch(0.6 0.16 320);
    --accent: oklch(0.7 0.14 200);
  }
  .theme-swatch.dark[data-theme="catppuccin"] {
    --background: oklch(0.25 0.025 290);
    --primary: oklch(0.78 0.13 320);
    --accent: oklch(0.78 0.12 200);
  }
  .theme-swatch[data-theme="rose-pine"] {
    --background: oklch(0.96 0.01 30);
    --primary: oklch(0.58 0.13 10);
    --accent: oklch(0.62 0.1 190);
  }
  .theme-swatch.dark[data-theme="rose-pine"] {
    --background: oklch(0.26 0.02 320);
    --primary: oklch(0.76 0.11 10);
    --accent: oklch(0.74 0.1 190);
  }
  .theme-swatch[data-theme="gruvbox"] {
    --background: oklch(0.94 0.03 85);
    --primary: oklch(0.5 0.16 30);
    --accent: oklch(0.62 0.16 145);
  }
  .theme-swatch.dark[data-theme="gruvbox"] {
    --background: oklch(0.25 0.02 60);
    --primary: oklch(0.72 0.13 30);
    --accent: oklch(0.74 0.14 145);
  }
</style>
