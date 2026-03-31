<script lang="ts">
  import "./layout.css";
  import "@fontsource-variable/inter/wght.css";
  import { onMount } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";
  import { updater } from "$lib/stores/updater.svelte";

  const { children } = $props();

  $effect(() => {
    return installGlobalErrorLogging();
  });

  onMount(() => {
    updater.checkPassive();
  });
</script>

<Toaster position="top-right" />
{@render children()}
