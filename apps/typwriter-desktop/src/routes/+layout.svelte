<script lang="ts">
  import "./layout.css";
  import "@fontsource-variable/inter/wght.css";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  const { children } = $props();
</script>

<Toaster position="top-right" />

{@render children()}
