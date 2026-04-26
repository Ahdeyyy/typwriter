<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Alert01Icon } from "@hugeicons/core-free-icons";
  import { Button } from "$lib/components/ui/button/index.js";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";

  const diagCount = $derived(diagnostics.errors.length + diagnostics.warnings.length);
  const hasErrors = $derived(diagnostics.errors.length > 0);
  const hasWarnings = $derived(!hasErrors && diagnostics.warnings.length > 0);
</script>

<Button
  variant="ghost"
  size="icon-sm"
  title="Problems"
  aria-label="Problems"
  class="relative"
  onclick={() => diagnostics.togglePane()}
>
  <HugeiconsIcon icon={Alert01Icon}
    class="size-3.5 {hasErrors ? 'text-destructive' : hasWarnings ? 'text-yellow-500' : 'text-muted-foreground'}"
  />
  {#if diagCount > 0}
    <span
      class="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold leading-none text-destructive-foreground"
    >
      {diagCount > 9 ? "9+" : diagCount}
    </span>
  {/if}
</Button>
