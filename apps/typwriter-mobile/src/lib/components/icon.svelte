<script lang="ts">
  // Thin wrapper over HugeiconsIcon so call sites stay terse and stroke weight
  // is themed in one place. Tailwind `size-*` classes still control dimensions
  // (CSS width/height overrides the svg's presentational attributes).
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { IconSvgElement } from "@hugeicons/svelte";

  let {
    icon,
    class: className = "",
    size,
    strokeWidth = 1.8,
    ...rest
  }: {
    icon: IconSvgElement;
    class?: string;
    size?: string | number;
    strokeWidth?: number;
    [key: string]: unknown;
  } = $props();
</script>

<HugeiconsIcon
  {icon}
  class={className}
  {strokeWidth}
  size={size ?? 24}
  {...rest}
/>
