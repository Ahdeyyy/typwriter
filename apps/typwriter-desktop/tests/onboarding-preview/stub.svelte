<script lang="ts">
  import { settings } from '../../src/lib/stores/settings.svelte';

  let { title, value }: { title?: string; value?: string } = $props();
</script>

{#if title}
  <div class="border-b border-border px-4 py-2 text-sm">{title}</div>
{:else if value !== undefined}
  <pre data-tutorial-editor data-screen-reader-mode={settings.screenReaderMode} class="p-4">{value}</pre>
{:else}
  <div class="p-4 text-sm text-muted-foreground">Preview placeholder</div>
{/if}
