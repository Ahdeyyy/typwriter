<script lang="ts">
  // Searchable font dropdown. The UI font (Appearance) and the editor font
  // (Editor) now live in different groups, so the picker is shared rather than
  // duplicated in each pane.
  import Button from "$lib/components/ui/button/button.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";

  interface Props {
    families: readonly string[];
    value: string;
    onselect: (family: string) => void;
    /** CSS generic appended to the preview font stack. */
    fallback?: string;
  }

  let { families, value, onselect, fallback = "sans-serif" }: Props = $props();

  let open = $state(false);
  let filter = $state("");

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return families;
    return families.filter((f) => f.toLowerCase().includes(q));
  });

  function select(family: string) {
    onselect(family);
    open = false;
    filter = "";
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm" class="min-w-44 justify-between">
        <span class="truncate" style="font-family: '{value}', {fallback}">{value}</span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-72 p-0">
    <div class="border-b border-border p-2">
      <Input placeholder="Search fonts…" bind:value={filter} class="h-8" />
    </div>
    <div class="max-h-72 overflow-y-auto py-1">
      {#if filtered.length === 0}
        <p class="px-3 py-2 text-xs text-muted-foreground">No matches.</p>
      {:else}
        {#each filtered as family (family)}
          <button
            type="button"
            class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground {value ===
            family
              ? 'bg-accent/60 text-accent-foreground'
              : ''}"
            onclick={() => select(family)}
            style="font-family: '{family}', {fallback}"
          >
            <span class="truncate">{family}</span>
          </button>
        {/each}
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
