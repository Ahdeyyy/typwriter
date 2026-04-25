<script lang="ts">
  import "./layout.css";
  import "@fontsource-variable/inter/wght.css";
  import { onMount } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";
  import { updater } from "$lib/stores/updater.svelte";
  import { mode, ModeWatcher } from "mode-watcher";
  import {app} from "@tauri-apps/api"

  const { children } = $props();

  $effect(() => {

    return installGlobalErrorLogging();
  });

  onMount(() => {
    app.setTheme(mode.current === "dark" ? "dark": "light")
    updater.checkPassive();
  });
</script>

<Toaster position="top-right" />
<ModeWatcher />
{@render children()}
