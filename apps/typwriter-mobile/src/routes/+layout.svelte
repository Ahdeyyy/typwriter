<script lang="ts">
  import "./layout.css";
  import { ModeWatcher } from "mode-watcher";
  import { onMount } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import { installRipple } from "$lib/ripple";
  import { layout } from "$lib/stores/layout.svelte";
  let { children } = $props();

  onMount(() => {
    layout.init();
    const uninstallRipple = installRipple();
    return () => {
      uninstallRipple();
      layout.destroy();
    };
  });
</script>

<ModeWatcher />
<Toaster position="top-center" />
{@render children?.()}
