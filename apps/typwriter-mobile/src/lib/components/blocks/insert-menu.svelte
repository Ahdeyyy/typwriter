<script lang="ts">
  // The insert ("slash") menu: pick a block kind to add after a given block.
  // Opened by the `+` affordance between blocks, or by typing `/` at the start
  // of an empty block.

  import * as Drawer from "$lib/components/ui/drawer";
  import { Input } from "$lib/components/ui/input";
  import { filterTemplates, type BlockTemplate } from "$lib/blocks/templates";

  let {
    open,
    onOpenChange,
    onpick,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onpick: (template: BlockTemplate) => void;
  } = $props();

  let query = $state("");
  const results = $derived(filterTemplates(query));

  // Each opening starts from a clean query.
  $effect(() => {
    if (!open) query = "";
  });
</script>

<Drawer.Root {open} {onOpenChange}>
  <Drawer.Content>
    <Drawer.Header>
      <Drawer.Title>Insert block</Drawer.Title>
    </Drawer.Header>
    <div class="px-4 pb-2">
      <Input bind:value={query} placeholder="Search block types" autocapitalize="off" />
    </div>
    <div class="max-h-[55vh] overflow-y-auto px-2 pb-6">
      {#each results as template (template.id)}
        <button
          class="active:bg-accent active:text-accent-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
          onclick={() => onpick(template)}
        >
          <span class="text-muted-foreground w-8 shrink-0 text-center font-mono text-sm">
            {template.glyph}
          </span>
          <span class="text-sm">{template.label}</span>
        </button>
      {:else}
        <p class="text-muted-foreground px-3 py-6 text-center text-sm">No matching block type.</p>
      {/each}
    </div>
  </Drawer.Content>
</Drawer.Root>
