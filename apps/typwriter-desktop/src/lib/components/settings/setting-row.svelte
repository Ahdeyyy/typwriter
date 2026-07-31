<script lang="ts">
  // The bordered row every individual setting sits in. Rows whose control is a
  // Switch pass `label` so clicking anywhere on the row toggles it; rows with a
  // slider or button render a plain div (a label would swallow drags/clicks).
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    title: string;
    /** Plain text, or a snippet when the copy needs markup (e.g. <code>). */
    description?: string | Snippet;
    /** Wrap the row in a <label> so the whole row activates the control. */
    label?: boolean;
    /** Grey the row out — for settings gated behind another toggle. */
    dimmed?: boolean;
    class?: string;
    /** The control on the right-hand side. */
    control?: Snippet;
    /** Extra content rendered beneath the description (status lines, etc.). */
    children?: Snippet;
  }

  let {
    title,
    description,
    label = false,
    dimmed = false,
    class: className,
    control,
    children,
  }: Props = $props();

  const rowClass = $derived(
    cn(
      "flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3",
      label && "cursor-pointer",
      dimmed && "opacity-50",
      className,
    ),
  );
</script>

{#snippet body()}
  <div class="min-w-0">
    <p class="text-sm font-medium">{title}</p>
    {#if typeof description === "string"}
      <p class="text-xs text-muted-foreground">{description}</p>
    {:else if description}
      <p class="text-xs text-muted-foreground">{@render description()}</p>
    {/if}
    {@render children?.()}
  </div>
  <div class="flex shrink-0 items-center gap-3">
    {@render control?.()}
  </div>
{/snippet}

{#if label}
  <label class={rowClass}>
    {@render body()}
  </label>
{:else}
  <div class={rowClass}>
    {@render body()}
  </div>
{/if}
