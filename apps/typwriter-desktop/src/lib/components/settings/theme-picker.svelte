<script lang="ts">
  // Palette dropdown, one per mode (light / dark). The list is short enough not
  // to need a search box, but long enough that laying all the themes out inline
  // dominated the Appearance pane — hence a popover, like the font picker.
  import Button from "$lib/components/ui/button/button.svelte";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
  import { THEMES, type ThemeId } from "$lib/stores/settings.svelte";

  interface Props {
    /** Render the swatches with each theme's dark palette. */
    dark?: boolean;
    selected: ThemeId;
    onselect: (id: ThemeId) => void;
  }

  let { dark = false, selected, onselect }: Props = $props();

  let open = $state(false);

  const current = $derived(THEMES.find((t) => t.id === selected) ?? THEMES[0]);

  function select(id: ThemeId) {
    onselect(id);
    open = false;
  }
</script>

{#snippet swatch(id: ThemeId)}
  <div
    class="theme-swatch flex h-5 w-9 shrink-0 rounded border border-border"
    class:dark
    data-theme={id}
    aria-hidden="true"
  >
    <span class="flex-1 rounded-l" style="background: var(--background)"></span>
    <span class="flex-1" style="background: var(--primary)"></span>
    <span class="flex-1 rounded-r" style="background: var(--accent)"></span>
  </div>
{/snippet}

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <!-- h-auto: the swatch is nearly as tall as a `sm` button, so let the
           padding set the height rather than squeezing it into a fixed one. -->
      <Button
        {...props}
        variant="outline"
        size="sm"
        class="h-auto min-w-44 justify-between gap-3 px-3 py-2"
      >
        <span class="flex min-w-0 items-center gap-2">
          {@render swatch(current.id)}
          <span class="truncate">{current.label}</span>
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} class="size-4 shrink-0 opacity-60" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-72 p-1">
    <div class="max-h-72 overflow-y-auto">
      {#each THEMES as theme (theme.id)}
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground {selected ===
          theme.id
            ? 'bg-accent/60 text-accent-foreground'
            : ''}"
          onclick={() => select(theme.id)}
        >
          {@render swatch(theme.id)}
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{theme.label}</p>
            <p class="truncate text-xs text-muted-foreground">{theme.description}</p>
          </div>
          {#if selected === theme.id}
            <HugeiconsIcon icon={Tick02Icon} class="size-4 shrink-0" />
          {/if}
        </button>
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>

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
