<script lang="ts">
  import "./layout.css";
  import "@fontsource-variable/inter/wght.css";
  import { onMount } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";
  import { updater } from "$lib/stores/updater.svelte";
  import { mode, ModeWatcher } from "mode-watcher";
  import {app,window} from "@tauri-apps/api"
    import { Effect } from "@tauri-apps/api/window";

  const darkBackground = "#0a0a0a"

  const { children } = $props();

  $effect(() => {

    return installGlobalErrorLogging();
  });

  onMount(async () => {
    app.setTheme(mode.current === "dark" ? "dark": "light")
    updater.checkPassive();
  });
</script>

<Toaster position="top-right" />
<ModeWatcher />
{@render children()}
