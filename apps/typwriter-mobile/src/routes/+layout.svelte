<script lang="ts">
  import "./layout.css";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner";
  let { children } = $props();
</script>

<ModeWatcher />
<Toaster position="top-center" />
{@render children?.()}
