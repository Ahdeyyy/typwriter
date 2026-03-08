<script lang="ts">
  import "./layout.css";
  import "@fontsource-variable/inter/wght.css";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";

  const { children } = $props();

  $effect(() => {
    return installGlobalErrorLogging();
  });
</script>

<Toaster position="top-right" />

{@render children()}
