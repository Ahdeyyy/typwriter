<script lang="ts">
  import "./layout.css";
  import { ModeWatcher } from "mode-watcher";
  import { onMount } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import { installRipple } from "$lib/ripple";
  import { layout } from "$lib/stores/layout.svelte";
  import { systemBars } from "$lib/stores/system-bars.svelte";
  let { children } = $props();

  // Before the first paint, so an edge-to-edge cold start lays out against the
  // last measured bar heights instead of jumping once the plugin answers.
  if (typeof document !== "undefined") systemBars.restore();

  onMount(() => {
    layout.init();
    systemBars.init();
    const uninstallRipple = installRipple();
    return () => {
      uninstallRipple();
      systemBars.destroy();
      layout.destroy();
    };
  });
</script>

<ModeWatcher />
<!-- Below the status bar: the shell is edge to edge, so the top of the
     viewport is under it. -->
<Toaster
  position="top-center"
  mobileOffset={{ top: "calc(var(--safe-top) + 0.5rem)" }}
  offset={{ top: "calc(var(--safe-top) + 0.5rem)" }}
/>
{@render children?.()}
