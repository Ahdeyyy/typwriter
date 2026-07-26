<script lang="ts">
  // Searchable font dropdown. The UI font (Appearance) and the editor font
  // (Editor) now live in different groups, so the picker is shared rather than
  // duplicated in each pane.
  //
  // Families arrive pre-grouped ("Typwriter fonts", "Installed on this
  // device", …) so bundled and system fonts stay distinguishable while the
  // search box filters across all of them.
  import Button from "$lib/components/ui/button/button.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import type { FontGroup } from "$lib/stores/system-fonts.svelte";

  interface Props {
    groups: readonly FontGroup[];
    value: string;
    onselect: (family: string) => void;
    /** CSS generic appended to the preview font stack. */
    fallback?: string;
    /** Show a "scanning" hint while the device font list is still loading. */
    loading?: boolean;
  }

  let { groups, value, onselect, fallback = "sans-serif", loading = false }: Props = $props();

  let open = $state(false);
  let filter = $state("");

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const matched = q
      ? groups.map((g) => ({
          label: g.label,
          families: g.families.filter((f) => f.toLowerCase().includes(q)),
        }))
      : groups;
    return matched.filter((g) => g.families.length > 0);
  });

  const isEmpty = $derived(filtered.length === 0);

  /** Quote a family name for a CSS `font-family` value — names can contain
   *  apostrophes ("Baskerville Old Face" is fine, but not all are). */
  function fontStack(family: string): string {
    const escaped = family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return `font-family: "${escaped}", ${fallback}`;
  }

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
        <span class="truncate" style={fontStack(value)}>{value}</span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-72 p-0">
    <div class="border-b border-border p-2">
      <Input placeholder="Search fonts…" bind:value={filter} class="h-8" />
    </div>
    <!-- No top padding: the sticky group header pins to the very top of the
         scroll area, flush under the search box. Any gap there would let rows
         scrolling out of view show above the header. -->
    <div class="max-h-72 overflow-y-auto pb-1">
      {#if isEmpty}
        <p class="px-3 py-2 text-xs text-muted-foreground">
          {loading ? "Looking for fonts on this device…" : "No matches."}
        </p>
      {:else}
        {#each filtered as group (group.label)}
          <p
            class="sticky top-0 z-10 border-b border-border/40 bg-popover/95 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur-sm"
          >
            {group.label}
          </p>
          {#each group.families as family (family)}
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground {value ===
              family
                ? 'bg-accent/60 text-accent-foreground'
                : ''}"
              onclick={() => select(family)}
              style={fontStack(family)}
            >
              <span class="truncate">{family}</span>
            </button>
          {/each}
        {/each}
        {#if loading}
          <p class="px-3 py-2 text-xs text-muted-foreground">
            Looking for fonts on this device…
          </p>
        {/if}
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
