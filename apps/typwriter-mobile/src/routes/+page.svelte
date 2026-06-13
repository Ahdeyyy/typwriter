<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "$lib/stores/app.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import HomeScreen from "$lib/components/screens/home.svelte";
  import EditorScreen from "$lib/components/screens/editor.svelte";
  import SettingsOverlay from "$lib/components/screens/settings-overlay.svelte";
  import DiagnosticsDrawer from "$lib/components/diagnostics/diagnostics-drawer.svelte";

  onMount(() => {
    app.init();
    void settings.init();
  });
</script>

{#if app.screen === "home"}
  <HomeScreen />
{:else}
  <EditorScreen />
{/if}

<!-- Overlays reachable from both screens. -->
<SettingsOverlay />
<DiagnosticsDrawer />
